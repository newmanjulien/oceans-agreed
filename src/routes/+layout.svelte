<script lang="ts">
	import '../app.css';
	import { env } from '$env/dynamic/public';
	import ClerkSessionProvider from '$lib/auth/ClerkSessionProvider.svelte';
	let { children } = $props();
</script>

{#if env.PUBLIC_CLERK_PUBLISHABLE_KEY && env.PUBLIC_CONVEX_URL}
	<ClerkSessionProvider publishableKey={env.PUBLIC_CLERK_PUBLISHABLE_KEY}>
		{@render children()}
	</ClerkSessionProvider>
{:else}
	<main class="grid min-h-dvh place-content-center bg-white p-8 text-center">
		<h1 class="text-xl font-medium">Agreed</h1>
		<p class="mt-3 text-sm text-stone-500">
			Sign-in setup is pending. Add the development Clerk keys to open Agreed.
		</p>
	</main>
{/if}
