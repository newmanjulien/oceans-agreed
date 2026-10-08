<script lang="ts">
	import type { Snippet } from 'svelte';
	import AuthPageShell from './AuthPageShell.svelte';
	import AuthPatternLayer from './AuthPatternLayer.svelte';
	import AuthQuotePanel from './AuthQuotePanel.svelte';
	import type { AuthQuote } from './types';

	type Props = {
		children: Snippet;
		footer?: Snippet;
		accent?: 'info' | 'link';
		showFooter?: boolean;
		onReturnButtonClick?: () => void;
		returnButtonHref?: string;
		returnLabel?: string;
		footerBorder?: boolean;
	};

	let {
		children,
		footer,
		accent = 'info',
		showFooter = Boolean(footer),
		onReturnButtonClick,
		returnButtonHref,
		returnLabel,
		footerBorder = true
	}: Props = $props();

	const quote = {
		text: 'Overbase increased partnership revenue by 20% in the divisions we deployed it to',
		personName: "Alexandre L'Heureux",
		personTitle: 'CEO at WSP',
		avatarSrc: '/wsp.jpeg',
		avatarAlt: "Alexandre L'Heureux"
	} satisfies AuthQuote;
	const shouldShowFooter = $derived(Boolean(footer) && showFooter);
</script>

<AuthPageShell
	{accent}
	{onReturnButtonClick}
	{returnButtonHref}
	{returnLabel}
	{footer}
	showFooter={shouldShowFooter}
	{footerBorder}
>
	{#snippet background()}
		<AuthPatternLayer />
	{/snippet}

	{#snippet aside()}
		<AuthQuotePanel {quote} />
	{/snippet}

	{@render children()}
</AuthPageShell>
