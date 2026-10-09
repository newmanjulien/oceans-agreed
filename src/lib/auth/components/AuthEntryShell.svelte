<script lang="ts">
	import type { Snippet } from 'svelte';
	import AuthPatternLayer from './AuthPatternLayer.svelte';
	import AuthQuotePanel from './AuthQuotePanel.svelte';
	import type { AuthQuote } from './types';

	type Props = {
		children: Snippet;
		footer?: Snippet;
		accent?: 'info' | 'link';
		showFooter?: boolean;
	};

	let { children, footer, accent = 'info', showFooter = Boolean(footer) }: Props = $props();

	const quote = {
		text: 'Overbase increased partnership revenue by 20% in the divisions we deployed it to',
		personName: "Alexandre L'Heureux",
		personTitle: 'CEO at WSP',
		avatarSrc: '/wsp.jpeg',
		avatarAlt: "Alexandre L'Heureux"
	} satisfies AuthQuote;
	const accentStyle = $derived(
		[
			`--auth-accent-200: var(--${accent}-200)`,
			`--auth-accent-400: var(--${accent}-400, var(--${accent}-500))`,
			`--auth-accent-500: var(--${accent}-500)`,
			`--auth-accent-600: var(--${accent}-600)`
		].join('; ')
	);
</script>

<section
	data-sveltekit-preload-data="off"
	data-sveltekit-preload-code="off"
	class="relative min-h-dvh overflow-auto bg-[#fafafa] p-0 text-[#202124] sm:p-2 lg:overflow-hidden"
	style={accentStyle}
>
	<AuthPatternLayer />

	<div
		class="relative z-[1] block min-h-dvh sm:min-h-[calc(100dvh-16px)] lg:grid lg:grid-cols-[minmax(0,50.2%)_minmax(0,1fr)]"
	>
		<section
			class="box-border flex min-h-dvh flex-col bg-white px-6 pt-12 pb-8 sm:min-h-[calc(100dvh-16px)] sm:rounded-xl sm:border sm:border-black/[0.04] lg:px-[clamp(40px,8.55vw,248px)] lg:pt-[clamp(56px,8.6vh,138px)] lg:pb-7"
			aria-label="Agreed account entry"
		>
			<div class="m-auto w-full max-w-85">
				{@render children()}
			</div>

			{#if footer && showFooter}
				<footer class="w-full border-t border-[#eceef1] pt-4">
					{@render footer()}
				</footer>
			{/if}
		</section>

		<aside
			class="relative hidden min-h-[calc(100dvh-16px)] overflow-hidden bg-transparent lg:block"
			aria-label="Customer quote"
		>
			<AuthQuotePanel {quote} />
		</aside>
	</div>
</section>
