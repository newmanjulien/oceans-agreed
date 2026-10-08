<script lang="ts">
	import type { SessionController } from './session-controller.svelte';
	import { useClerkReadiness } from './clerk-readiness';
	let { controller }: { controller: SessionController } = $props();
	const readiness = useClerkReadiness();
	const failed = $derived(
		readiness.status === 'error' ||
			controller.phase === 'authentication-error' ||
			Boolean(controller.error)
	);
	async function retry() {
		try {
			await readiness.retry();
			controller.retryAuth();
		} catch {
			/* The provider exposes the connection error. */
		}
	}
</script>

<main class="grid min-h-dvh place-content-center gap-4 p-8 text-center" aria-busy={!failed}>
	{#if !failed}<span class="loader mx-auto" aria-hidden="true"></span>{/if}
	<p role={failed ? 'alert' : 'status'} class="max-w-md text-sm text-ink-muted">
		{failed
			? readiness.error || controller.error || controller.authenticationError
			: controller.delayed
				? 'This is taking longer than usual.'
				: 'Opening your workspace…'}
	</p>
	{#if failed || controller.delayed}
		<div class="flex justify-center gap-5 text-sm">
			<button class="underline" onclick={() => void retry()}>Try again</button>
			<button class="underline" onclick={() => void controller.signOut()}>Log out</button>
		</div>
	{/if}
</main>

<style>
	.loader {
		width: 24px;
		height: 24px;
		border: 2px solid #e5e5e5;
		border-top-color: #737373;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.loader {
			animation: none;
		}
	}
</style>
