<script lang="ts">
	import { untrack } from 'svelte';
	import { setContractWorkspace } from '$lib/document/runtime/context';
	import type { DocumentResource } from '$lib/document/runtime/resources.svelte';
	import { setInteractionOwner } from '$lib/components/ui/interactions';
	import ContractViewer from './ContractViewer.svelte';
	let { entry }: { entry: DocumentResource } = $props();
	setContractWorkspace(untrack(() => entry.workspace));
	setInteractionOwner(untrack(() => entry.owner));
	let element = $state<HTMLDivElement>();
	let parking = $state<HTMLDivElement>();
	$effect(() => {
		const node = element,
			destination = entry.target ?? parking;
		if (node && destination && node.parentElement !== destination) destination.append(node);
		return () => {
			if (node && parking && node.parentElement !== parking) parking.append(node);
		};
	});
	const bindings = $derived(entry.bindings);
	// Reparenting the same wrapper preserves every DocumentPage and annotation owner.
	const readyToShow = $derived(entry.active || entry.draftOwned);
</script>

<div bind:this={parking} class="document-parking" inert aria-hidden="true">
	<div
		bind:this={element}
		data-document-resource={entry.id}
		class:dormant={!readyToShow}
		inert={!entry.active || bindings?.interactive === false}
		aria-hidden={!readyToShow}
	>
		<ContractViewer
			active={readyToShow}
			interactive={entry.active && (bindings?.interactive ?? true)}
			retained
			prepare={entry.allowed}
			priority={entry.priority}
			selectedConcessions={bindings?.selectedConcessions ?? entry.choices}
			previewChanges={bindings?.previewChanges}
			hasPanel={bindings?.hasPanel}
			followScroll={bindings?.followScroll}
			selectedAnnotationId={bindings?.selectedAnnotationId}
			selectedRanges={bindings?.selectedRanges}
			panelSource={bindings?.panelSource}
			picking={bindings?.picking}
			allowPlaybookNavigation={bindings?.allowPlaybookNavigation ?? false}
			onRemoveConcession={bindings?.onRemoveConcession ?? (() => {})}
			onSelect={bindings?.onSelect ?? (() => false)}
		>
			{#snippet panelContent()}{#if entry.active && bindings}{@render bindings.panelContent()}{/if}{/snippet}
			{#snippet footerContent()}{#if entry.active && bindings?.footerContent}{@render bindings.footerContent()}{/if}{/snippet}
		</ContractViewer>
	</div>
</div>

<style>
	.document-parking,
	.dormant {
		position: fixed;
		left: -100000px;
		top: 0;
		width: 100%;
		visibility: hidden;
		pointer-events: none;
		contain: layout paint;
	}
</style>
