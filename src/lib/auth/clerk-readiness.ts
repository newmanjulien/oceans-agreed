import { getContext, setContext } from 'svelte';

export type ClerkReadiness = {
	readonly status: 'starting' | 'ready' | 'error';
	readonly error: string;
	ready(options: { signal: AbortSignal }): Promise<void>;
	retry(): Promise<void>;
};

const key = Symbol('clerk-readiness');
export const setClerkReadiness = (value: ClerkReadiness) => setContext(key, value);
export const useClerkReadiness = () => getContext<ClerkReadiness>(key);
