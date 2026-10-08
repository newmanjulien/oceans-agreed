<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'clsx';
	import Button from '$lib/ui/Button.svelte';
	import type { ButtonHref, ButtonSize, ButtonType, ButtonVariant } from '$lib/ui/types';

	type Props = {
		'aria-label': string;
		'aria-describedby'?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		type?: ButtonType;
		href?: ButtonHref;
		disabled?: boolean;
		class?: ClassValue;
		onclick?: (event: MouseEvent) => void;
		children?: Snippet;
	};

	let {
		'aria-label': ariaLabel,
		'aria-describedby': ariaDescribedBy,
		variant = 'secondary',
		size = 'icon-sm',
		type = 'button',
		href,
		disabled = false,
		class: className = '',
		onclick,
		children
	}: Props = $props();
</script>

<Button
	{variant}
	{size}
	{type}
	{href}
	{disabled}
	{onclick}
	aria-label={ariaLabel}
	aria-describedby={ariaDescribedBy}
	class={className}
>
	{@render children?.()}
</Button>
