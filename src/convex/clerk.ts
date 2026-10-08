'use node';
import { createClerkClient } from '@clerk/backend';
import { v, ConvexError } from 'convex/values';
import { env, action, internalAction } from './_generated/server';
import { internal } from './_generated/api';
const client = () => createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
const invitation = v.object({ id: v.string(), email: v.string(), createdAt: v.number() });
export const invitations = action({
	args: { query: v.optional(v.string()) },
	returns: v.object({ page: v.array(invitation), total: v.number() }),
	handler: async (ctx, { query }) => {
		await ctx.runQuery(internal.accountDeletion.caller, {});
		const result = await client().invitations.getInvitationList({
			status: 'pending',
			limit: 500,
			offset: 0,
			orderBy: '-created_at',
			query: query?.trim() || undefined
		});
		return {
			page: result.data.map((i) => ({ id: i.id, email: i.emailAddress, createdAt: i.createdAt })),
			total: result.totalCount
		};
	}
});
export const invite = action({
	args: { email: v.string() },
	returns: v.null(),
	handler: async (ctx, { email }) => {
		await ctx.runQuery(internal.accountDeletion.caller, {});
		const normalized = email.trim().toLowerCase();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
			throw new ConvexError('Enter a valid email address.');
		const url = new URL('/join', env.APP_URL);
		await client().invitations.createInvitation({
			emailAddress: normalized,
			redirectUrl: url.href,
			notify: true
		});
		return null;
	}
});
export const revoke = action({
	args: { id: v.string(), resend: v.boolean() },
	returns: v.null(),
	handler: async (ctx, { id, resend }) => {
		await ctx.runQuery(internal.accountDeletion.caller, {});
		const clerk = client();
		// Recover a resend whose revocation succeeded but replacement creation failed.
		let original;
		try {
			original = await clerk.invitations.revokeInvitation(id);
		} catch (error) {
			if (!resend) throw error;
			const revoked = await clerk.invitations.getInvitationList({
				status: 'revoked',
				query: id,
				limit: 1
			});
			original = revoked.data.find(
				(invitation) => invitation.id === id && invitation.status === 'revoked'
			);
			if (!original) throw error;
		}
		if (resend)
			await clerk.invitations.createInvitation({
				emailAddress: original.emailAddress,
				redirectUrl: new URL('/join', env.APP_URL).href,
				notify: true
			});
		return null;
	}
});
export const reconcile = internalAction({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	returns: v.null(),
	handler: async (ctx, { cursor }) => {
		if (!cursor) await ctx.runMutation(internal.accountDeletion.resume, {});
		if (!env.CLERK_SECRET_KEY || !env.CLERK_JWT_ISSUER_DOMAIN) return null;
		const result = await ctx.runQuery(internal.accountDeletion.registered, {
			cursor: cursor ?? null
		});
		const profiles = result.page.filter(
			(profile) => profile.issuer === env.CLERK_JWT_ISSUER_DOMAIN
		);
		const userIds = [...new Set(profiles.map((profile) => profile.clerkId))];
		if (userIds.length) {
			let users;
			try {
				users = await client().users.getUserList({ userId: userIds, limit: userIds.length });
			} catch {
				// API failures provide no deletion evidence. Reconciliation retries on the next cron.
			}
			if (
				users &&
				users.data.length === users.totalCount &&
				users.data.every((user) => userIds.includes(user.id))
			) {
				const existingIds = new Set(users.data.map((user) => user.id));
				for (const profile of profiles)
					if (!existingIds.has(profile.clerkId))
						await ctx.runMutation(internal.accountDeletion.mark, profile);
			}
		}
		if (!result.done)
			await ctx.scheduler.runAfter(0, internal.clerk.reconcile, { cursor: result.cursor });
		return null;
	}
});
