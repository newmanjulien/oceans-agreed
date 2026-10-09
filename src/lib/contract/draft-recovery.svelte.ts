import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import type { ContractState, SavedSelections } from './saved';
import type { ContractSaveRequest } from './persistence.svelte';
import { MAX_SELECTED_CONCESSIONS } from './selection-limits';

export type ContractDraft = {
	version: 1;
	base: ContractState;
	choices: SavedSelections;
	lifecycles?: Record<string, string>;
	request: ContractSaveRequest | null;
	conflict: boolean;
};
const memory = new Map<string, ContractDraft>();
const volatileKeys = new Set<string>();
const deletedUsers = new Set<string>();
const removedMemberships = new Set<string>();
const prefix = (userId: string) =>
	`agreed:drafts:v1:${encodeURIComponent(env.PUBLIC_CONVEX_URL ?? '')}:${encodeURIComponent(userId)}:`;

function selections(value: unknown): value is SavedSelections {
	return Boolean(
		value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).length <= MAX_SELECTED_CONCESSIONS &&
		Object.entries(value).every(([id, choice]) => id.length > 0 && typeof choice === 'string')
	);
}
function lifecycle(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= 300;
}
function lifecycles(value: unknown) {
	return value === undefined || (selections(value) && Object.values(value).every(lifecycle));
}
function reviews(value: unknown) {
	return (
		value === undefined ||
		Boolean(
			value &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			Object.keys(value).length <= MAX_SELECTED_CONCESSIONS &&
			Object.entries(value).every(
				([id, review]) =>
					id.length > 0 &&
					review &&
					typeof review === 'object' &&
					!Array.isArray(review) &&
					typeof review.concessionId === 'string' &&
					lifecycle(review.lifecycle) &&
					['pending', 'approved', 'rejected'].includes(review.status)
			)
		)
	);
}
function valid(value: unknown, id: string): value is ContractDraft {
	const draft = value as ContractDraft | null;
	return Boolean(
		draft?.version === 1 &&
		typeof draft.conflict === 'boolean' &&
		draft.base &&
		typeof draft.base.companyName === 'string' &&
		Number.isSafeInteger(draft.base.revision) &&
		draft.base.revision >= 0 &&
		(draft.base.lastOperationId === null || typeof draft.base.lastOperationId === 'string') &&
		selections(draft.base.selectedConcessions) &&
		reviews(draft.base.reviews) &&
		selections(draft.choices) &&
		lifecycles(draft.lifecycles) &&
		(draft.request === null ||
			(draft.request?.id === id &&
				Number.isSafeInteger(draft.request.expectedRevision) &&
				draft.request.expectedRevision >= 0 &&
				typeof draft.request.operationId === 'string' &&
				draft.request.operationId.trim().length > 0 &&
				draft.request.operationId.length <= 200 &&
				selections(draft.request.selectedConcessions) &&
				lifecycles(draft.request.selectionLifecycles)))
	);
}

/** Recovery is separate from the optional, server-confirmed snapshot cache. */
export class DraftJournal {
	memoryOnly = $state(false);
	private key: string;
	private namespace: string;
	constructor(
		private userId: string,
		private contractId: string,
		membershipId?: string
	) {
		this.namespace = prefix(userId) + (membershipId ? encodeURIComponent(membershipId) + ':' : '');
		this.key = this.namespace + encodeURIComponent(contractId);
	}
	read(): ContractDraft | null {
		if (!browser || deletedUsers.has(this.userId) || removedMemberships.has(this.namespace))
			return null;
		this.memoryOnly = volatileKeys.has(this.key);
		if (memory.has(this.key)) return structuredClone(memory.get(this.key)!);
		try {
			const value: unknown = JSON.parse(sessionStorage.getItem(this.key) ?? 'null');
			if (valid(value, this.contractId)) {
				memory.set(this.key, value);
				return structuredClone(value);
			}
		} catch {
			this.memoryOnly = true;
			volatileKeys.add(this.key);
		}
		return null;
	}
	write(draft: ContractDraft | null) {
		if (!browser || deletedUsers.has(this.userId) || removedMemberships.has(this.namespace)) return;
		if (draft) memory.set(this.key, structuredClone(draft));
		else memory.delete(this.key);
		try {
			if (draft) sessionStorage.setItem(this.key, JSON.stringify(draft));
			else sessionStorage.removeItem(this.key);
			this.memoryOnly = false;
			volatileKeys.delete(this.key);
		} catch {
			this.memoryOnly = true;
			volatileKeys.add(this.key);
			// Remove a stale checkpoint when a replacement cannot be persisted.
			try {
				sessionStorage.removeItem(this.key);
			} catch {
				/* Storage unavailable. */
			}
		}
	}
}

export function discardUserDrafts(userId: string) {
	deletedUsers.add(userId);
	discardNamespace(prefix(userId));
}

export function discardMembershipDrafts(userId: string, membershipId: string) {
	const namespace = prefix(userId) + encodeURIComponent(membershipId) + ':';
	removedMemberships.add(namespace);
	discardNamespace(namespace);
}

function discardNamespace(namespace: string) {
	for (const key of memory.keys()) if (key.startsWith(namespace)) memory.delete(key);
	for (const key of volatileKeys) if (key.startsWith(namespace)) volatileKeys.delete(key);
	if (!browser) return;
	try {
		for (let i = sessionStorage.length - 1; i >= 0; i--) {
			const key = sessionStorage.key(i);
			if (key?.startsWith(namespace)) sessionStorage.removeItem(key);
		}
	} catch {
		/* This namespace remains invalidated even when storage is unavailable. */
	}
}
