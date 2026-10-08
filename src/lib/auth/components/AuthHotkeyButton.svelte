<script lang="ts">
	import type { Snippet } from 'svelte';
	import AuthButton from './AuthButton.svelte';

	type Props = {
		children: Snippet;
		disabled?: boolean;
		hotkey?: 'Enter';
		hotkeyLabel?: string;
		onclick?: () => void;
		type?: 'button' | 'submit';
	};

	let {
		children,
		disabled = false,
		hotkey = 'Enter',
		hotkeyLabel = 'return',
		onclick,
		type = 'button'
	}: Props = $props();

	function isEditableTarget(target: EventTarget | null) {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (!onclick || disabled || event.key !== hotkey || isEditableTarget(event.target)) {
			return;
		}

		event.preventDefault();
		onclick();
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<AuthButton {type} {disabled} {onclick} aria-keyshortcuts={hotkey}>
	<span>{@render children()}</span>
	<span class="absolute right-3 hidden sm:inline-flex">
		<span
			class="inline-flex h-5 min-w-5 items-center justify-center rounded-button-sm bg-current/10 px-2 text-xs"
		>
			{hotkeyLabel}
		</span>
	</span>
</AuthButton>
