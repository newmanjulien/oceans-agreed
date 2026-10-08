/** A replaceable read attempt. Aborting settles waiters even when a dependency ignores its signal. */
export class ReadAttempt {
	readonly controller = new AbortController();
	readonly signal = this.controller.signal;
	private timer: ReturnType<typeof setTimeout> | undefined;
	constructor(timeoutMs: number) {
		this.timer = setTimeout(() => this.abort(new Error('The request timed out.')), timeoutMs);
	}
	complete() {
		clearTimeout(this.timer);
		this.timer = undefined;
	}
	abort(reason: unknown = new Error('The request was replaced.')) {
		this.complete();
		this.controller.abort(reason);
	}
}

export function waitForRead<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		if (signal.aborted) abort();
		else signal.addEventListener('abort', abort, { once: true });
		Promise.resolve(work).then(
			(value) => {
				signal.removeEventListener('abort', abort);
				if (!signal.aborted) resolve(value);
			},
			(error) => {
				signal.removeEventListener('abort', abort);
				reject(error);
			}
		);
	});
}
