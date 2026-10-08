<script lang="ts">
	import { browser } from '$app/environment';
	import { useClerkContext } from 'svelte-clerk';
	import { useViewerSession } from './viewer-session.svelte';
	import AppGate from './AppGate.svelte';
	import SessionScope from './SessionScope.svelte';
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
	const session = useViewerSession();
	const clerk = useClerkContext();
	const identity = $derived(clerk.auth.sessionId ?? clerk.session?.id);
</script>

{#if browser && identity && session.prepared === identity && !session.closing}
	{#key identity}
		<SessionScope>
			<div inert={session.blocked || Boolean(session.error)} aria-busy={session.blocked}>
				<AppGate>{@render children()}</AppGate>
			</div>
		</SessionScope>
	{/key}
{/if}
