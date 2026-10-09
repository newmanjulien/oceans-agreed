import { browser } from '$app/environment';
import { preloadCode } from '$app/navigation';
import { recordColdStart } from '$lib/document/runtime/render-perf';
import { readContract } from './read';
import {
	SnapshotStorage,
	validSnapshot,
	SNAPSHOT_ENTRIES,
	SNAPSHOT_BYTES
} from './snapshot-storage';
import type { SnapshotEntry, SnapshotSize } from './snapshot-storage';
import { forgetOpening, CACHE_MEMBERSHIP_ID, setCacheIdentity } from './browser-storage';
import { ReadAttempt, waitForRead } from '$lib/auth/attempt';
import type { ContractRouteData, ContractState } from './saved';

type ReadyContract = Extract<ContractRouteData, { status: 'ready' }>;
type Entry = SnapshotEntry & { contractJson: string };
type Flight = { result: Promise<ContractRouteData>; attempt: ReadAttempt; background: boolean };
const MAX_ENTRIES = SNAPSHOT_ENTRIES;
const MAX_BYTES = SNAPSHOT_BYTES;
const BACKGROUND_CONCURRENCY = 2;

/** Browser-only, membership-scoped snapshots. Mutable state is refreshed on every open. */
class ContractSnapshotCache {
	private readonly membershipId = CACHE_MEMBERSHIP_ID;
	private disk = new SnapshotStorage();
	private deleted = new Set<string>();
	private entries = new Map<string, Entry>();
	private versions = new Map<
		string,
		{ snapshot: ReadyContract['snapshot']; bytes: number; references: number }
	>();
	private flights = new Map<string, Flight>();
	private queued = new Set<string>();
	private bytes = 0;
	private ready = false;
	private lifetime = new AbortController();
	private code: Promise<void> | undefined;
	private listeners = new Set<(data: ReadyContract) => void>();
	private evictions = new Set<(id: string) => void>();
	private failures = new Set<(id: string) => void>();
	private visibility = () => this.pump();
	constructor() {
		document.addEventListener('visibilitychange', this.visibility);
	}
	subscribe(
		listener: (data: ReadyContract) => void,
		evict: (id: string) => void,
		failed: (id: string) => void
	) {
		this.listeners.add(listener);
		this.evictions.add(evict);
		this.failures.add(failed);
		return () => {
			this.listeners.delete(listener);
			this.evictions.delete(evict);
			this.failures.delete(failed);
		};
	}
	peek(id: string) {
		return this.entries.get(id)?.data;
	}

	/** Seeds only a server-confirmed contract; snapshot identity survives the route handoff. */
	seedConfirmed(data: ReadyContract): ReadyContract | undefined {
		const id = data.id!;
		if (this.deleted.has(id) || this.lifetime.signal.aborted || !validSnapshot(data, id)) return;
		const existing = this.peek(id);
		if (existing) {
			if (existing.contract.templateVersionId !== data.contract.templateVersionId) return;
			return (
				this.updateState(id, {
					...data.contract,
					revision: data.contract.revision ?? 0,
					lastOperationId: data.contract.lastOperationId ?? null
				}) ?? existing
			);
		}
		this.cancelFlight(id, false);
		this.queued.delete(id);
		const entry = this.remember(id, data);
		if (entry) this.disk.put(entry, () => !this.deleted.has(id) && !this.lifetime.signal.aborted);
		const confirmed = entry?.data ?? data;
		for (const listener of this.listeners) listener(confirmed);
		return confirmed;
	}

	allowBackground() {
		this.ready = true;
		this.pump();
	}
	pauseBackground() {
		this.ready = false;
	}

	/** Fetch exactly the resources selected by the preparation policy, in priority order. */
	backgroundCandidates(ids: readonly string[]) {
		if (this.lifetime.signal.aborted) return;
		const selected = new Set(ids);
		for (const [id, flight] of this.flights)
			if (flight.background && !selected.has(id)) this.cancelFlight(id, false);
		this.queued = new Set(
			ids.filter((id) => !this.deleted.has(id) && !this.touch(id) && !this.flights.has(id))
		);
		this.pump();
	}

	/** Confirmed deletion, distinct from memory eviction. */
	remove(id: string) {
		if (this.deleted.has(id) || this.lifetime.signal.aborted) return;
		this.deleted.add(id);
		this.evict(id);
		this.disk.delete(id);
		forgetOpening(id);
		for (const listener of this.evictions) listener(id);
	}
	isDeleted(id: string) {
		return this.deleted.has(id);
	}
	rename(id: string, companyName: string) {
		if (this.lifetime.signal.aborted) return;
		const entry = this.peek(id);
		if (entry)
			this.updateState(id, {
				...entry.contract,
				companyName,
				revision: entry.contract.revision ?? 0,
				lastOperationId: entry.contract.lastOperationId ?? null
			});
	}
	private forgetEntry(id: string) {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.bytes -= entry.bytes - entry.immutableBytes;
		const versionId = entry.data.contract.templateVersionId;
		const version = this.versions.get(versionId)!;
		if (--version.references === 0) {
			this.bytes -= version.bytes;
			this.versions.delete(versionId);
		}
		this.entries.delete(id);
	}
	private evict(id: string) {
		this.forgetEntry(id);
		this.queued.delete(id);
		this.cancelFlight(id);
	}

	private touch(id: string) {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.entries.delete(id);
		this.entries.set(id, entry);
		return entry.data;
	}

	private enforceLimits() {
		while (this.entries.size > MAX_ENTRIES || this.bytes > MAX_BYTES) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.evict(oldest);
		}
	}

	private remember(id: string, data: ReadyContract, size?: SnapshotSize) {
		const versionId = data.contract.templateVersionId;
		const shared = this.versions.get(versionId);
		const contractJson = JSON.stringify(data.contract);
		const immutableBytes =
			shared?.bytes ?? size?.immutableBytes ?? JSON.stringify(data.snapshot).length * 2;
		const bytes = immutableBytes + contractJson.length * 2;
		this.forgetEntry(id);
		if (bytes > MAX_BYTES) return;
		const version = shared ?? { snapshot: data.snapshot, bytes: immutableBytes, references: 0 };
		if (!this.versions.has(versionId)) {
			this.versions.set(versionId, version);
			this.bytes += immutableBytes;
		}
		version.references++;
		if (data.snapshot !== version.snapshot) data = { ...data, snapshot: version.snapshot };
		const entry = { data, bytes, immutableBytes, contractJson };
		this.entries.set(id, entry);
		this.bytes += contractJson.length * 2;
		this.enforceLimits();
		return entry;
	}

	/** Only confirmed server state belongs here. Never inserts a missing entry. */
	updateState(id: string, state: ContractState) {
		const entry = this.entries.get(id);
		if (!entry || this.deleted.has(id) || this.lifetime.signal.aborted) return;
		const previous = entry.data.contract;
		const revision = previous.revision ?? 0;
		if (state.revision < revision) return entry.data;
		const { reviews: _reviews, ...contentState } = state;
		const contract = {
			...previous,
			...contentState,
			lastOperationId: state.lastOperationId ?? undefined
		};
		const contractJson = JSON.stringify(contract);
		if (contractJson === entry.contractJson) return entry.data;
		const contractBytes = contractJson.length * 2;
		const bytes = entry.immutableBytes + contractBytes;
		this.bytes += bytes - entry.bytes;
		entry.bytes = bytes;
		entry.contractJson = contractJson;
		entry.data = { ...entry.data, contract };
		this.disk.updateContract(
			id,
			contract,
			contractBytes,
			() => !this.deleted.has(id) && !this.lifetime.signal.aborted
		);
		this.enforceLimits();
		if (this.entries.get(id) === entry) for (const listener of this.listeners) listener(entry.data);
		return entry.data;
	}

	private cancelFlight(id: string, failed = true) {
		const flight = this.flights.get(id);
		if (!flight) return;
		this.flights.delete(id);
		flight.attempt.abort();
		if (failed) for (const listener of this.failures) listener(id);
	}

	/** Cancel reads and queued work without discarding confirmed snapshots or writes. */
	cancelPending() {
		this.pauseBackground();
		this.queued.clear();
		for (const id of this.flights.keys()) this.cancelFlight(id);
	}

	private fetchFull(id: string, request: typeof fetch, background = false) {
		if (this.deleted.has(id)) return Promise.resolve({ id, status: 'missing' } as const);
		if (this.lifetime.signal.aborted) return Promise.resolve({ id, status: 'error' } as const);
		const existing = this.flights.get(id);
		if (existing) return existing.result;
		this.queued.delete(id);
		const attempt = new ReadAttempt(15_000);
		const signal = AbortSignal.any([this.lifetime.signal, attempt.signal]);
		const flight: Flight = {
			attempt,
			background,
			result: Promise.resolve({ id, status: 'error' })
		};
		const work = Promise.resolve().then(async () => {
			signal.throwIfAborted();
			const diskAttempt = new ReadAttempt(250);
			const diskSignal = AbortSignal.any([signal, diskAttempt.signal]);
			let persisted: SnapshotEntry | undefined;
			try {
				persisted = await waitForRead(this.disk.get(id, diskSignal), diskSignal);
			} catch {
				signal.throwIfAborted();
				// IndexedDB is optional. A failed or stalled read falls through to the network.
			} finally {
				diskAttempt.complete();
			}
			signal.throwIfAborted();
			if (this.deleted.has(id)) return { id, status: 'missing' } as const;
			recordColdStart(persisted ? 'contract-disk-cache-hit' : 'contract-snapshot-fetch-start');
			if (!this.membershipId) throw new Error('Company access is required.');
			const result =
				persisted?.data ??
				(await waitForRead(readContract(request, id, this.membershipId, signal), signal));
			signal.throwIfAborted();
			if (!persisted && result.status === 'ready' && !validSnapshot(result, id))
				throw new Error('Invalid snapshot');
			if (this.flights.get(id) !== flight) throw new Error('The request was replaced.');
			if (result.status === 'missing') {
				this.flights.delete(id);
				this.remove(id);
			}
			if (result.status === 'ready') {
				if (this.deleted.has(id)) return { id, status: 'missing' } as const;
				const entry = this.remember(id, result, persisted);
				if (!persisted && entry)
					this.disk.put(entry, () => !this.deleted.has(id) && !this.lifetime.signal.aborted);
				recordColdStart('contract-snapshot-cached');
				for (const listener of this.listeners) listener(this.entries.get(id)?.data ?? result);
			}
			if (result.status === 'error') for (const listener of this.failures) listener(id);
			return result.status === 'ready' ? (this.peek(id) ?? result) : result;
		});
		flight.result = waitForRead(work, signal)
			.catch(() => {
				if (this.flights.get(id) === flight) for (const listener of this.failures) listener(id);
				return { id, status: 'error' } as const;
			})
			.finally(() => {
				attempt.complete();
				if (this.flights.get(id) === flight) this.flights.delete(id);
				this.pump();
			});
		this.flights.set(id, flight);
		return flight.result;
	}

	private pump() {
		if (this.lifetime.signal.aborted || !this.ready || document.hidden) return;
		while (
			[...this.flights.values()].filter((flight) => flight.background).length <
				BACKGROUND_CONCURRENCY &&
			this.queued.size
		) {
			const id = this.queued.values().next().value!;
			this.queued.delete(id);
			if (this.deleted.has(id) || this.entries.has(id) || this.flights.has(id)) continue;
			// All saved contracts share route code. Do not run its loader speculatively.
			this.code ??= preloadCode(`/contracts/${id}`).catch(() => {
				this.code = undefined;
			});
			void this.fetchFull(id, fetch, true);
		}
	}

	load(
		id: string,
		request: typeof fetch = fetch,
		options: { restart?: boolean } = {}
	): Promise<ContractRouteData> {
		this.pauseBackground();
		this.queued.delete(id);
		for (const [otherId, flight] of this.flights) {
			if (otherId !== id && flight.background) this.cancelFlight(otherId);
		}
		if (options.restart) this.cancelFlight(id);
		const pending = this.flights.get(id);
		if (pending) pending.background = false;
		if (this.deleted.has(id)) return Promise.resolve({ id, status: 'missing' });
		const cached = this.touch(id);
		if (cached) {
			recordColdStart('contract-cache-hit');
			return Promise.resolve(cached);
		}
		recordColdStart('contract-cache-miss');
		return this.fetchFull(id, request);
	}

	destroy() {
		document.removeEventListener('visibilitychange', this.visibility);
		this.listeners.clear();
		this.evictions.clear();
		this.failures.clear();
		this.lifetime.abort();
		this.disk.close();
		this.flights.clear();
		this.entries.clear();
		this.versions.clear();
		this.queued.clear();
		this.bytes = 0;
	}
}

let cache: ContractSnapshotCache | undefined;
export function getContractSnapshotCache() {
	if (!browser) throw new Error('Contract snapshot cache is browser-only.');
	return (cache ??= new ContractSnapshotCache());
}

export function cancelPendingContractSnapshots() {
	cache?.cancelPending();
}

export function releaseContractSnapshotCache() {
	cache?.destroy();
	cache = undefined;
}

/** Registered once with the root session; it survives entry/workspace navigation. */
export const contractCacheResources = {
	cancelReads: cancelPendingContractSnapshots,
	clear: () => {
		releaseContractSnapshotCache();
		setCacheIdentity(null);
	}
};
