import { requireMembership } from './auth';
import { v } from 'convex/values';
import { query } from './_generated/server';
import schema from './schema';
import { MAX_PLAYBOOK_ITEMS } from '../lib/playbook/validation';
export const list = query({
	args: { membershipId: v.id('memberships') },
	returns: v.array(schema.doc('playbookItems')),
	handler: async (ctx, args) => {
		const { companyId } = await requireMembership(ctx, args.membershipId);
		const items = await ctx.db
			.query('playbookItems')
			.withIndex('by_companyId', (q) => q.eq('companyId', companyId))
			.take(MAX_PLAYBOOK_ITEMS + 1);
		if (items.length > MAX_PLAYBOOK_ITEMS) throw new Error('Playbook exceeds supported size');
		return items;
	}
});
