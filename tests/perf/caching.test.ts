import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getContractSnapshotCache,
	releaseContractSnapshotCache
} from '../../src/lib/contract/snapshot-cache';
import type { ReadyContract } from '../../src/lib/contract/snapshot-storage';
import type { Id } from '../../src/convex/_generated/dataModel';
import { block, item } from './fixtures';
import { observeSnapshotStorage } from './snapshot-storage-observer';

const id = 'synthetic-contract' as Id<'savedContracts'>;
const itemId = 'synthetic-item' as Id<'playbookItems'>;
function fixture(): ReadyContract {
	return {
		id,
		status: 'ready',
		contract: {
			_id: id,
			_creationTime: 1,
			companyName: 'Synthetic Buyer',
			savedAt: 123,
			selectedConcessions: {},
			revision: 0,
			blockCount: 1,
			itemCount: 1
		},
		snapshot: { blocks: [block], items: [{ ...item, _id: itemId, _creationTime: 1 }] }
	};
}

describe('snapshot caching work', () => {
	let storage: ReturnType<typeof observeSnapshotStorage>;

	beforeEach(() => {
		storage = observeSnapshotStorage();
		vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
		vi.stubGlobal('window', {});
	});

	afterEach(async () => {
		releaseContractSnapshotCache();
		try {
			await storage.close();
		} finally {
			vi.restoreAllMocks();
			vi.unstubAllGlobals();
		}
	});

	it('loads once from the network and reopens the same snapshot from memory', async () => {
		const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(fixture()));
		const cache = getContractSnapshotCache();
		const committed = storage.committedRevision(0);
		const first = await cache.load(id, request);
		expect(first.status).toBe('ready');
		await committed;
		expect(await cache.load(id, request)).toBe(first);
		expect(request).toHaveBeenCalledTimes(1);
		expect(storage.immutableWrites).toBe(1);
	});

	it('reopens from IndexedDB after releasing memory without another download', async () => {
		const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(fixture()));
		const committed = storage.committedRevision(0);
		const first = await getContractSnapshotCache().load(id, request);
		expect(first.status).toBe('ready');
		await committed;
		releaseContractSnapshotCache();
		expect(await getContractSnapshotCache().load(id, request)).toEqual(first);
		expect(request).toHaveBeenCalledTimes(1);
		expect(storage.immutableWrites).toBe(1);
	});

	it('persists confirmed state without rewriting the immutable snapshot', async () => {
		const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(fixture()));
		const cache = getContractSnapshotCache();
		const initialCommit = storage.committedRevision(0);
		const first = await cache.load(id, request);
		expect(first.status).toBe('ready');
		await initialCommit;
		if (first.status !== 'ready') throw new Error('Expected a ready fixture.');
		const state = {
			companyName: 'Confirmed Buyer',
			selectedConcessions: { [itemId]: 'preferred' },
			revision: 1,
			lastOperationId: 'confirmed-operation'
		};
		const updatedCommit = storage.committedRevision(1);
		const updated = cache.updateState(id, state);
		expect(updated?.snapshot).toBe(first.snapshot);
		expect(updated?.contract).toMatchObject(state);
		await updatedCommit;
		expect(await cache.load(id, request)).toEqual(updated);
		releaseContractSnapshotCache();
		expect(await getContractSnapshotCache().load(id, request)).toEqual(updated);
		expect(request).toHaveBeenCalledTimes(1);
		expect(storage.immutableWrites).toBe(1);
	});
	it('seeds confirmed content without a download, keeps newer revisions and rejects deleted seeds', async () => {
		const cache = getContractSnapshotCache();
		const data = fixture();
		const commit = storage.committedRevision(0);
		expect(cache.seedConfirmed(data)).toBe(data);
		await commit;
		const request = vi.fn<typeof fetch>();
		expect(await cache.load(id, request)).toBe(data);
		expect(request).not.toHaveBeenCalled();
		cache.updateState(id, {
			companyName: 'Latest',
			selectedConcessions: {},
			revision: 2,
			lastOperationId: 'latest'
		});
		expect(cache.seedConfirmed(data)?.contract.revision).toBe(2);
		expect(cache.peek(id)?.snapshot).toBe(data.snapshot);
		expect(storage.immutableWrites).toBe(1);
		cache.remove(id);
		expect(cache.seedConfirmed(data)).toBeUndefined();
		expect(await cache.load(id, request)).toEqual({ id, status: 'missing' });
	});
});
