import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { requireProfile } from './auth';
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

export const caller = internalQuery({
	args: {},
	returns: v.object({ id: v.id('profiles'), issuer: v.string() }),
	handler: async (ctx) => {
		const profile = await requireProfile(ctx);
		return { id: profile._id, issuer: profile.issuer };
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
		const workspace = await ctx.db
			.query('workspace')
			.withIndex('by_key', (q) => q.eq('key', 'shared'))
			.unique();
		if (workspace && !workspace.ready) {
			await ctx.scheduler.runAfter(0, internal.profiles.attributeLegacy, {});
			return null;
		}
		const markers = await ctx.db
			.query('deletedUsers')
			.withIndex('by_complete', (q) => q.eq('complete', false))
			.take(10);
		for (const marker of markers) await ensureCleanup(ctx, marker);
		return null;
	}
});
export const clean = internalMutation({
	args: { markerId: v.id('deletedUsers'), generation: v.optional(v.number()) },
	returns: v.null(),
	handler: async (ctx, { markerId, generation }) => {
		const marker = await ctx.db.get('deletedUsers', markerId);
		// Legacy jobs have no generation; once a chain is tracked, all older jobs become no-ops.
		if (!marker || marker.complete || generation !== marker.cleanupGeneration) return null;
		const workspace = await ctx.db
			.query('workspace')
			.withIndex('by_key', (q) => q.eq('key', 'shared'))
			.unique();
		if (workspace && !workspace.ready) return null;
		if (marker.profileId) {
			// One contract at a time; at most eight snapshot records (each may approach 1 MB) removed per transaction.
			const contract = await ctx.db
				.query('savedContracts')
				.withIndex('by_creatorId', (q) => q.eq('creatorId', marker.profileId))
				.first();
			if (contract) {
				const approval = await ctx.db
					.query('approvalRequests')
					.withIndex('by_contractId', (q) => q.eq('contractId', contract._id))
					.unique();
				if (approval) {
					const job = await ctx.db.system.get('_scheduled_functions', approval.sendJobId);
					if (job?.state.kind === 'pending' || job?.state.kind === 'inProgress')
						await ctx.scheduler.cancel(approval.sendJobId);
					await ctx.db.delete('approvalRequests', approval._id);
				}
				const blocks = await ctx.db
					.query('contractSnapshotBlocks')
					.withIndex('by_contractId', (q) => q.eq('contractId', contract._id))
					.take(4);
				const items = await ctx.db
					.query('contractSnapshotItems')
					.withIndex('by_contractId', (q) => q.eq('contractId', contract._id))
					.take(4);
				for (const row of blocks) await ctx.db.delete('contractSnapshotBlocks', row._id);
				for (const row of items) await ctx.db.delete('contractSnapshotItems', row._id);
				if (blocks.length < 4 && items.length < 4)
					await ctx.db.delete('savedContracts', contract._id);
				await scheduleCleanup(ctx, marker);
				return null;
			}
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
