'use node';
import { createClerkClient } from '@clerk/backend';
import { v } from 'convex/values';
import { env, internalAction } from './_generated/server';
import { internal } from './_generated/api';
const client = () => createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
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
