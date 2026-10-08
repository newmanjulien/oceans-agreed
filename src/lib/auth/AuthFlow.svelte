<script lang="ts">
	import EmailCodeFlow from './EmailCodeFlow.svelte';
	let { joining = false }: { joining?: boolean } = $props();
</script>

{#key joining}<EmailCodeFlow {joining} />{/key}
