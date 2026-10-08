<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/ui/cn';

	type Props = {
		children: Snippet;
		background: Snippet;
		aside: Snippet;
		accent?: 'info' | 'link';
		footer?: Snippet;
		showFooter?: boolean;
		onReturnButtonClick?: () => void;
		returnButtonHref?: string;
		returnLabel?: string;
		footerBorder?: boolean;
	};

	let {
		children,
		background,
		aside,
		accent = 'info',
		footer,
		showFooter = Boolean(footer),
		onReturnButtonClick,
		returnButtonHref,
		returnLabel = 'Return',
		footerBorder = true
	}: Props = $props();
	const returnButtonInternalHref = $derived(
		returnButtonHref && /^\/(?!\/)/.test(returnButtonHref) ? returnButtonHref : null
	);
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
	class="relative min-h-dvh overflow-auto bg-[#f7f7f7] p-0 text-[#202124] sm:p-2 lg:overflow-hidden"
	style={accentStyle}
>
	{@render background()}

	<div
		class="relative z-[1] block min-h-dvh sm:min-h-[calc(100dvh-16px)] lg:grid lg:grid-cols-[minmax(0,50.2%)_minmax(0,1fr)]"
	>
		<section
			class="box-border flex min-h-dvh flex-col bg-white px-6 pt-12 pb-8 sm:min-h-[calc(100dvh-16px)] sm:rounded-xl sm:border sm:border-black/[0.04] lg:px-[clamp(40px,8.55vw,248px)] lg:pt-[clamp(56px,8.6vh,138px)] lg:pb-7"
			aria-label="Agreed auth"
		>
			{#if returnButtonHref}
				{#if returnButtonInternalHref}
					<a
						class="inline-flex w-fit cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-sm leading-none text-[#8f9297] outline-none transition-colors hover:text-[#666a70] rounded-button-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
						href={resolve(returnButtonInternalHref as '/')}
					>
						<ArrowLeftIcon aria-hidden="true" size={14} weight="regular" />
						<span>{returnLabel}</span>
					</a>
				{/if}
			{:else if onReturnButtonClick}
				<button
					type="button"
					class="inline-flex w-fit cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-sm leading-none text-[#8f9297] outline-none transition-colors hover:text-[#666a70] rounded-button-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					onclick={onReturnButtonClick}
				>
					<ArrowLeftIcon aria-hidden="true" size={14} weight="regular" />
					<span>{returnLabel}</span>
				</button>
			{/if}

			<div class="m-auto w-full max-w-85">
				{@render children()}
			</div>

			{#if footer && showFooter}
				<footer class={cn('w-full pt-4', footerBorder && 'border-t border-[#eceef1]')}>
					{@render footer()}
				</footer>
			{/if}
		</section>

		<aside
			class="relative hidden min-h-[calc(100dvh-16px)] overflow-hidden bg-transparent lg:block"
			aria-label="Customer quote"
		>
			{@render aside()}
		</aside>
	</div>
</section>
