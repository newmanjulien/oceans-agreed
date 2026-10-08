<script lang="ts">
	import { onMount, tick } from 'svelte';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretUpIcon from 'phosphor-svelte/lib/CaretUpIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import type { DocumentSearchSession } from '$lib/document/search/search-session.svelte';
	import SquareIconButton from '$lib/components/ui/SquareIconButton.svelte';

	let {
		session,
		panelElement = $bindable(),
		inputElement = $bindable()
	}: {
		session: DocumentSearchSession;
		panelElement?: HTMLElement;
		inputElement?: HTMLInputElement;
	} = $props();

	function handleInput(event: Event) {
		session.setQuery((event.currentTarget as HTMLInputElement).value);
	}

	function handleInputKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		if (event.shiftKey) session.previous();
		else session.next();
	}

	onMount(() => {
		void tick().then(() => inputElement?.focus());
	});
</script>

<section
	bind:this={panelElement}
	id="document-search"
	class="pointer-events-auto w-full rounded-xl border border-[#e5e5e5] bg-surface p-2.5 text-ink shadow-none"
	aria-label="Search"
	data-utility-panel="document-search"
>
	<label
		class="flex h-9 min-w-0 items-center gap-2 rounded-button-lg border border-[#e5e5e5] bg-white px-3 text-[#8a8a8a] transition-colors focus-within:border-[#d5d5d5] motion-reduce:transition-none"
	>
		<span class="sr-only">Find in document</span>
		<MagnifyingGlassIcon aria-hidden="true" size={17} weight="regular" />
		<input
			class="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-ink outline-none placeholder:text-[#8a8a8a] [&::-webkit-search-cancel-button]:hidden"
			bind:this={inputElement}
			type="search"
			value={session.query}
			placeholder="Find in document"
			autocomplete="off"
			spellcheck="false"
			oninput={handleInput}
			onkeydown={handleInputKeydown}
		/>
	</label>

	{#if session.query}
		<div class="mt-3 flex min-h-9 items-center justify-between">
			<p class="m-0 text-sm leading-[1.4]" role="status" aria-live="polite">
				{#if session.resultCount}
					Result {session.activeResultNumber} of {session.resultCount}
				{:else}
					No results
				{/if}
			</p>

			<div class="flex gap-0.5">
				<SquareIconButton
					type="button"
					aria-label="Previous result"
					disabled={!session.resultCount}
					onclick={() => session.previous()}
				>
					<CaretUpIcon aria-hidden="true" size={20} weight="bold" />
				</SquareIconButton>
				<SquareIconButton
					type="button"
					aria-label="Next result"
					disabled={!session.resultCount}
					onclick={() => session.next()}
				>
					<CaretDownIcon aria-hidden="true" size={20} weight="bold" />
				</SquareIconButton>
			</div>
		</div>
	{/if}
</section>
