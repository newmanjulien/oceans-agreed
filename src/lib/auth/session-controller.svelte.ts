import type { SessionEditor, SessionPhase } from './viewer-session.svelte';
import { beginStartupAttempt, recordStartup } from './startup-perf';
import { ReadAttempt } from './attempt';

/** Owns protected workspace admission and session recovery across routed editors. */
export class SessionController {
	phase = $state<SessionPhase>('loading');
	error = $state('');
	delayed = $state(false);
	transportGeneration = $state(0);
	prepared = $state<string | null>();
	userId = $state<string | null>(null);
	admitted = $state(false);
	private destinationReady = false;
	private destinationError = '';
	private readAttempt: ReadAttempt | undefined;
	private readFailed = false;
	private authLoading = true;
	private authenticated = false;
	private workspaceReady = false;
	private workspaceError = '';
	private editors = new Set<SessionEditor>();
	private generation = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private attempt: Promise<void> | null = null;
	private disposed = false;
	constructor(
		private actions: {
			signOut: () => Promise<void>;
			login: (recover: boolean) => Promise<void>;
			clear: () => void;
			cancelReads: () => void;
		}
	) {}

	get closing() {
		return this.phase === 'signed-out';
	}
	get blocked() {
		return this.phase !== 'ready';
	}
	start() {
		this.startReadAttempt();
		this.startTimer();
	}
	private setPhase(phase: SessionPhase) {
		if (this.phase === phase) return;
		this.phase = phase;
		this.startReadAttempt();
		this.startTimer();
		this.syncEditors();
	}
	private startReadAttempt() {
		const previous = this.readAttempt;
		this.readAttempt = undefined;
		previous?.abort();
		if (!['loading', 'authenticating', 'preparing'].includes(this.phase)) return;
		const attempt = new ReadAttempt(15_000);
		this.readAttempt = attempt;
		attempt.signal.addEventListener(
			'abort',
			() => {
				if (this.disposed || this.readAttempt !== attempt) return;
				this.readAttempt = undefined;
				this.readFailed = true;
				this.error = 'We couldn’t connect your account. Try again or log out.';
				this.actions.cancelReads();
				this.setPhase('authentication-error');
			},
			{ once: true }
		);
	}
	private startTimer() {
		if (
			['loading', 'authenticating', 'preparing', 'saving-before-logout', 'signing-out'].includes(
				this.phase
			)
		) {
			if (this.timer || this.delayed) return;
			this.timer = setTimeout(() => {
				this.timer = undefined;
				this.delayed = true;
			}, 10_000);
		} else {
			clearTimeout(this.timer);
			this.timer = undefined;
			this.delayed = false;
		}
	}
	private syncEditors() {
		for (const editor of this.editors) {
			editor.freeze(this.blocked);
			if (
				this.authenticated &&
				!this.authLoading &&
				this.workspaceReady &&
				!this.workspaceError &&
				['ready', 'saving-before-logout'].includes(this.phase)
			)
				editor.resume();
			else editor.suspend();
		}
	}
	registerEditor(editor: SessionEditor) {
		this.editors.add(editor);
		this.syncEditors();
		return () => this.editors.delete(editor);
	}
	identity(sessionId: string | null, userId: string | null, loaded: boolean) {
		if (!loaded) return;
		if (this.prepared === sessionId && this.userId === userId) return;
		const previous = this.prepared;
		this.readFailed = false;
		const voluntary = this.phase === 'signing-out';
		this.generation++;
		this.actions.cancelReads();
		this.transportGeneration++;
		this.attempt = null;
		for (const editor of this.editors) {
			editor.suspend();
			editor.restartTransport();
		}
		this.authLoading = true;
		this.authenticated = false;
		this.workspaceReady = false;
		this.destinationReady = false;
		this.destinationError = '';
		this.admitted = false;
		this.workspaceError = '';
		this.error = '';
		this.prepared = sessionId;
		this.userId = userId;
		if (sessionId) {
			this.setPhase('authenticating');
			this.startReadAttempt();
		} else if (previous) this.end(!voluntary);
		else this.setPhase('signed-out');
	}
	reportAuth(loading: boolean, authenticated: boolean) {
		this.authLoading = loading;
		this.authenticated = authenticated;
		this.updatePhase();
	}
	reportWorkspace(ready: boolean, error = '') {
		this.workspaceReady = ready;
		this.workspaceError = error;
		this.updatePhase();
	}
	reportDestination(ready: boolean, error = '') {
		this.destinationReady = ready;
		this.destinationError = error;
		this.updatePhase();
	}
	private updatePhase() {
		if (this.readFailed) {
			this.syncEditors();
			return;
		}
		if (['saving-before-logout', 'signing-out', 'signed-out'].includes(this.phase)) {
			this.syncEditors();
			return;
		}
		if (this.authLoading) this.setPhase('authenticating');
		else if (!this.authenticated) this.setPhase('authentication-error');
		else if (this.workspaceError || this.destinationError) this.setPhase('authentication-error');
		else this.setPhase(this.workspaceReady && this.destinationReady ? 'ready' : 'preparing');
		if (this.phase === 'ready' && !this.admitted) {
			this.admitted = true;
			recordStartup('usable');
		}
		this.syncEditors();
	}
	get authenticationError() {
		return (
			this.error ||
			this.workspaceError ||
			this.destinationError ||
			'We couldn’t connect your account. Try again or log out.'
		);
	}
	retryAuth() {
		if (this.attempt || !this.prepared || this.disposed) return;
		this.actions.cancelReads();
		this.readFailed = false;
		beginStartupAttempt();
		this.authLoading = true;
		this.authenticated = false;
		this.workspaceReady = false;
		this.workspaceError = '';
		this.error = '';
		this.setPhase('authenticating');
		this.startReadAttempt();
		this.destinationError = '';
		for (const editor of this.editors) editor.restartTransport();
		this.transportGeneration++;
	}
	signOut() {
		if (this.attempt || this.phase === 'signed-out' || this.disposed)
			return this.attempt ?? Promise.resolve();
		const generation = ++this.generation;
		this.error = '';
		this.setPhase('saving-before-logout');
		const work = this.runSignOut(generation);
		this.attempt = work;
		void work.finally(() => {
			if (this.attempt === work) this.attempt = null;
		});
		return work;
	}
	private current(generation: number) {
		return !this.disposed && generation === this.generation;
	}
	private async runSignOut(generation: number) {
		// Assign the shared attempt before any provider call can change identity.
		await Promise.resolve();
		try {
			for (const editor of this.editors) {
				if (!this.current(generation)) return;
				editor.retry();
				if (editor.pending && !(await editor.flush())) {
					if (this.current(generation))
						this.error = 'Your changes haven’t been saved. Retry, cancel logout, or discard them.';
					return;
				}
			}
			if (!this.current(generation)) return;
			this.setPhase('signing-out');
			await this.actions.signOut();
			if (this.current(generation)) this.end(false);
		} catch {
			if (!this.current(generation)) return;
			this.error = 'Unable to log out. Please try again.';
			this.setPhase(this.readFailed ? 'authentication-error' : 'preparing');
			this.updatePhase();
		}
	}
	cancelSignOut() {
		if (this.phase !== 'saving-before-logout') return;
		this.generation++;
		this.attempt = null;
		this.error = '';
		this.setPhase(this.readFailed ? 'authentication-error' : 'preparing');
		this.updatePhase();
	}
	discardAndSignOut() {
		if (this.phase !== 'saving-before-logout') return;
		this.generation++;
		this.attempt = null;
		for (const editor of this.editors) editor.suspend();
		for (const editor of this.editors) editor.discard();
		void this.signOut();
	}
	reset(recover = true) {
		if (this.phase !== 'signed-out') this.end(recover);
		else this.navigate(recover);
	}
	private end(recover: boolean) {
		this.generation++;
		this.attempt = null;
		this.admitted = false;
		this.readFailed = false;
		this.setPhase('signed-out');
		this.actions.clear();
		this.navigate(recover);
	}
	private navigate(recover: boolean) {
		const generation = this.generation;
		void this.actions.login(recover).catch(() => {
			if (this.current(generation)) this.error = 'We couldn’t open the login page.';
		});
	}
	returnToLogin() {
		this.navigate(false);
	}
	dismissError() {
		this.error = '';
	}
	destroy() {
		this.disposed = true;
		this.readAttempt?.abort();
		this.actions.cancelReads();
		this.generation++;
		clearTimeout(this.timer);
		for (const editor of this.editors) editor.suspend();
	}
}
