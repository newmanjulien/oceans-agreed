<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import { fieldClass } from '$lib/ui/field-styles';
	import { Button } from '$lib/ui';
	import SettingsCard from './SettingsCard.svelte';
	import type { Role } from '../../../convex/permissions';

	let {
		value,
		saving = false,
		disabled = false,
		errorText = null,
		onSave
	}: {
		value: Role;
		saving?: boolean;
		disabled?: boolean;
		errorText?: string | null;
		onSave: (role: Role) => Promise<void>;
	} = $props();
	let draft = $state<Role>('rep');
	let syncedValue = $state<Role>();
	let hideServerError = $state(false);
	const shownError = $derived(hideServerError ? null : errorText);
	$effect(() => {
		if (syncedValue !== value) {
			draft = value;
			syncedValue = value;
			hideServerError = false;
		}
	});
	async function save() {
		if (saving || disabled || draft === value) return;
		hideServerError = false;
		await onSave(draft);
	}
</script>

<SettingsCard
	title="Your role"
	description="Choose Rep or Admin for yourself. Admins can manage company settings and colleagues."
>
	<div class="mt-4 max-w-sm space-y-2">
		<label class="sr-only" for="personal-role">Your role</label>
		<div class="relative">
			<select
				id="personal-role"
				bind:value={draft}
				disabled={saving || disabled}
				class={`${fieldClass} h-9 appearance-none py-0 pr-9 leading-5`}
				aria-invalid={Boolean(shownError)}
				aria-describedby="personal-role-message"
				onchange={() => (hideServerError = true)}
			>
				<option value="rep">Rep</option>
				<option value="admin">Admin</option>
			</select>
			<CaretDownIcon
				aria-hidden="true"
				size={14}
				class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted"
			/>
		</div>
		<p
			id="personal-role-message"
			role={shownError ? 'alert' : undefined}
			class="min-h-5 text-[0.72rem] leading-5 text-danger"
		>
			{shownError ?? ''}
		</p>
	</div>
	{#snippet footer()}<p>You can change your role at any time.</p>{/snippet}
	{#snippet action()}<Button disabled={saving || disabled || draft === value} onclick={save}
			>{saving ? 'Saving...' : 'Save'}</Button
		>{/snippet}
</SettingsCard>
