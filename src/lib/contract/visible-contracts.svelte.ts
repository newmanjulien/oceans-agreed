import type { Action } from 'svelte/action';
import { untrack } from 'svelte';
import { observeHomeWarming } from '$lib/document/runtime/render-perf';
import { getDocumentResources } from '$lib/document/runtime/resources.svelte';
import { getContractSnapshotCache } from './snapshot-cache';
import { rankCards } from './browser-storage';
import type { SavedContractCard } from './card';
import { afterStartupPaint } from '$lib/auth/startup-perf';

/** One viewport observer and one preparation policy for both Home and search. */
export function createVisibleContractWarming() {
	const resources = getDocumentResources();
	const cards = new Map<Element, SavedContractCard>();
	const visible = new Set<string>();
	const promoted = new Set<string>();
	let pending = true;
	let enabled = false;
	let cancelStart: (() => void) | undefined;
	let releaseObservation: (() => void) | undefined;
	let destroyed = false;
	let observer: IntersectionObserver | undefined;
	let cache: ReturnType<typeof getContractSnapshotCache> | undefined;
	$effect(() => {
		const ids = resources?.preparationCandidates ?? [];
		untrack(() => {
			if (destroyed) return;
			cache?.backgroundCandidates(ids);
			for (const id of ids) {
				const data = cache?.peek(id);
				if (data) resources?.prepare(data);
			}
		});
	});
	function candidates() {
		if (destroyed) return;
		const ranked = rankCards(
			[...cards.entries()]
				.filter(([, card]) => visible.has(card._id))
				.sort(([a], [b]) =>
					a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
				)
				.map(([, card]) => card),
			[...promoted]
		);
		const ids = !enabled || pending ? [] : ranked;
		resources?.candidates(ids);
	}
	const observe: Action<HTMLElement, SavedContractCard> = (node, card) => {
		releaseObservation ??= observeHomeWarming();
		cache ??= getContractSnapshotCache();
		if (typeof IntersectionObserver !== 'undefined') {
			observer ??= new IntersectionObserver((entries) => {
				for (const entry of entries) {
					const card = cards.get(entry.target);
					if (!card) continue;
					if (entry.isIntersecting) {
						visible.add(card._id);
					} else {
						visible.delete(card._id);
					}
				}
				candidates();
			});
		}
		cards.set(node, card);
		if (observer) observer.observe(node);
		else {
			visible.add(card._id);
			candidates();
		}
		return {
			update(next) {
				card = next;
				cards.set(node, next);
				candidates();
			},
			destroy() {
				observer?.unobserve(node);
				cards.delete(node);
				visible.delete(card._id);
				promoted.delete(card._id);
				candidates();
			}
		};
	};
	return {
		observe,
		pending(value: boolean) {
			if (pending === value) return;
			pending = value;
			cancelStart?.();
			cancelStart = undefined;
			enabled = false;
			cache ??= getContractSnapshotCache();
			cache.pauseBackground();
			if (resources) resources.backgroundEnabled = false;
			if (!value) {
				cancelStart = afterStartupPaint(() => {
					const start = () => {
						if (destroyed || pending) return;
						enabled = true;
						if (resources) resources.backgroundEnabled = true;
						candidates();
						cache?.allowBackground();
					};
					if ('requestIdleCallback' in window) {
						const idle = window.requestIdleCallback(start, { timeout: 2000 });
						cancelStart = () => window.cancelIdleCallback(idle);
					} else {
						const timer = setTimeout(start, 100);
						cancelStart = () => clearTimeout(timer);
					}
				});
			}
			candidates();
		},
		warm(id: string) {
			resources?.promote(id);
			promoted.add(id);
			visible.add(id);
			candidates();
		},
		cool(id: string) {
			if (promoted.delete(id)) candidates();
		},
		destroy() {
			destroyed = true;
			cancelStart?.();
			cache?.pauseBackground();
			if (resources) resources.backgroundEnabled = false;
			releaseObservation?.();
			observer?.disconnect();
			cache?.backgroundCandidates([]);
			cards.clear();
			visible.clear();
			promoted.clear();
			resources?.candidates([]);
		}
	};
}
