<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from '$lib/ui/Button.svelte';

	type Props = {
		type?: 'button' | 'submit';
		'aria-keyshortcuts'?: string;
		disabled?: boolean;
		children: Snippet;
		onclick?: () => void;
	};

	let {
		type = 'button',
		disabled = false,
		children,
		onclick,
		'aria-keyshortcuts': ariaKeyshortcuts
	}: Props = $props();
</script>

<Button
	{type}
	{disabled}
	{onclick}
	aria-keyshortcuts={ariaKeyshortcuts}
	class="relative w-full bg-[var(--auth-accent-500)] hover:bg-[var(--auth-accent-600)] focus-visible:outline-[var(--auth-accent-200)] disabled:bg-[var(--auth-accent-200)] disabled:text-white disabled:hover:bg-[var(--auth-accent-200)] data-[disabled]:bg-[var(--auth-accent-200)] data-[disabled]:text-white"
>
	{@render children()}
</Button>
