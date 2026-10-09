import { v, ConvexError } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';
import { internal } from './_generated/api';
import { requireProfile, creatorDeleted } from './auth';
import type { MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';

async function scheduleCleanup(ctx: MutationCtx, marker: Doc<'deletedUsers'>) {
	const generation = (marker.cleanupGeneration ?? 0) + 1;
	const jobId = await ctx.scheduler.runAfter(0, internal.accountDeletion.clean, {
		markerId: marker._id,
		generation
	});
	await ctx.db.patch('deletedUsers', marker._id, {
		cleanupJobId: jobId,
		cleanupGeneration: generation
	});
}

async function ensureCleanup(ctx: MutationCtx, marker: Doc<'deletedUsers'>) {
	if (marker.complete) return;
	const job = marker.cleanupJobId
		? await ctx.db.system.get('_scheduled_functions', marker.cleanupJobId)
		: null;
	if (job?.state.kind === 'pending' || job?.state.kind === 'inProgress') return;
	await scheduleCleanup(ctx, marker);
}

export const authorize = query({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const profile = await requireProfile(ctx);
		const owned = await ctx.db
			.query('company')
			.withIndex('by_ownerProfileId', (q) => q.eq('ownerProfileId', profile._id))
			.first();
		if (owned) throw new ConvexError('Transfer company ownership before deleting your account.');
		return null;
	}
});
export const mark = internalMutation({
	args: { issuer: v.string(), clerkId: v.string() },
	returns: v.null(),
	handler: async (ctx, { issuer, clerkId }) => {
		let marker = await ctx.db
			.query('deletedUsers')
			.withIndex('by_issuer_and_clerkId', (q) => q.eq('issuer', issuer).eq('clerkId', clerkId))
			.unique();
		if (!marker) {
			const profile = await ctx.db
				.query('profiles')
				.withIndex('by_issuer_and_clerkId', (q) => q.eq('issuer', issuer).eq('clerkId', clerkId))
				.unique();
			const markerId = await ctx.db.insert('deletedUsers', {
				issuer,
				clerkId,
				profileId: profile?._id,
				deletedAt: Date.now(),
				complete: !profile
			});
			marker = await ctx.db.get('deletedUsers', markerId);
		}
		if (marker) await ensureCleanup(ctx, marker);
		return null;
	}
});
export const resume = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const markers = await ctx.db
			.query('deletedUsers')
			.withIndex('by_complete', (q) => q.eq('complete', false))
			.take(10);
		for (const marker of markers) await ensureCleanup(ctx, marker);
		return null;
	}
});
export const clean = internalMutation({
	args: { markerId: v.id('deletedUsers'), generation: v.number() },
	returns: v.null(),
	handler: async (ctx, { markerId, generation }) => {
		const marker = await ctx.db.get('deletedUsers', markerId);
		// A retried or superseded cleanup job cannot continue an older chain.
		if (!marker || marker.complete || generation !== marker.cleanupGeneration) return null;
		if (marker.profileId) {
			const profileId = marker.profileId;
			const membership = await ctx.db
				.query('memberships')
				.withIndex('by_profileId', (q) => q.eq('profileId', profileId))
				.unique();
			const owned = await ctx.db
				.query('company')
				.withIndex('by_ownerProfileId', (q) => q.eq('ownerProfileId', profileId))
				.first();
			if (owned) {
				const candidates = await ctx.db
					.query('memberships')
					.withIndex('by_companyId', (q) => q.eq('companyId', owned._id))
					.paginate({ cursor: marker.successorCursor ?? null, numItems: 25 });
				let successor;
				for (const candidate of candidates.page) {
					if (
						candidate.profileId !== profileId &&
						!(await creatorDeleted(ctx, candidate.profileId))
					) {
						successor = candidate;
						break;
					}
				}
				if (!successor && !candidates.isDone) {
					await ctx.db.patch('deletedUsers', marker._id, {
						successorCursor: candidates.continueCursor
					});
					await scheduleCleanup(ctx, marker);
					return null;
				}
				await ctx.db.patch('company', owned._id, { ownerProfileId: successor?.profileId });
			}
			if (membership) await ctx.db.delete('memberships', membership._id);
			const profile = await ctx.db.get('profiles', marker.profileId);
			if (profile?.avatarId) await ctx.storage.delete(profile.avatarId);
			if (profile) await ctx.db.delete('profiles', profile._id);
		}
		await ctx.db.patch('deletedUsers', markerId, { complete: true, cleanupJobId: undefined });
		await ctx.scheduler.runAfter(0, internal.accountDeletion.resume, {});
		return null;
	}
});
export const registered = internalQuery({
	args: { cursor: v.union(v.string(), v.null()) },
	returns: v.object({
		page: v.array(v.object({ issuer: v.string(), clerkId: v.string() })),
		cursor: v.string(),
		done: v.boolean()
	}),
	handler: async (ctx, { cursor }) => {
		const result = await ctx.db.query('profiles').paginate({ cursor, numItems: 25 });
		return {
			page: result.page.map(({ issuer, clerkId }) => ({ issuer, clerkId })),
			cursor: result.continueCursor,
			done: result.isDone
		};
	}
});
