<script lang="ts">
	import RequireAccount from '$lib/auth/RequireAccount.svelte';
	import WorkspaceBoundary from '$lib/auth/WorkspaceBoundary.svelte';
	let { children } = $props();
</script>

<RequireAccount><WorkspaceBoundary>{@render children()}</WorkspaceBoundary></RequireAccount>
