import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import type { SavedContractCard } from './card';
import type { Id } from '../../convex/_generated/dataModel';
export let CACHE_NAMESPACE = `agreed:v2:${env.PUBLIC_CONVEX_URL ?? ''}:anonymous`;
export let CACHE_MEMBERSHIP_ID: Id<'memberships'> | null = null;
const openingsKey = () => `${CACHE_NAMESPACE}:openings`;
type Opening = { id: string; openedAt: number };
let openings: Opening[] | undefined;

function read(key: string): unknown {
	try {
		return browser ? JSON.parse(localStorage.getItem(key) ?? 'null') : null;
	} catch {
		return null;
	}
}
function write(key: string, value: unknown) {
	try {
		if (browser) localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* Optional cache. */
	}
}
export function recentOpenings(): readonly Opening[] {
	if (!browser) return [];
	if (!openings) {
		const value = read(openingsKey());
		openings = Array.isArray(value)
			? value
					.filter(
						(entry): entry is Opening =>
							!!entry && typeof entry.id === 'string' && Number.isFinite(entry.openedAt)
					)
					.sort((a, b) => b.openedAt - a.openedAt)
					.slice(0, 50)
			: [];
	}
	return openings;
}
export function recordOpening(id: string) {
	openings = [
		{ id, openedAt: Date.now() },
		...recentOpenings().filter((entry) => entry.id !== id)
	].slice(0, 50);
	write(openingsKey(), openings);
}
export function forgetOpening(id: string) {
	openings = recentOpenings().filter((entry) => entry.id !== id);
	write(openingsKey(), openings);
}
/** Preparation order only; Home keeps the server's display order. */
export function rankCards(
	cards: readonly SavedContractCard[],
	promoted: readonly string[] = []
): string[] {
	const history = new Map(recentOpenings().map((entry) => [entry.id, entry.openedAt]));
	return cards
		.map((card, order) => ({ card, order }))
		.sort(
			(a, b) =>
				Number(promoted.includes(b.card._id)) - Number(promoted.includes(a.card._id)) ||
				(history.get(b.card._id) ?? 0) - (history.get(a.card._id) ?? 0) ||
				b.card.savedAt - a.card.savedAt ||
				a.order - b.order
		)
		.map(({ card }) => card._id);
}

export function setCacheIdentity(
	identity: { profileId: Id<'profiles'>; membershipId: Id<'memberships'> } | null
) {
	const next = `agreed:v2:${env.PUBLIC_CONVEX_URL ?? ''}:${identity ? `${identity.profileId}:${identity.membershipId}` : 'anonymous'}`;
	CACHE_MEMBERSHIP_ID = identity?.membershipId ?? null;
	if (next === CACHE_NAMESPACE) return;
	if (browser) {
		try {
			localStorage.removeItem(`${CACHE_NAMESPACE}:cards`);
			localStorage.removeItem(openingsKey());
			// Discard the former anonymous caches as well as the previous session.
			const old = `agreed:v1:${env.PUBLIC_CONVEX_URL ?? ''}`;
			localStorage.removeItem(`${old}:cards`);
			localStorage.removeItem(`${old}:openings`);
			indexedDB.deleteDatabase(`${old}:snapshots`);
			indexedDB.deleteDatabase(`${CACHE_NAMESPACE}:snapshots`);
		} catch {
			/* Optional cache. */
		}
	}
	openings = undefined;
	CACHE_NAMESPACE = next;
}
