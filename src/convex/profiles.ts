import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { v, ConvexError } from 'convex/values';
import { query, mutation, internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import { requireProfile, verifiedIdentity } from './auth';
import { permissions, permissionsForRole, role } from './permissions';
export const profileView = v.object({
	id: v.id('profiles'),
	name: v.string(),
	email: v.string(),
	role,
	avatarUrl: v.union(v.string(), v.null())
});
export const viewer = query({
	args: {},
	returns: v.union(
		v.object({
			profile: profileView,
			permissions,
			company: v.object({ name: v.string(), avatarUrl: v.union(v.string(), v.null()) }),
			ready: v.boolean(),
			needsInitialization: v.boolean()
		}),
		v.null()
	),
	handler: async (ctx) => {
		const identity = await verifiedIdentity(ctx);
		const deleted = await ctx.db
			.query('deletedUsers')
			.withIndex('by_issuer_and_clerkId', (q) =>
				q.eq('issuer', identity.issuer).eq('clerkId', identity.subject)
			)
			.unique();
		if (deleted) throw new ConvexError('This account has been deleted.');
		const profile = await ctx.db
			.query('profiles')
			.withIndex('by_identity', (q) => q.eq('identity', identity.tokenIdentifier))
			.unique();
		if (!profile) return null;
		const company = await ctx.db
			.query('company')
			.withIndex('by_key', (q) => q.eq('key', 'shared'))
			.unique();
		const workspace = await ctx.db
			.query('workspace')
			.withIndex('by_key', (q) => q.eq('key', 'shared'))
			.unique();
		return {
			profile: {
				id: profile._id,
				name: profile.name,
				email: identity.email!,
				role: profile.role,
				avatarUrl: profile.avatarId ? await ctx.storage.getUrl(profile.avatarId) : null
			},
			company: {
				name: company?.name ?? 'Oceans',
				avatarUrl: company?.avatarId
					? await ctx.storage.getUrl(company.avatarId)
					: '/oceanstalent_logo.jpeg'
			},
			permissions: permissionsForRole(profile.role),
			ready: workspace?.ready ?? false,
			needsInitialization: !company || !workspace || profile.email !== identity.email
		};
	}
});
// Trusted operators assign roles through Convex's dashboard/CLI, never the public API.
export const assignRole = internalMutation({
	args: { profileId: v.id('profiles'), role },
	returns: v.null(),
	handler: async (ctx, args) => {
		const profile = await ctx.db.get('profiles', args.profileId);
		if (
			!profile ||
			(await ctx.db
				.query('deletedUsers')
				.withIndex('by_profileId', (q) => q.eq('profileId', args.profileId))
				.unique())
		)
			throw new ConvexError('This account has been deleted.');
		await ctx.db.patch('profiles', profile._id, { role: args.role });
		return null;
	}
});
export const initialize = mutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const identity = await verifiedIdentity(ctx);
		if (
			await ctx.db
				.query('deletedUsers')
				.withIndex('by_issuer_and_clerkId', (q) =>
					q.eq('issuer', identity.issuer).eq('clerkId', identity.subject)
				)
				.unique()
		)
			throw new ConvexError('This account has been deleted.');
		let profile = await ctx.db
			.query('profiles')
			.withIndex('by_identity', (q) => q.eq('identity', identity.tokenIdentifier))
			.unique();
		if (!profile) {
			const id = await ctx.db.insert('profiles', {
				identity: identity.tokenIdentifier,
				issuer: identity.issuer,
				clerkId: identity.subject,
				email: identity.email!,
				name: (identity.name ?? '').trim().slice(0, 32),
				role: 'rep'
			});
			profile = (await ctx.db.get('profiles', id))!;
		} else if (profile.email !== identity.email)
			await ctx.db.patch('profiles', profile._id, { email: identity.email! });
		if (
			!(await ctx.db
				.query('company')
				.withIndex('by_key', (q) => q.eq('key', 'shared'))
				.unique())
		)
			await ctx.db.insert('company', { key: 'shared', name: 'Oceans' });
		if (
			!(await ctx.db
				.query('workspace')
				.withIndex('by_key', (q) => q.eq('key', 'shared'))
				.unique())
		) {
			await ctx.db.insert('workspace', { key: 'shared', legacyOwnerId: profile._id, ready: false });
			await ctx.scheduler.runAfter(0, internal.profiles.attributeLegacy, {});
		}
		return null;
	}
});
export const attributeLegacy = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const workspace = await ctx.db
			.query('workspace')
			.withIndex('by_key', (q) => q.eq('key', 'shared'))
			.unique();
		if (!workspace || workspace.ready) return null;
		const contracts = await ctx.db
			.query('savedContracts')
			.withIndex('by_creatorId', (q) => q.eq('creatorId', undefined))
			.take(4);
		for (const contract of contracts)
			await ctx.db.patch('savedContracts', contract._id, { creatorId: workspace.legacyOwnerId });
		if (contracts.length === 4)
			await ctx.scheduler.runAfter(0, internal.profiles.attributeLegacy, {});
		else {
			await ctx.db.patch('workspace', workspace._id, { ready: true });
			await ctx.scheduler.runAfter(0, internal.accountDeletion.resume, {});
		}
		return null;
	}
});
export const colleagues = query({
	args: { paginationOpts: paginationOptsValidator },
	returns: paginationResultValidator(profileView),
	handler: async (ctx, { paginationOpts }) => {
		await requireProfile(ctx);
		const page = await ctx.db.query('profiles').paginate(paginationOpts);
		const profiles = [];
		for (const profile of page.page) {
			if (
				await ctx.db
					.query('deletedUsers')
					.withIndex('by_profileId', (q) => q.eq('profileId', profile._id))
					.unique()
			)
				continue;
			profiles.push({
				id: profile._id,
				name: profile.name,
				email: profile.email,
				role: profile.role,
				avatarUrl: profile.avatarId ? await ctx.storage.getUrl(profile.avatarId) : null
			});
		}
		return { ...page, page: profiles };
	}
});
