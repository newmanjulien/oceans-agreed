<script lang="ts">
	import { onDestroy } from 'svelte';
	import { ReadAttempt, waitForRead } from '$lib/auth/attempt';
	import { getHome, loadHome } from '$lib/components/workspace/home';
	import LoadingWheel from '$lib/ui/LoadingWheel.svelte';
	const Home = getHome();
	const attempt = Home ? undefined : new ReadAttempt(15_000);
	const home = Home ?? waitForRead(loadHome(), attempt!.signal).finally(() => attempt!.complete());
	onDestroy(() => attempt?.abort());
</script>

<svelte:head>
	<title>Home | Agreed</title>
	<meta name="description" content="Find, save, and negotiate your contracts." />
</svelte:head>

{#await home}
	<div class="flex justify-center py-16"><LoadingWheel label="Loading contracts" /></div>
{:then Home}
	<Home />
{:catch}
	<div role="alert" class="p-8 text-center text-sm">
		<p>We couldn’t load your contracts.</p>
		<button class="mt-4 underline" onclick={() => location.reload()}>Try again</button>
	</div>
{/await}
