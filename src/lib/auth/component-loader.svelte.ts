import { untrack } from 'svelte';
import { ReadAttempt, waitForRead } from './attempt';

/** Load code independently of admission; only the caller decides when to mount it. */
export function loadComponent<T extends { default: unknown }>(
	load: () => Promise<T>,
	enabled: () => boolean,
	generation: () => unknown = () => undefined,
	onLoad?: (module: T) => void
) {
	let component = $state.raw<T['default']>();
	let failed = $state(false);
	let retry = $state(0);
	$effect(() => {
		generation();
		void retry;
		if (!enabled() || component) return;
		const read = new ReadAttempt(15_000);
		let active = true;
		untrack(() => (failed = false));
		void waitForRead(load(), read.signal)
			.then((loaded) => {
				if (active) {
					onLoad?.(loaded);
					component = loaded.default;
				}
			})
			.catch(() => {
				if (active) failed = true;
			})
			.finally(() => read.complete());
		return () => {
			active = false;
			read.abort();
		};
	});
	return {
		get component() {
			return component;
		},
		get failed() {
			return failed;
		},
		retry: () => retry++
	};
}
