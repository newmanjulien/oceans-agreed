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
export async function requireProfile(ctx: QueryCtx) {
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
	return profile;
}
export async function requireMembership(ctx: QueryCtx, expectedMembershipId?: Id<'memberships'>) {
	const profile = await requireProfile(ctx);
	// The indexed unique read participates in the transaction: concurrent joins conflict.
	const membership = await ctx.db
		.query('memberships')
		.withIndex('by_profileId', (q) => q.eq('profileId', profile._id))
		.unique();
	if (!membership || (expectedMembershipId && membership._id !== expectedMembershipId))
		throw new ConvexError('Your company access has changed. Reload to continue.');
	const company = await ctx.db.get('company', membership.companyId);
	if (!company) throw new ConvexError('This company is unavailable.');
	return {
		...profile,
		membership,
		company,
		companyId: company._id,
		membershipId: membership._id,
		isOwner: company.ownerProfileId === profile._id
	};
}
export type CompanyAccess = Awaited<ReturnType<typeof requireMembership>>;
export async function requirePermission(
	ctx: QueryCtx,
	permission: Permission,
	membershipId?: Id<'memberships'>
) {
	const access = await requireMembership(ctx, membershipId);
	assertPermission(access.role, permission, access.isOwner);
	return access;
}
export async function liveProfile(ctx: QueryCtx, profileId?: Id<'profiles'>) {
	if (!profileId) return null;
	const [profile, deleted] = await Promise.all([
		ctx.db.get('profiles', profileId),
		ctx.db
			.query('deletedUsers')
			.withIndex('by_profileId', (q) => q.eq('profileId', profileId))
			.unique()
	]);
	return deleted ? null : profile;
}
export async function creatorDeleted(ctx: QueryCtx, creatorId?: Id<'profiles'>) {
	return !(await liveProfile(ctx, creatorId));
}
export function accessibleContract(contract: Doc<'savedContracts'> | null, access: CompanyAccess) {
	return contract?.companyId === access.companyId ? contract : null;
}
export function scopedOperation(access: Pick<CompanyAccess, 'membershipId'>, operationId: string) {
	return `${access.membershipId}:${operationId}`;
}
