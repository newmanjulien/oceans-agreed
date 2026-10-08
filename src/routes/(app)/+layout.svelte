<script lang="ts">
	import AuthBridge from '$lib/auth/AuthBridge.svelte';
	import ProtectedSession from '$lib/auth/ProtectedSession.svelte';
	let { children } = $props();
</script>

<AuthBridge><ProtectedSession>{@render children()}</ProtectedSession></AuthBridge>
