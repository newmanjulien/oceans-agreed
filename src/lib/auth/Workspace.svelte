<script lang="ts">
	import type DocumentHostType from './DocumentHost.svelte';
	import { page } from '$app/state';
	import { useViewerSession } from './viewer-session.svelte';
	import { DocumentResources, setDocumentResources } from '$lib/document/runtime/resources.svelte';
	import { env } from '$env/dynamic/public';
	import { ReadAttempt, waitForRead } from './attempt';
	import { browser } from '$app/environment';
	import { beforeNavigate, afterNavigate, onNavigate } from '$app/navigation';
	import {
		getContractSnapshotCache,
		releaseContractSnapshotCache
	} from '$lib/contract/snapshot-cache';
	import {
		recordDocumentNavigation,
		cancelDocumentNavigation
	} from '$lib/document/runtime/render-perf';
	import {
		ContractLayoutProfiles,
		setContractLayoutProfiles
	} from '$lib/document/runtime/layout-context.svelte';
	import { onMount, onDestroy, type Snippet, untrack } from 'svelte';
	import { InteractionController, setInteractionController } from '$lib/components/ui/interactions';
	let { children }: { children: Snippet } = $props();
	const interactions = setInteractionController(new InteractionController());
	const session = useViewerSession();
	onMount(() => interactions.mount());
	onMount(() => releaseContractSnapshotCache);
	beforeNavigate((navigation) => {
		if (navigation.to) recordDocumentNavigation(navigation.to.url.pathname);
	});
	afterNavigate((navigation) => {
		if (!navigation.to) return;
		if (browser && navigation.type === 'enter')
			recordDocumentNavigation(navigation.to.url.pathname, 0);
		else if (navigation.to.url.pathname === '/') cancelDocumentNavigation();
	});
	// A persistent host preserves the existing mount-specific epoch safety.
	// Disable independently to return to viewer-owned, fresh geometry.
	const layoutProfiles =
		env.PUBLIC_CONTRACT_ROUTE_PROFILES === '0'
			? undefined
			: setContractLayoutProfiles(new ContractLayoutProfiles());
	const resources =
		layoutProfiles && env.PUBLIC_CONTRACT_DOCUMENT_PREPARATION !== '0'
			? setDocumentResources(new DocumentResources(layoutProfiles))
			: undefined;
	let DocumentHost = $state<typeof DocumentHostType>();
	let hostAttempt: ReadAttempt | undefined;
	let hostGeneration = -1;
	let alive = true;
	let hostError = $state('');
	const documentRoute = $derived(/^\/(admin|contracts)(\/|$)/.test(page.url.pathname));
	$effect(() => {
		const ready = !documentRoute || Boolean(DocumentHost);
		const failure = documentRoute ? hostError : '';
		if (page.url.pathname !== '/' && !session.admitted)
			untrack(() => session.reportDestination(ready, failure));
	});
	$effect(() => {
		const needed = documentRoute || Boolean(resources?.preparationCandidates.length);
		// Recovery retries a failed chunk load as well as the authenticated transport.
		const generation = session.transportGeneration;
		if (!needed) return;
		untrack(() => {
			if (DocumentHost || (hostAttempt && hostGeneration === generation)) return;
			hostAttempt?.abort();
			const attempt = new ReadAttempt(15_000);
			hostAttempt = attempt;
			hostGeneration = generation;
			hostError = '';
			void waitForRead(import('./DocumentHost.svelte'), attempt.signal)
				.then((module) => {
					if (!alive || hostAttempt !== attempt || session.transportGeneration !== generation)
						return;
					if (resources) resources.createWorkspace = module.createContractWorkspace;
					DocumentHost = module.default;
				})
				.catch(() => {
					if (alive && hostAttempt === attempt && session.transportGeneration === generation)
						hostError = 'Unable to load the document viewer. Try again or reload.';
				})
				.finally(() => {
					attempt.complete();
					if (hostAttempt === attempt) hostAttempt = undefined;
				});
		});
	});
	onNavigate(({ to }) => {
		const path = to?.url.pathname;
		const id = path === '/admin' ? 'admin' : path?.match(/^\/contracts\/([^/]+)\/?$/)?.[1];
		if (id && id !== 'admin' && id !== 'new') void getContractSnapshotCache().load(id);
		return id ? resources?.beginOpen(id) : undefined;
	});
	onMount(() =>
		resources
			? getContractSnapshotCache().subscribe(
					(data) => resources.prepare(data),
					(id) => resources.remove(id),
					(id) => resources.failedPreparation(id)
				)
			: undefined
	);
	onDestroy(() => {
		alive = false;
		hostAttempt?.abort();
		resources?.destroy();
		layoutProfiles?.scheduler.destroy();
	});
</script>

{#if !documentRoute || DocumentHost}{@render children()}{/if}
{#if documentRoute && hostError}<p role="alert" class="p-4 text-sm">
		{hostError} <button class="underline" onclick={() => location.reload()}>Reload</button>
	</p>{/if}
{#if DocumentHost}<DocumentHost profiles={layoutProfiles} {resources} />{/if}
