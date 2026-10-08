import { v, ConvexError } from 'convex/values';
import { mutation, internalMutation, internalQuery, type QueryCtx } from './_generated/server';
import { requirePermission, requireProfile } from './auth';
function name(value: string) {
	const result = value.trim();
	if (!result || result.length > 32)
		throw new ConvexError('Name must be between 1 and 32 characters.');
	return result;
}
export const savePersonalName = mutation({
	args: { name: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const profile = await requireProfile(ctx);
		await ctx.db.patch('profiles', profile._id, { name: name(args.name) });
		return null;
	}
});
export const saveCompanyName = mutation({
	args: { name: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		await requirePermission(ctx, 'editCompanyProfile');
		const company = await ctx.db
			.query('company')
			.withIndex('by_key', (q) => q.eq('key', 'shared'))
			.unique();
		if (!company) throw new ConvexError('Company is unavailable.');
		await ctx.db.patch('company', company._id, { name: name(args.name) });
		return null;
	}
});

function requireAvatarProfile(ctx: QueryCtx, company: boolean) {
	return company ? requirePermission(ctx, 'editCompanyProfile') : requireProfile(ctx);
}

export const authorizeAvatarUpload = internalQuery({
	args: { company: v.boolean() },
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireAvatarProfile(ctx, args.company);
		return null;
	}
});

export const setAvatar = internalMutation({
	args: { avatarId: v.id('_storage'), company: v.boolean() },
	returns: v.null(),
	handler: async (ctx, args) => {
		// Reauthorize in the committing transaction; the role may change during upload.
		const profile = await requireAvatarProfile(ctx, args.company);
		if (args.company) {
			const company = await ctx.db
				.query('company')
				.withIndex('by_key', (q) => q.eq('key', 'shared'))
				.unique();
			if (!company) throw new ConvexError('Company is unavailable.');
			if (company.avatarId) await ctx.storage.delete(company.avatarId);
			await ctx.db.patch('company', company._id, { avatarId: args.avatarId });
		} else {
			if (profile.avatarId) await ctx.storage.delete(profile.avatarId);
			await ctx.db.patch('profiles', profile._id, { avatarId: args.avatarId });
		}
		return null;
	}
});
