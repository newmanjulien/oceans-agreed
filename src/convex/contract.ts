import { requireProfile } from './auth';
import { v } from 'convex/values';
import { query } from './_generated/server';
import { baselineBlock as contractBlock } from './sourceValidators';

export const getBlocks = query({
	args: {},
	returns: v.array(contractBlock),
	handler: async (ctx) => {
		await requireProfile(ctx);
		const blocks = await ctx.db.query('contractBlocks').withIndex('by_order').take(4097);
		if (blocks.length > 4096) throw new Error('Contract exceeds supported size');
		let previousOrder = -1;
		for (const block of blocks) {
			if (!Number.isSafeInteger(block.order) || block.order < 0)
				throw new Error(`Invalid live block order: ${block.blockKey}`);
			if (block.order <= previousOrder)
				throw new Error(`Duplicate or unsorted live block order: ${block.blockKey}`);
			previousOrder = block.order;
		}
		return blocks.map(({ _id, _creationTime, ...block }) => block);
	}
});
