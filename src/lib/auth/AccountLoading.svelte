<script lang="ts">
	import { useViewerSession } from './viewer-session.svelte';
	import { useClerkReadiness } from './clerk-readiness';
	import LoadingWheel from '$lib/ui/LoadingWheel.svelte';
	let { inline = false }: { inline?: boolean } = $props();
	const session = useViewerSession();
	const readiness = useClerkReadiness();
	const failure = $derived(
		readiness.error || (session.phase === 'authentication-error' ? session.authenticationError : '')
	);
	async function retry() {
		try {
			await readiness.retry();
			session.retryAuth();
		} catch {
			/* The provider exposes the connection error. */
		}
	}
</script>

<div
	class={inline
		? 'grid justify-items-center gap-4 py-8 text-center'
		: 'grid min-h-dvh place-content-center justify-items-center gap-4 bg-[#fafafa] p-8 text-center'}
	aria-busy={!failure}
>
	{#if !failure}<LoadingWheel label="Connecting your account" />{/if}
	{#if failure || session.delayed}
		<p role={failure ? 'alert' : 'status'} class="max-w-md text-sm text-ink-muted">
			{failure || 'This is taking longer than usual.'}
		</p>
		<div class="flex gap-5 text-sm">
			<button class="underline" onclick={() => void retry()}>Try again</button>
			<button class="underline" onclick={() => void session.signOut()}>Log out</button>
		</div>
	{/if}
</div>
