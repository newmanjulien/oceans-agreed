import { getContext, setContext } from 'svelte';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../convex/_generated/api';
export type Viewer = NonNullable<FunctionReturnType<typeof api.profiles.viewer>>;
const sessionKey = Symbol('viewerSession');
const viewerKey = Symbol('viewer');
export type SessionPhase =
	| 'loading'
	| 'authenticating'
	| 'preparing'
	| 'ready'
	| 'saving-before-logout'
	| 'signing-out'
	| 'authentication-error'
	| 'signed-out';
export type SessionEditor = {
	readonly pending: boolean;
	flush: () => Promise<boolean>;
	retry: () => void;
	suspend: () => void;
	resume: () => void;
	freeze: (frozen: boolean) => void;
	discard: () => void;
	restartTransport: () => void;
};
type Session = {
	readonly closing: boolean;
	readonly prepared: string | null | undefined;
	readonly userId: string | null;
	readonly phase: SessionPhase;
	readonly error: string;
	readonly delayed: boolean;
	readonly blocked: boolean;
	readonly admitted: boolean;
	readonly transportGeneration: number;
	registerEditor: (editor: SessionEditor) => () => void;
	reportAuth: (loading: boolean, authenticated: boolean) => void;
	reportWorkspace: (ready: boolean, error?: string) => void;
	reportDestination: (ready: boolean, error?: string) => void;
	retryAuth: () => void;
	cancelSignOut: () => void;
	discardAndSignOut: () => void;
	dismissError: () => void;
	returnToLogin: () => void;
	reset: () => void;
	completeAccountDeletion: (context: { sessionId: string; userId: string }) => void;
	signOut: () => Promise<void>;
};
export const setViewerSession = (session: Session) => setContext(sessionKey, session);
export const useViewerSession = () => getContext<Session>(sessionKey);
export const setViewer = (viewer: () => Viewer) => setContext(viewerKey, viewer);
export const useViewer = () => getContext<() => Viewer>(viewerKey);
