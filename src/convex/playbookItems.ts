import { requireProfile } from './auth';
import { v } from 'convex/values';
import { query } from './_generated/server';
import schema from './schema';
import { MAX_PLAYBOOK_ITEMS } from '../lib/playbook/validation';
export const list = query({
	args: {},
	returns: v.array(schema.doc('playbookItems')),
	handler: async (ctx) => {
		await requireProfile(ctx);
		const items = await ctx.db.query('playbookItems').take(MAX_PLAYBOOK_ITEMS + 1);
		if (items.length > MAX_PLAYBOOK_ITEMS) throw new Error('Playbook exceeds supported size');
		return items;
	}
});
