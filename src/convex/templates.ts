import { requireProfile } from './auth';
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { snapshot } from './savedContractValidators';
import {
	MAX_CONTRACT_BLOCKS,
	MAX_PLAYBOOK_ITEMS,
	PlaybookValidationError
} from '../lib/playbook/validation';
import { validatePlaybook } from '../lib/playbook/audit';

export function currentPointer(ctx: QueryCtx) {
	return ctx.db
		.query('currentTemplate')
		.withIndex('by_key', (q) => q.eq('key', 'current'))
		.unique();
}
export async function assertAuthoringAvailable(ctx: QueryCtx) {
	if ((await currentPointer(ctx))?.maintenance)
		throw publicationRejected('Template maintenance is in progress. Try again shortly.');
}
function publicationRejected(message: string) {
	return new ConvexError({ code: 'TEMPLATE_PUBLICATION_REJECTED', message });
}
export async function readLiveSnapshot(ctx: QueryCtx) {
	const [records, items] = await Promise.all([
		ctx.db
			.query('contractBlocks')
			.withIndex('by_order')
			.take(MAX_CONTRACT_BLOCKS + 1),
		ctx.db.query('playbookItems').take(MAX_PLAYBOOK_ITEMS + 1)
	]);
	if (!records.length) throw publicationRejected('The baseline contract is not available.');
	if (records.length > MAX_CONTRACT_BLOCKS || items.length > MAX_PLAYBOOK_ITEMS)
		throw publicationRejected('Contract exceeds supported size.');
	return { blocks: records.map(({ _id, _creationTime, ...block }) => block), items };
}

/** Publication and its authoring change commit together, or neither commits. */
export async function publishTemplate(ctx: MutationCtx) {
	const captured = await readLiveSnapshot(ctx);
	const bytes = new TextEncoder().encode(JSON.stringify(captured)).byteLength;
	if (bytes > 8_000_000) throw publicationRejected('Contract snapshot exceeds supported size.');
	try {
		validatePlaybook(captured.blocks, captured.items);
	} catch (error) {
		if (error instanceof PlaybookValidationError) throw publicationRejected(error.message);
		throw error;
	}
	const pointer = await currentPointer(ctx);
	// Reserve space for metadata/pointer and table wrappers. Check before copying,
	// and during copying, so even a near-limit authoring transaction rolls back.
	const capacity = async (documents: number, bytes: number) => {
		const metrics = await ctx.meta.getTransactionMetrics();
		if (
			metrics.documentsWritten.remaining < documents + 2 ||
			metrics.bytesWritten.remaining < bytes + 65_536 ||
			metrics.databaseQueries.remaining < documents + 2
		)
			throw publicationRejected(
				'Template publication exceeds transaction capacity. Reduce the template size.'
			);
	};
	const count = captured.blocks.length + captured.items.length;
	await capacity(count + 1, bytes + count * 512);
	const versionId = await ctx.db.insert('templateVersions', {
		publishedAt: Date.now(),
		blockCount: captured.blocks.length,
		itemCount: captured.items.length,
		snapshotBytes: bytes
	});
	for (const block of captured.blocks) {
		await capacity(1, new TextEncoder().encode(JSON.stringify(block)).byteLength + 512);
		await ctx.db.insert('templateVersionBlocks', { versionId, block });
	}
	for (const item of captured.items) {
		await capacity(1, new TextEncoder().encode(JSON.stringify(item)).byteLength + 512);
		await ctx.db.insert('templateVersionItems', { versionId, itemId: item._id, item });
	}
	if (pointer) await ctx.db.patch('currentTemplate', pointer._id, { versionId });
	else await ctx.db.insert('currentTemplate', { key: 'current', versionId, maintenance: false });
	return versionId;
}
export async function readVersion(ctx: QueryCtx, versionId: Id<'templateVersions'>) {
	const version = await ctx.db.get('templateVersions', versionId);
	if (!version) throw new ConvexError('This template version is unavailable.');
	const [blocks, items] = await Promise.all([
		ctx.db
			.query('templateVersionBlocks')
			.withIndex('by_versionId', (q) => q.eq('versionId', versionId))
			.take(MAX_CONTRACT_BLOCKS + 1),
		ctx.db
			.query('templateVersionItems')
			.withIndex('by_versionId', (q) => q.eq('versionId', versionId))
			.take(MAX_PLAYBOOK_ITEMS + 1)
	]);
	if (blocks.length !== version.blockCount || items.length !== version.itemCount)
		throw new ConvexError('This template version is incomplete.');
	return {
		blocks: blocks.map((row) => row.block).sort((a, b) => a.order - b.order),
		items: items.map((row) => row.item)
	};
}
export const current = query({
	args: {},
	returns: v.union(v.null(), v.object({ versionId: v.id('templateVersions'), snapshot })),
	handler: async (ctx) => {
		await requireProfile(ctx);
		const pointer = await currentPointer(ctx);
		return pointer?.versionId && !pointer.maintenance
			? { versionId: pointer.versionId, snapshot: await readVersion(ctx, pointer.versionId) }
			: null;
	}
});
export const version = query({
	args: { versionId: v.id('templateVersions') },
	returns: snapshot,
	handler: async (ctx, { versionId }) => {
		await requireProfile(ctx);
		return readVersion(ctx, versionId);
	}
});
export const initialize = internalMutation({
	args: {},
	returns: v.id('templateVersions'),
	handler: async (ctx) => {
		const pointer = await currentPointer(ctx);
		if (pointer?.maintenance)
			throw new ConvexError('Finish template maintenance before initialization.');
		return pointer?.versionId ?? (await publishTemplate(ctx));
	}
});
export const beginImport = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const pointer = await currentPointer(ctx);
		if (pointer) await ctx.db.patch('currentTemplate', pointer._id, { maintenance: true });
		else await ctx.db.insert('currentTemplate', { key: 'current', maintenance: true });
		return null;
	}
});
export const finishImport = internalMutation({
	args: {},
	returns: v.id('templateVersions'),
	handler: async (ctx) => {
		const pointer = await currentPointer(ctx);
		if (!pointer?.maintenance) throw new ConvexError('Template import is not in maintenance mode.');
		const versionId = await publishTemplate(ctx);
		await ctx.db.patch('currentTemplate', pointer._id, { maintenance: false });
		return versionId;
	}
});

export async function readSnapshotBlocks(ctx: QueryCtx, contract: Doc<'savedContracts'>) {
	const rows = contract.templateVersionId
		? await ctx.db
				.query('templateVersionBlocks')
				.withIndex('by_versionId', (q) => q.eq('versionId', contract.templateVersionId!))
				.take(MAX_CONTRACT_BLOCKS + 1)
		: await ctx.db
				.query('contractSnapshotBlocks')
				.withIndex('by_contractId', (q) => q.eq('contractId', contract._id))
				.take(MAX_CONTRACT_BLOCKS + 1);
	if (rows.length !== contract.blockCount)
		throw new ConvexError('This contract snapshot is incomplete.');
	return rows.map((row) => row.block).sort((a, b) => a.order - b.order);
}
export async function readSnapshotItem(
	ctx: QueryCtx,
	contract: Doc<'savedContracts'>,
	itemId: Id<'playbookItems'>
) {
	const row = contract.templateVersionId
		? await ctx.db
				.query('templateVersionItems')
				.withIndex('by_versionId_and_itemId', (q) =>
					q.eq('versionId', contract.templateVersionId!).eq('itemId', itemId)
				)
				.unique()
		: await ctx.db
				.query('contractSnapshotItems')
				.withIndex('by_contractId_and_itemId', (q) =>
					q.eq('contractId', contract._id).eq('itemId', itemId)
				)
				.unique();
	return row?.item ?? null;
}
export async function readSnapshot(ctx: QueryCtx, contract: Doc<'savedContracts'>) {
	const [blocks, items] = await Promise.all([
		readSnapshotBlocks(ctx, contract),
		contract.templateVersionId
			? ctx.db
					.query('templateVersionItems')
					.withIndex('by_versionId', (q) => q.eq('versionId', contract.templateVersionId!))
					.take(MAX_PLAYBOOK_ITEMS + 1)
			: ctx.db
					.query('contractSnapshotItems')
					.withIndex('by_contractId', (q) => q.eq('contractId', contract._id))
					.take(MAX_PLAYBOOK_ITEMS + 1)
	]);
	if (items.length !== contract.itemCount)
		throw new ConvexError('This contract snapshot is incomplete.');
	return { blocks, items: items.map((row) => row.item) };
}
