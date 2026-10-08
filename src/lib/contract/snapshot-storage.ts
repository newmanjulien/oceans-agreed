import { baselineBlock } from '../../convex/sourceValidators';
import { playbookItem } from '../../convex/playbookValidators';
import type { ContractRouteData } from './saved';
import { CACHE_NAMESPACE } from './browser-storage';
import { ReadAttempt, waitForRead } from '$lib/auth/attempt';

export type ReadyContract = Extract<ContractRouteData, { status: 'ready' }>;
export const SNAPSHOT_ENTRIES = 24;
export const SNAPSHOT_BYTES = 32 * 1024 * 1024;
export type SnapshotSize = { bytes: number; immutableBytes: number };
export type SnapshotEntry = SnapshotSize & { data: ReadyContract };
type Write = (
	| { kind: 'put'; entry: SnapshotEntry }
	| { kind: 'update'; contract: ReadyContract['contract']; bytes: number }
	| { kind: 'delete' }
	| { kind: 'touch' }
) & { valid: () => boolean };
const writeBytes = (write: Write) =>
	write.kind === 'put' ? write.entry.bytes : write.kind === 'update' ? write.bytes : 0;
type StoredSnapshot = { id: string; snapshot: ReadyContract['snapshot'] };
type StoredMetadata = {
	id: string;
	contract: ReadyContract['contract'];
	bytes: number;
	immutableBytes: number;
	usedAt: number;
};
type Shape = { type: string; value?: unknown };
type Field = { fieldType: Shape; optional: boolean };
function matches(value: unknown, shape: Shape): boolean {
	switch (shape.type) {
		case 'string':
		case 'id':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'boolean':
			return typeof value === 'boolean';
		case 'literal':
			return value === shape.value;
		case 'null':
			return value === null;
		case 'union':
			return (shape.value as Shape[]).some((part) => matches(value, part));
		case 'array':
			return Array.isArray(value) && value.every((part) => matches(part, shape.value as Shape));
		case 'object':
			return (
				!!value &&
				typeof value === 'object' &&
				!Array.isArray(value) &&
				Object.entries(shape.value as Record<string, Field>).every(
					([key, field]) =>
						(field.optional && (value as Record<string, unknown>)[key] === undefined) ||
						matches((value as Record<string, unknown>)[key], field.fieldType)
				)
			);
		default:
			return false;
	}
}
export function validSnapshot(value: unknown, id: string): value is ReadyContract {
	if (!value || typeof value !== 'object') return false;
	const data = value as ReadyContract;
	const contract = data.contract;
	return (
		data.status === 'ready' &&
		data.id === id &&
		!!contract &&
		contract._id === id &&
		typeof contract.companyName === 'string' &&
		Number.isFinite(contract._creationTime) &&
		Number.isFinite(contract.savedAt) &&
		Number.isFinite(contract.blockCount) &&
		Number.isFinite(contract.itemCount) &&
		(contract.templateVersionId === undefined || typeof contract.templateVersionId === 'string') &&
		(contract.lastOperationId === undefined || typeof contract.lastOperationId === 'string') &&
		(contract.revision === undefined || Number.isFinite(contract.revision)) &&
		!!contract.selectedConcessions &&
		typeof contract.selectedConcessions === 'object' &&
		!Array.isArray(contract.selectedConcessions) &&
		Object.values(contract.selectedConcessions).every((choice) => typeof choice === 'string') &&
		!!data.snapshot &&
		Array.isArray(data.snapshot.blocks) &&
		Array.isArray(data.snapshot.items) &&
		contract.blockCount === data.snapshot.blocks.length &&
		contract.itemCount === data.snapshot.items.length &&
		data.snapshot.blocks.every((block) =>
			matches(block, (baselineBlock as unknown as { json: Shape }).json)
		) &&
		data.snapshot.items.every(
			(item) =>
				!!item &&
				typeof item._id === 'string' &&
				Number.isFinite(item._creationTime) &&
				matches(item, (playbookItem as unknown as { json: Shape }).json)
		)
	);
}
function result<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}
function completed(transaction: IDBTransaction) {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = transaction.onerror = () => reject(transaction.error);
	});
}
/** Independent disk LRU. Immutable content and frequently updated metadata have separate stores. */
export class SnapshotStorage {
	private namespace = CACHE_NAMESPACE;
	private closed = false;
	private database: Promise<IDBDatabase | undefined> | undefined;
	private lifetime = new AbortController();
	private pending = new Map<string, Write>();
	private pendingBytes = 0;
	private activeBytes = 0;
	private writing = false;
	private open() {
		if (this.closed) return Promise.resolve(undefined);
		return (this.database ??= new Promise((resolve) => {
			const opening = new ReadAttempt(250);
			let settled = false;
			const finish = (db?: IDBDatabase) => {
				if (settled) {
					db?.close();
					return;
				}
				settled = true;
				opening.complete();
				opening.signal.removeEventListener('abort', failed);
				this.lifetime.signal.removeEventListener('abort', failed);
				resolve(db);
			};
			const failed = () => finish();
			opening.signal.addEventListener('abort', failed, { once: true });
			this.lifetime.signal.addEventListener('abort', failed, { once: true });
			try {
				const request = indexedDB.open(`${this.namespace}:snapshots`, 2);
				request.onupgradeneeded = () => {
					// The old combined format is an optional cache; rebuild it on demand.
					if (request.result.objectStoreNames.contains('snapshots'))
						request.result.deleteObjectStore('snapshots');
					request.result.createObjectStore('snapshots', { keyPath: 'id' });
					request.result.createObjectStore('metadata', { keyPath: 'id' });
				};
				request.onblocked = request.onerror = failed;
				request.onsuccess = () => {
					request.result.onversionchange = () => this.close();
					finish(request.result);
				};
			} catch {
				failed();
			}
		}));
	}
	private async transaction<T>(
		db: IDBDatabase,
		mode: IDBTransactionMode,
		work: (tx: IDBTransaction) => Promise<T>,
		cancel?: AbortSignal
	): Promise<T> {
		const attempt = new ReadAttempt(1000);
		const signal = AbortSignal.any([
			this.lifetime.signal,
			attempt.signal,
			...(cancel ? [cancel] : [])
		]);
		let tx: IDBTransaction | undefined;
		const abort = () => {
			try {
				tx?.abort();
			} catch {
				/* Already settled. */
			}
		};
		try {
			signal.throwIfAborted();
			tx = db.transaction(['snapshots', 'metadata'], mode);
			signal.addEventListener('abort', abort, { once: true });
			const done = completed(tx);
			done.catch(() => {});
			const value = await waitForRead(work(tx), signal);
			await waitForRead(done, signal);
			return value;
		} catch (error) {
			abort();
			throw error;
		} finally {
			attempt.complete();
			signal.removeEventListener('abort', abort);
		}
	}
	async get(id: string, signal?: AbortSignal): Promise<SnapshotEntry | undefined> {
		try {
			const db = await this.open();
			if (!db || signal?.aborted) return;
			const [entry, metadata] = await this.transaction(
				db,
				'readonly',
				(tx) =>
					Promise.all([
						result<StoredSnapshot | undefined>(tx.objectStore('snapshots').get(id)),
						result<StoredMetadata | undefined>(tx.objectStore('metadata').get(id))
					]),
				signal
			);
			if (signal?.aborted) return;
			const data =
				entry && metadata
					? { id, status: 'ready' as const, snapshot: entry.snapshot, contract: metadata.contract }
					: undefined;
			const valid =
				data &&
				metadata &&
				Number.isFinite(metadata.bytes) &&
				metadata.bytes >= 0 &&
				metadata.bytes <= SNAPSHOT_BYTES &&
				Number.isFinite(metadata.immutableBytes) &&
				metadata.immutableBytes >= 0 &&
				metadata.immutableBytes <= metadata.bytes &&
				Number.isFinite(metadata.usedAt) &&
				validSnapshot(data, id);
			if (!valid) {
				if (entry || metadata) this.delete(id, () => !signal?.aborted);
				return;
			}
			this.enqueue(id, { kind: 'touch', valid: () => !signal?.aborted });
			return { data, bytes: metadata.bytes, immutableBytes: metadata.immutableBytes };
		} catch {
			return;
		}
	}
	close() {
		this.closed = true;
		this.pending.clear();
		this.pendingBytes = 0;
		this.lifetime.abort();
		void this.database?.then((db) => db?.close());
	}
	private enqueue(id: string, write: Write) {
		if (this.closed || !write.valid()) return;
		const previous = this.pending.get(id);
		if (write.kind === 'touch' && previous) return;
		if (write.kind === 'update' && previous?.kind === 'delete') return;
		if (write.kind === 'update' && previous?.kind === 'put') {
			write = {
				kind: 'put',
				valid: write.valid,
				entry: {
					data: { ...previous.entry.data, contract: write.contract },
					immutableBytes: previous.entry.immutableBytes,
					bytes: previous.entry.immutableBytes + write.bytes
				}
			};
		}
		if (previous) this.pendingBytes -= writeBytes(previous);
		this.pending.delete(id);
		this.pending.set(id, write);
		this.pendingBytes += writeBytes(write);
		// Include the active payload: stalled storage must not retain an unbounded write backlog.
		while (
			this.pending.size > SNAPSHOT_ENTRIES ||
			this.pendingBytes + this.activeBytes > SNAPSHOT_BYTES
		) {
			const oldest = this.pending.keys().next().value!;
			this.pendingBytes -= writeBytes(this.pending.get(oldest)!);
			this.pending.delete(oldest);
		}
		if (!this.writing) void this.drain();
	}
	private async drain() {
		this.writing = true;
		try {
			// Open before taking a payload out of the bounded queue.
			const db = await this.open();
			if (!db) {
				this.pending.clear();
				this.pendingBytes = 0;
				return;
			}
			while (!this.closed && this.pending.size) {
				const [id, write] = this.pending.entries().next().value!;
				this.pending.delete(id);
				this.activeBytes = writeBytes(write);
				this.pendingBytes -= this.activeBytes;
				try {
					if (write.valid())
						await this.transaction(db, 'readwrite', (tx) => this.write(tx, id, write));
				} catch {
					/* Optional cache; failed writes do not affect confirmed server state. */
				} finally {
					this.activeBytes = 0;
				}
			}
		} finally {
			this.writing = false;
		}
	}
	private async write(tx: IDBTransaction, id: string, write: Write) {
		const store = tx.objectStore('metadata');
		if (write.kind === 'delete') {
			store.delete(id);
			tx.objectStore('snapshots').delete(id);
			return;
		}
		if (write.kind === 'put') {
			const { data, bytes, immutableBytes } = write.entry;
			tx.objectStore('snapshots').put({ id, snapshot: data.snapshot });
			store.put({ id, contract: data.contract, bytes, immutableBytes, usedAt: Date.now() });
		} else {
			const metadata = await result<StoredMetadata | undefined>(store.get(id));
			if (!metadata || !write.valid()) return;
			store.put(
				write.kind === 'touch'
					? { ...metadata, usedAt: Date.now() }
					: {
							...metadata,
							contract: write.contract,
							bytes: metadata.immutableBytes + write.bytes,
							usedAt: Date.now()
						}
			);
		}
		if (write.kind !== 'touch') await this.enforceLimits(tx);
	}
	private async enforceLimits(tx: IDBTransaction) {
		const store = tx.objectStore('metadata');
		const entries = await result<StoredMetadata[]>(store.getAll());
		let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
		let count = entries.length;
		for (const entry of entries.sort((a, b) => a.usedAt - b.usedAt)) {
			if (count <= SNAPSHOT_ENTRIES && total <= SNAPSHOT_BYTES) break;
			store.delete(entry.id);
			tx.objectStore('snapshots').delete(entry.id);
			total -= entry.bytes;
			count--;
		}
	}
	put(entry: SnapshotEntry, valid: () => boolean) {
		const { data, bytes, immutableBytes } = entry;
		this.enqueue(data.id!, { kind: 'put', entry: { data, bytes, immutableBytes }, valid });
	}
	updateContract(
		id: string,
		contract: ReadyContract['contract'],
		bytes: number,
		valid: () => boolean
	) {
		this.enqueue(id, { kind: 'update', contract, bytes, valid });
	}
	delete(id: string, valid: () => boolean = () => true) {
		this.enqueue(id, { kind: 'delete', valid });
	}
}
