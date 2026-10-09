<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import ContractRoute from '$lib/components/workspace/ContractRoute.svelte';
	let { children }: { children: Snippet } = $props();
</script>

{#if page.data.contractRoute}<ContractRoute data={page.data.contractRoute} />{/if}
{@render children()}
