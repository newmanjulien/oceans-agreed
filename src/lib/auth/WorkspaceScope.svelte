<script lang="ts">
	import { setViewer, type Viewer } from './viewer-session.svelte';
	import type { Snippet } from 'svelte';
	let { viewer, children }: { viewer: Viewer; children: Snippet } = $props();
	setViewer(() => viewer);
</script>

{@render children()}
