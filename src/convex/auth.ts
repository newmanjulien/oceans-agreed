import { ConvexError } from 'convex/values';
import type { QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { assertPermission, type Permission } from './permissions';

export async function verifiedIdentity(ctx: Pick<QueryCtx, 'auth'>) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity || !identity.email || identity.emailVerified !== true)
		throw new ConvexError('Sign in with a verified email address.');
	return identity;
}
export async function requireProfile(ctx: QueryCtx, ready = true) {
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
	if (!profile) throw new ConvexError('Your account is still initializing.');
	if (
		ready &&
		!(
			await ctx.db
				.query('workspace')
				.withIndex('by_key', (q) => q.eq('key', 'shared'))
				.unique()
		)?.ready
	)
		throw new ConvexError('Existing contracts are still initializing.');
	return profile;
}
export async function requirePermission(ctx: QueryCtx, permission: Permission) {
	const profile = await requireProfile(ctx);
	assertPermission(profile.role, permission);
	return profile;
}
export async function creatorDeleted(ctx: QueryCtx, creatorId?: Id<'profiles'>) {
	// Unattributed contracts are never readable during an incomplete deployment/backfill.
	if (!creatorId) return true;
	return !!(await ctx.db
		.query('deletedUsers')
		.withIndex('by_profileId', (q) => q.eq('profileId', creatorId))
		.unique());
}
export async function accessibleContract(ctx: QueryCtx, contract: Doc<'savedContracts'> | null) {
	return contract && !(await creatorDeleted(ctx, contract.creatorId)) ? contract : null;
}
export function scopedOperation(profile: Doc<'profiles'>, operationId: string) {
	return `${profile._id}:${operationId}`;
}
