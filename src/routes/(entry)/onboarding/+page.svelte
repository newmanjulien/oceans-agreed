<script lang="ts">
	import RequireAccount from '$lib/auth/RequireAccount.svelte';
	import CompanyOnboarding from '$lib/auth/CompanyOnboarding.svelte';
</script>

<RequireAccount inline>
	<div class="onboarding">
		<CompanyOnboarding />
	</div>
</RequireAccount>

<style>
	.onboarding {
		--auth-accent-200: color-mix(in srgb, var(--color-accent) 25%, white);
		--auth-accent-500: var(--color-accent);
		--auth-accent-600: var(--color-accent-hover);
	}
</style>
