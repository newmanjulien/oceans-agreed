<script lang="ts">
	let { label = 'Loading' }: { label?: string } = $props();
</script>

<span class="inline-flex size-6 shrink-0" role="status">
	<span
		class="size-full animate-spin rounded-full border-2 border-line-strong/50 border-t-ink-muted [animation-duration:700ms] motion-reduce:animate-none"
		aria-hidden="true"
	></span>
	<span class="sr-only">{label}</span>
</span>
