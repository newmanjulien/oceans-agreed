<script lang="ts">
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'clsx';
	import { cn } from '$lib/ui/cn';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { createModalBehavior } from '$lib/ui/modal-behavior.svelte';

	type Props = {
		open: boolean;
		title: string;
		onClose: () => void;
		class?: ClassValue;
		footer?: Snippet;
		children?: Snippet;
	};

	let { open, title, onClose, class: className = '', footer, children }: Props = $props();

	const titleId = $props.id();
	const modalBehavior = createModalBehavior({
		isOpen: () => open,
		onClose: () => onClose()
	});
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
		<button
			type="button"
			tabindex="-1"
			aria-label="Close modal"
			class="absolute inset-0 cursor-default bg-black/25"
			onclick={onClose}
		></button>

		<div
			bind:this={modalBehavior.dialogElement}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			tabindex="-1"
			class={cn(
				'relative flex max-h-[calc(100vh-3rem)] w-full max-w-110 flex-col overflow-hidden rounded-xl border border-[#e5e5e5] bg-surface text-ink shadow-xl outline-none',
				className
			)}
		>
			<IconButton
				aria-label="Close modal"
				class="absolute top-4 right-4 size-6 border-0"
				onclick={onClose}
			>
				<XIcon size={16} weight="regular" />
			</IconButton>

			<header class="px-4 py-5">
				<h2 id={titleId} class="text-sm leading-tight font-medium text-stone-950">{title}</h2>
			</header>

			<div class="min-h-56 flex-1 px-6 pb-8">
				{@render children?.()}
			</div>

			{#if footer}
				<footer
					class="flex shrink-0 items-center justify-between gap-3 border-t border-stone-200/80 p-4"
				>
					{@render footer()}
				</footer>
			{/if}
		</div>
	</div>
{/if}

<svelte:document onkeydown={modalBehavior.handleKeydown} />
