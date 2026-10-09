<script lang="ts">
	import { fieldClass } from '$lib/ui/field-styles';
	import { onDestroy } from 'svelte';
	import type { SessionResource, UserResource } from '@clerk/shared/types';
	import { useClerkContext } from 'svelte-clerk';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api';
	import {
		createClerkSessionVerification,
		type ClerkSessionVerificationFactor,
		getErrorMessage,
		isReverificationRequiredError
	} from '$lib/auth/clerk-session-verification.svelte';
	import { useViewerSession } from '$lib/auth/viewer-session.svelte';
	import { Button, destructiveButtonClass, ModalShell } from '$lib/ui';

	const CONFIRMATION_TEXT = 'delete my account';

	type ModalStep = 'confirmDeletion' | 'verifyIdentity';

	type Props = {
		open: boolean;
		onClose: () => void;
	};

	let { open, onClose }: Props = $props();
	const clerk = useClerkContext();
	const client = useConvexClient();
	const viewerSession = useViewerSession();
	const verification = createClerkSessionVerification({
		isCurrent: (session) =>
			attempt !== null && attempt.sessionId === session.id && isCurrent(attempt),
		onComplete: async () => {
			const a = attempt;
			if (a) await executeDeletion(a, true);
		}
	});
	type Attempt = {
		user: UserResource;
		session: SessionResource;
		userId: string;
		sessionId: string;
		generation: number;
	};
	let attempt: Attempt | null = null;
	let generation = 0;
	let alive = true;
	let contextKey = '';
	onDestroy(() => {
		alive = false;
		resetModalState();
	});

	let step = $state<ModalStep>('confirmDeletion');
	let confirmationText = $state('');
	let deleteErrorText = $state<string | null>(null);
	let deleting = $state(false);
	let lastOpen = $state(false);

	const trimmedConfirmationText = $derived(confirmationText.trim());
	const canDeleteAccount = $derived(trimmedConfirmationText === CONFIRMATION_TEXT);
	const errorText = $derived(step === 'confirmDeletion' ? deleteErrorText : verification.errorText);
	const verificationTitle = $derived(getVerificationTitle(verification.factor));
	const verificationDescription = $derived(getVerificationDescription(verification.factor));
	const verificationInputType = $derived(
		verification.factor?.strategy === 'password' ? 'password' : 'text'
	);
	const verificationAutocomplete = $derived(
		verification.factor?.strategy === 'password' ? 'current-password' : 'one-time-code'
	);
	const verificationInputMode = $derived(getVerificationInputMode(verification.factor));
	const showVerificationInput = $derived(
		verification.factor !== null && verification.factor.strategy !== 'passkey'
	);
	const showPasskeyPrompt = $derived(
		verification.factor?.strategy === 'passkey' && verification.status === 'awaitingInput'
	);
	const verificationActionText = $derived(getVerificationActionText());

	$effect(() => {
		const key = `${clerk.user?.id ?? ''}:${clerk.session?.id ?? ''}`;
		if (open !== lastOpen || key !== contextKey) {
			resetModalState();
		}
		contextKey = key;
		lastOpen = open;
	});

	function resetModalState() {
		generation++;
		attempt = null;
		confirmationText = '';
		deleteErrorText = null;
		deleting = false;
		step = 'confirmDeletion';
		verification.reset();
	}

	function closeDeleteModal() {
		if (deleting) {
			return;
		}

		onClose();
		resetModalState();
	}

	function getVerificationTitle(factor: ClerkSessionVerificationFactor | null) {
		if (!factor) {
			return 'Verify your identity';
		}

		switch (factor.strategy) {
			case 'password':
				return 'Enter your password';
			case 'email_code':
				return 'Enter the email code';
			case 'phone_code':
				return 'Enter the phone code';
			case 'totp':
				return 'Enter your authenticator code';
			case 'backup_code':
				return 'Enter a backup code';
			case 'passkey':
				return 'Verify with your passkey';
		}
	}

	function getVerificationDescription(factor: ClerkSessionVerificationFactor | null) {
		if (!factor) {
			return 'Verify your identity before deleting this account.';
		}

		if (
			(factor.strategy === 'email_code' || factor.strategy === 'phone_code') &&
			factor.safeIdentifier
		) {
			return `Enter the verification code sent to ${factor.safeIdentifier}.`;
		}

		if (factor.strategy === 'passkey') {
			return 'Use your passkey to verify your identity.';
		}

		return 'Verify your identity before deleting this account.';
	}

	function getVerificationInputMode(factor: ClerkSessionVerificationFactor | null) {
		switch (factor?.strategy) {
			case 'email_code':
			case 'phone_code':
			case 'totp':
				return 'numeric';
			case 'backup_code':
				return 'text';
			case 'password':
			case 'passkey':
			case undefined:
				return undefined;
		}
	}

	function getVerificationActionText() {
		if (verification.status === 'preparing') {
			return 'Preparing...';
		}

		if (verification.status === 'verifying') {
			return 'Verifying...';
		}

		return verification.factor?.strategy === 'passkey'
			? 'Verify with passkey'
			: 'Verify and delete';
	}

	function isCurrent(a: Attempt) {
		return (
			alive &&
			open &&
			generation === a.generation &&
			clerk.user?.id === a.userId &&
			clerk.session?.id === a.sessionId
		);
	}

	function getDeletionContext() {
		if (!clerk.isLoaded || !clerk.user || !clerk.session) {
			return {
				ok: false,
				errorText: 'Unable to delete your account right now.'
			} as const;
		}

		if (!clerk.user.deleteSelfEnabled) {
			return {
				ok: false,
				errorText: 'Account deletion is unavailable right now. Please try again later.'
			} as const;
		}

		return {
			ok: true,
			user: clerk.user,
			session: clerk.session,
			userId: clerk.user.id,
			sessionId: clerk.session.id,
			generation
		} as const;
	}

	function returnToConfirmationWithError(message: string) {
		step = 'confirmDeletion';
		verification.reset();
		deleteErrorText = message;
	}

	async function executeDeletion(a: Attempt, afterVerification = false) {
		if (!isCurrent(a)) return;
		deleteErrorText = null;
		deleting = true;
		try {
			await client.query(api.accountDeletion.authorize, {});
			if (!isCurrent(a)) return;
			await a.user.delete();
			viewerSession.completeAccountDeletion({ sessionId: a.sessionId, userId: a.userId });
			if (!isCurrent(a)) return;
			onClose();
			resetModalState();
		} catch (error) {
			if (!isCurrent(a)) return;
			deleting = false;
			const needsVerification = isReverificationRequiredError(error);
			if (needsVerification && !afterVerification) {
				step = 'verifyIdentity';
				await verification.start(a.session);
				if (!isCurrent(a)) return;
			} else {
				returnToConfirmationWithError(
					needsVerification
						? 'Identity verification is still required before deleting this account. Please try again.'
						: getErrorMessage(error, 'Unable to delete your account.')
				);
			}
		}
	}

	async function deleteAccount() {
		if (!canDeleteAccount || deleting || verification.busy) return;
		generation++;
		const context = getDeletionContext();
		if (!context.ok) {
			returnToConfirmationWithError(context.errorText);
			return;
		}
		attempt = context;
		await executeDeletion(context);
	}
</script>

<ModalShell {open} title="Delete account" onClose={closeDeleteModal}>
	<div class="space-y-4">
		{#if step === 'confirmDeletion'}
			<p class="text-sm leading-6 text-stone-700">
				This permanently deletes your account and every contract you created, including any existing
				contracts assigned to you when the workspace was initialized. Your colleagues and their
				contracts remain.
			</p>

			<div>
				<label for="delete-account-confirmation" class="block text-xs text-stone-950">
					Type <strong>"delete my account"</strong> to continue
				</label>
				<input
					id="delete-account-confirmation"
					type="text"
					bind:value={confirmationText}
					autocomplete="off"
					class={`${fieldClass} mt-2 h-9`}
					disabled={deleting}
					oninput={() => {
						deleteErrorText = null;
					}}
				/>
			</div>
		{:else}
			<div>
				<h3 class="text-sm leading-tight font-medium text-stone-950">
					{verificationTitle}
				</h3>
				<p class="mt-2 text-sm leading-6 text-stone-700">
					{verificationDescription}
				</p>
			</div>

			{#if verification.status === 'preparing'}
				<p class="text-[0.72rem] leading-5 text-stone-500">Preparing verification...</p>
			{:else if showVerificationInput}
				<div>
					<label for="delete-account-verification" class="block text-xs text-stone-950">
						{verificationTitle}
					</label>
					<input
						id="delete-account-verification"
						type={verificationInputType}
						bind:value={verification.input}
						autocomplete={verificationAutocomplete}
						inputmode={verificationInputMode}
						class={`${fieldClass} mt-2 h-9`}
						disabled={verification.busy || deleting}
						oninput={() => {
							verification.clearError();
						}}
					/>
				</div>
			{:else if showPasskeyPrompt}
				<p class="text-[0.72rem] leading-5 text-stone-500">
					Continue with the passkey prompt to verify your identity.
				</p>
			{/if}
		{/if}

		{#if errorText}
			<p class="text-[0.72rem] leading-5 text-danger">{errorText}</p>
		{/if}
	</div>

	{#snippet footer()}
		{#if step === 'confirmDeletion'}
			<Button variant="secondary" disabled={deleting} onclick={closeDeleteModal}>Cancel</Button>
			<Button
				disabled={!canDeleteAccount || deleting || verification.busy}
				class={destructiveButtonClass}
				onclick={deleteAccount}
			>
				{deleting ? 'Deleting...' : 'Delete account'}
			</Button>
		{:else}
			<Button variant="secondary" disabled={deleting} onclick={closeDeleteModal}>Cancel</Button>
			<Button
				disabled={!verification.canSubmit || deleting || verification.busy}
				class={destructiveButtonClass}
				onclick={verification.submit}
			>
				{deleting ? 'Deleting...' : verificationActionText}
			</Button>
		{/if}
	{/snippet}
</ModalShell>
