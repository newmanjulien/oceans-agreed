<script lang="ts">
	import type { Snippet } from 'svelte';
	import AuthButton from './AuthButton.svelte';

	type Props = {
		children: Snippet;
		disabled?: boolean;
		hotkey?: 'Enter';
		onclick?: () => void;
		type?: 'button' | 'submit';
	};

	let { children, disabled = false, hotkey = 'Enter', onclick, type = 'button' }: Props = $props();

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
	{@render children()}
</AuthButton>
