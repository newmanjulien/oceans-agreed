// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api, internal } from '../../src/convex/_generated/api';
import schema from '../../src/convex/schema';
import { publishTemplate } from '../../src/convex/templates';
import { create } from '../../src/convex/savedContracts';
import type { MutationCtx } from '../../src/convex/_generated/server';
import { block, item as baseItem, identity, initializeViewer } from './fixtures';
const item = {
	...baseItem,
	triggers: [
		{
			id: 'trigger',
			range: { start: { sourceKey: 'text-1', offset: 0 }, end: { sourceKey: 'text-1', offset: 9 } }
		}
	]
};

vi.mock('../../src/convex/approvalEmail', () => ({ send: { _handler: vi.fn() } }));
const modules = import.meta.glob('../../src/convex/**/*.*s');
async function fixture() {
	const t = convexTest(schema, modules).withIdentity(identity);
	const profileId = await t.run(initializeViewer);
	const itemId = await t.run(async ({ db }) => {
		await db.insert('contractBlocks', block);
		return db.insert('playbookItems', {
			...item,
			instructions: { changesNeedApproval: 'Ask first.' }
		});
	});
	return { t, itemId, profileId };
}
const operationId = '11111111-1111-1111-1111-111111111111';
describe('immutable template creation', () => {
	it('initializes atomically and concurrently without replacing the pointer', async () => {
		const { t } = await fixture();
		const [first, second] = await Promise.all([
			t.mutation(internal.templates.initialize, {}),
			t.mutation(internal.templates.initialize, {})
		]);
		expect(first).toBe(second);
		expect(await t.run(({ db }) => db.query('templateVersions').collect())).toHaveLength(1);
	});
	it('publishes instruction changes once and preserves old content and deleted receipts', async () => {
		const { t, itemId } = await fixture();
		const first = await t.mutation(internal.templates.initialize, {});
		const created = await t.mutation(api.savedContracts.create, {
			companyName: 'Buyer',
			operationId
		});
		if (created.status !== 'created') throw new Error('creation failed');
		const saved = await t.mutation(api.admin.savePlaybookItem, {
			id: itemId,
			item: { ...item, instructions: { changesNeedApproval: 'Different wording.' } },
			expectedRevision: 0,
			operationId
		});
		expect(saved.status).toBe('saved');
		await t.mutation(api.admin.savePlaybookItem, {
			id: itemId,
			item,
			expectedRevision: 0,
			operationId
		});
		expect(await t.run(({ db }) => db.query('templateVersions').collect())).toHaveLength(2);
		const loaded = await t.query(api.savedContracts.load, { id: created.id });
		expect(loaded?.snapshot.items[0].instructions?.changesNeedApproval).toBe('Ask first.');
		expect(created.contract.templateVersionId).toBe(first);
		const retry = await t.mutation(api.savedContracts.create, {
			companyName: 'Other',
			operationId
		});
		expect(retry).toEqual(created);
		const next = await t.mutation(api.savedContracts.create, {
			companyName: 'Next',
			operationId: 'next'
		});
		expect(next.status === 'created' && next.contract.templateVersionId).not.toBe(first);
		await t.mutation(api.savedContracts.remove, { id: created.id });
		expect(
			await t.mutation(api.savedContracts.create, { companyName: 'Buyer', operationId })
		).toEqual({ status: 'deleted' });
		expect(await t.query(api.templates.version, { versionId: first })).toEqual(loaded?.snapshot);
		await t.mutation(api.admin.deletePlaybookItem, { id: itemId, expectedRevision: 1 });
		await t.mutation(api.admin.deletePlaybookItem, { id: itemId, expectedRevision: 1 });
		expect(await t.run(({ db }) => db.query('templateVersions').collect())).toHaveLength(3);
	});
	it('rolls back authoring, partial copies and pointer on insufficient capacity', async () => {
		const { t, itemId } = await fixture();
		const first = await t.mutation(internal.templates.initialize, {});
		await expect(
			t.run(async (ctx) => {
				await ctx.db.patch('playbookItems', itemId, {
					instructions: { changesNeedApproval: 'Uncommitted' }
				});
				let calls = 0;
				await publishTemplate({
					...ctx,
					meta: {
						...ctx.meta,
						getTransactionMetrics: async () => {
							const metrics = await ctx.meta.getTransactionMetrics();
							if (++calls > 2) metrics.documentsWritten.remaining = 0;
							return metrics;
						}
					}
				});
			})
		).rejects.toThrow('transaction capacity');
		expect((await t.query(api.templates.current, {}))?.versionId).toBe(first);
		expect(await t.run(({ db }) => db.query('templateVersions').collect())).toHaveLength(1);
		expect(
			(await t.run(({ db }) => db.get('playbookItems', itemId)))?.instructions?.changesNeedApproval
		).toBe('Ask first.');
	});
	it('creates with two writes and no template-content reads or compilation', async () => {
		const { t } = await fixture();
		await t.mutation(internal.templates.initialize, {});
		const counts = { writes: 0, content: 0 };
		await t.run((ctx) => {
			const db = new Proxy(ctx.db, {
				get(target, key) {
					const value = Reflect.get(target, key);
					if (typeof value !== 'function') return value;
					return (...args: unknown[]) => {
						if (['insert', 'patch', 'replace', 'delete'].includes(String(key))) counts.writes++;
						if (key === 'query' && /Blocks|Items/.test(String(args[0]))) counts.content++;
						return value.apply(target, args);
					};
				}
			});
			return (
				create as unknown as {
					_handler: (
						ctx: MutationCtx,
						args: { companyName: string; operationId: string }
					) => Promise<unknown>;
				}
			)._handler({ ...ctx, db }, { companyName: 'Buyer', operationId });
		});
		expect(counts).toEqual({ writes: 2, content: 0 });
	});
	it('saves and reads approval descriptions from shared versions; blocks maintenance', async () => {
		const { t, itemId } = await fixture();
		await t.mutation(internal.templates.initialize, {});
		const created = await t.mutation(api.savedContracts.create, {
			companyName: 'Buyer',
			operationId
		});
		if (created.status !== 'created') throw new Error('creation failed');
		await t.mutation(api.savedContracts.saveChoices, {
			id: created.id,
			selectedConcessions: { [itemId]: 'preferred' },
			expectedRevision: 0,
			operationId: 'save'
		});
		const request = await t.mutation(api.approvals.request, {
			id: created.id,
			expectedRevision: 1
		});
		expect(
			await t.query(internal.approvals.descriptions, {
				id: created.id,
				requestId: request.id,
				offset: 0
			})
		).toEqual([{ description: 'Synthetic choice.', requiresApproval: true }]);
		await t.mutation(internal.templates.beginImport, {});
		await expect(
			t.mutation(api.savedContracts.create, { companyName: 'Buyer', operationId: 'blocked' })
		).rejects.toThrow('maintenance');
		await expect(
			t.mutation(api.admin.deletePlaybookItem, { id: itemId, expectedRevision: 0 })
		).rejects.toThrow('maintenance');
		await t.mutation(internal.templates.finishImport, {});
		expect((await t.query(api.templates.current, {}))?.versionId).not.toBe(
			created.contract.templateVersionId
		);
	});
	it('keeps legacy snapshots readable for saving and approval after publication', async () => {
		const { t, itemId, profileId } = await fixture();
		const id = await t.run(async (ctx) => {
			const id = await ctx.db.insert('savedContracts', {
				companyName: 'Legacy',
				creatorId: profileId,
				savedAt: 1,
				selectedConcessions: {},
				revision: 0,
				blockCount: 1,
				itemCount: 1
			});
			await ctx.db.insert('contractSnapshotBlocks', { contractId: id, block });
			await ctx.db.insert('contractSnapshotItems', {
				contractId: id,
				itemId,
				item: (await ctx.db.get('playbookItems', itemId))!
			});
			return id;
		});
		await t.mutation(internal.templates.initialize, {});
		await t.mutation(api.admin.deletePlaybookItem, { id: itemId, expectedRevision: 0 });
		expect((await t.query(api.savedContracts.load, { id }))?.snapshot.items[0]._id).toBe(itemId);
		await t.mutation(api.savedContracts.saveChoices, {
			id,
			selectedConcessions: { [itemId]: 'preferred' },
			expectedRevision: 0,
			operationId: 'save'
		});
		const request = await t.mutation(api.approvals.request, { id, expectedRevision: 1 });
		expect(
			await t.query(internal.approvals.descriptions, { id, requestId: request.id, offset: 0 })
		).toEqual([{ description: 'Synthetic choice.', requiresApproval: true }]);
	});
	it('rejects invalid complete templates without publishing or changing live authoring', async () => {
		const { t, itemId } = await fixture();
		const first = await t.mutation(internal.templates.initialize, {});
		await expect(
			t.mutation(api.admin.savePlaybookItem, {
				id: itemId,
				item: {
					...item,
					triggers: [
						{
							id: 'invalid',
							range: {
								start: { sourceKey: 'missing', offset: 0 },
								end: { sourceKey: 'missing', offset: 1 }
							}
						}
					]
				},
				expectedRevision: 0,
				operationId
			})
		).rejects.toThrow();
		expect((await t.query(api.templates.current, {}))?.versionId).toBe(first);
		expect((await t.run(({ db }) => db.get('playbookItems', itemId)))?.triggers).toEqual(
			item.triggers
		);
		expect(await t.run(({ db }) => db.query('templateVersions').collect())).toHaveLength(1);
	});
	it('initialization cannot replace an admin publication in a race', async () => {
		const { t, itemId } = await fixture();
		await Promise.all([
			t.mutation(internal.templates.initialize, {}),
			t.mutation(api.admin.savePlaybookItem, {
				id: itemId,
				item: { ...item, instructions: { changesNeedApproval: 'Newest' } },
				expectedRevision: 0,
				operationId
			})
		]);
		const current = await t.query(api.templates.current, {});
		expect(current?.snapshot.items[0].instructions?.changesNeedApproval).toBe('Newest');
		expect(await t.mutation(internal.templates.initialize, {})).toBe(current?.versionId);
	});
});
