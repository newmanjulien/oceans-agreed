<script lang="ts">
	import { browser } from '$app/environment';
	import { useClerkContext } from 'svelte-clerk';
	import StartupSurface from './StartupSurface.svelte';
	import SessionStatus from './SessionStatus.svelte';
	import { SessionController } from './session-controller.svelte';
	import {
		cancelPendingContractSnapshots,
		releaseContractSnapshotCache
	} from '$lib/contract/snapshot-cache';
	import { setCacheIdentity } from '$lib/contract/browser-storage';
	import { discardUserDrafts } from '$lib/contract/draft-recovery.svelte';
	import { setViewerSession } from './viewer-session.svelte';
	import { localReturn } from './navigation';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
	const clerk = useClerkContext();
	let alive = true;
	const controller = new SessionController({
		signOut: async () => {
			if (!clerk.clerk) throw new Error('Authentication is unavailable.');
			await clerk.clerk.signOut(() => {});
		},
		cancelReads: cancelPendingContractSnapshots,
		clear: () => {
			releaseContractSnapshotCache();
			setCacheIdentity(null);
		},
		login: async (recover) => {
			const destination = recover
				? localReturn(page.url.pathname + page.url.search + page.url.hash)
				: '/';
			await goto(
				destination === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(destination)}`,
				{ invalidateAll: true }
			);
		}
	});
	const starting = $derived(!controller.admitted);
	setViewerSession({
		get closing() {
			return controller.closing;
		},
		get prepared() {
			return controller.prepared;
		},
		get userId() {
			return controller.userId;
		},
		get phase() {
			return controller.phase;
		},
		get error() {
			return controller.error;
		},
		get delayed() {
			return controller.delayed;
		},
		get blocked() {
			return controller.blocked;
		},
		get admitted() {
			return controller.admitted;
		},
		get transportGeneration() {
			return controller.transportGeneration;
		},
		registerEditor: (editor) => controller.registerEditor(editor),
		reportAuth: (loading, authenticated) => controller.reportAuth(loading, authenticated),
		reportWorkspace: (ready, error) => controller.reportWorkspace(ready, error),
		reportDestination: (ready, error) => controller.reportDestination(ready, error),
		retryAuth: () => controller.retryAuth(),
		cancelSignOut: () => controller.cancelSignOut(),
		discardAndSignOut: () => controller.discardAndSignOut(),
		dismissError: () => controller.dismissError(),
		returnToLogin: () => controller.returnToLogin(),
		reset: () => controller.reset(),
		signOut: () => controller.signOut(),
		completeAccountDeletion: ({ sessionId, userId }) => {
			discardUserDrafts(userId);
			if (
				!alive ||
				(clerk.session && clerk.session.id !== sessionId) ||
				(clerk.user && clerk.user.id !== userId)
			)
				return;
			controller.reset(false);
		}
	});
	let identity: string | null | undefined;
	let cacheUser: string | null | undefined;
	$effect(() => {
		const loaded = clerk.isLoaded;
		const sessionId = clerk.auth.sessionId ?? clerk.session?.id ?? null;
		const userId = clerk.auth.userId ?? clerk.user?.id ?? null;
		untrack(() => {
			if (!loaded) return;
			const initial = identity === undefined;
			if (identity !== sessionId || cacheUser !== userId) {
				releaseContractSnapshotCache();
				setCacheIdentity(userId);
				identity = sessionId;
				cacheUser = userId;
			}
			controller.identity(sessionId, userId, loaded);
			if (initial && !sessionId) controller.reset(true);
		});
	});
	onMount(() => controller.start());
	onDestroy(() => {
		alive = false;
		controller.destroy();
		if (browser) {
			releaseContractSnapshotCache();
			setCacheIdentity(null);
		}
	});
</script>

<div hidden={starting} inert={starting}>{@render children()}</div>
{#if starting}<StartupSurface {controller} />{/if}
<SessionStatus {controller} />
