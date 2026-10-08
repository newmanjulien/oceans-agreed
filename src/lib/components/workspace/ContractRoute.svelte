<script lang="ts">
	import { untrack, onDestroy } from 'svelte';
	import { creationPhase } from '$lib/contract/creation-perf';
	import { goto } from '$app/navigation';
	import type { Id } from '../../../convex/_generated/dataModel';
	import type { ContractRouteData } from '$lib/contract/saved';
	import type { ReadyContract } from '$lib/document/runtime/resources.svelte';
	import SavedContract from './SavedContract.svelte';
	import NewContract from './NewContract.svelte';
	let { data }: { data: ContractRouteData } = $props();
	let creating = $state(untrack(() => data.status === 'new'));
	let creationTarget = $state<string | null>(null);
	let seed = $state.raw<ReadyContract>();
	let attempt = $state(0);
	let completion: ((success: boolean) => void) | undefined;
	$effect(() => {
		const next = data;
		untrack(() => {
			if (creating && next.id === creationTarget) return;
			creating = next.status === 'new';
			creationTarget = null;
		});
	});
	let active = true;
	onDestroy(() => { active = false; completion?.(false); });
	async function openSaved(id: Id<'savedContracts'>, confirmed: ReadyContract) {
		if (!active) return false;
		creationTarget = id;
		seed = confirmed;
		try {
			if (data.id !== id)
				await goto(`/contracts/${id}`, { replaceState: true, noScroll: true, keepFocus: true });
			if (!active) return false;
			creationPhase('navigation-end');
			if (data.id !== id) return false;
			return await new Promise<boolean>((resolve) => {
				completion = resolve;
				attempt++;
			});
		} catch {
			return false;
		}
	}
	function visible() {
		// A failed attempt may recover in the background. Keep its retry dialog
		// until the user explicitly starts another opening attempt.
		if (!creating || !completion) return;
		completion?.(true);
		completion = undefined;
		creating = false;
		creationTarget = null;
	}
	function failure() {
		completion?.(false);
		completion = undefined;
	}
</script>

{#if data.id && (!creating || (creationTarget && attempt > 0))}
	{#key `${data.id}:${attempt}`}
		<SavedContract
			id={data.id}
			seed={seed?.id === data.id ? seed : undefined}
			onVisible={visible}
			onFailure={failure}
		/>
	{/key}
{/if}
{#if creating}<NewContract onOpen={openSaved} showPreview={!creationTarget} />{/if}
