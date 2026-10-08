<script lang="ts">
	import { useAuth, useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api';
	import Workspace from './Workspace.svelte';
	import { setViewer, useViewerSession, type Viewer } from './viewer-session.svelte';
	import { AccountPreparation } from './account-preparation';
	import { ReadAttempt, waitForRead } from './attempt';
	import { untrack, onDestroy, type Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
	const client = useConvexClient();
	const auth = useAuth();
	const session = useViewerSession();
	const viewer = useQuery(api.profiles.viewer, () => (auth.isAuthenticated ? {} : 'skip'));
	let retainedViewer = $state.raw<Viewer | undefined>();
	const preparation = new AccountPreparation();
	setViewer(() => retainedViewer!);
	let error = $state('');
	let admitted = $state(false);
	let generation = -1;
	let attempt = 0;
	let preparationAttempt: ReadAttempt | undefined;
	let alive = true;
	onDestroy(() => {
		alive = false;
		preparationAttempt?.abort();
		attempt++;
	});
	async function initialize(transportGeneration: number) {
		const current = ++attempt;
		preparationAttempt?.abort();
		const read = new ReadAttempt(15_000);
		preparationAttempt = read;
		generation = transportGeneration;
		error = '';
		try {
			await waitForRead(client.mutation(api.profiles.initialize, {}), read.signal);
		} catch (e) {
			if (alive && current === attempt && session.transportGeneration === transportGeneration)
				error = e instanceof Error ? e.message : 'Unable to initialize your account.';
		} finally {
			read.complete();
		}
	}
	$effect(() => {
		const authenticated = auth.isAuthenticated;
		const nextGeneration = session.transportGeneration;
		const data = viewer.data;
		untrack(() => {
			if (authenticated) {
				void preparation.initialize(data, nextGeneration, () => initialize(nextGeneration));
			}
		});
	});
	$effect(() => {
		const data = viewer.data;
		const nextGeneration = session.transportGeneration;
		const failure = (generation === nextGeneration ? error : '') || viewer.error?.message || '';
		const ready = Boolean(data?.ready && !data.needsInitialization && !failure);
		untrack(() => {
			if (data) retainedViewer = data;
			if (ready) admitted = true;
			session.reportWorkspace(ready, failure);
		});
	});
</script>

{#if admitted}<Workspace>{@render children()}</Workspace>{/if}
