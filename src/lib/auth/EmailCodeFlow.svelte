<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { AccountNavigation } from './account-navigation';
	import { useClerkReadiness } from './clerk-readiness';
	import { beginStartupAttempt, recordStartup } from './startup-perf';
	import { page } from '$app/state';
	import { useClerkContext } from 'svelte-clerk';
	import { localReturn } from './navigation';
	import { useSignIn, useSignUp } from 'svelte-clerk';
	import AuthCodeStep from '$lib/auth/components/AuthCodeStep.svelte';
	import AuthEntryShell from '$lib/auth/components/AuthEntryShell.svelte';
	import AuthHotkeyButton from '$lib/auth/components/AuthHotkeyButton.svelte';
	import AuthStepFrame from '$lib/auth/components/AuthStepFrame.svelte';
	import AuthTextInput from '$lib/auth/components/AuthTextInput.svelte';
	import { createClerkEmailCodeAuthController, getClerkErrorCode } from '$lib/auth/email-code-auth';

	type LoginStep = 'login' | 'code';

	let { joining = false }: { joining?: boolean } = $props();
	const clerk = useClerkContext();
	const readiness = useClerkReadiness();
	const navigation = new AccountNavigation(async (destination) => {
		recordStartup('navigation-started');
		await goto(destination, { invalidateAll: true });
		if (page.url.pathname === '/login' || page.url.pathname === '/join')
			throw new Error('Navigation returned to sign-in.');
	});
	let opening = $state(false);
	let hydrated = $state(false);
	let lifetime = new AbortController();
	let observedSession: string | undefined;
	let navigatingSession: string | undefined;
	const returnTo = $derived(localReturn(page.url.searchParams.get('returnTo')));
	const invitationTicket = $derived(page.url.searchParams.get('__clerk_ticket'));
	$effect(() => {
		const id = clerk.session?.id;
		const destination = returnTo;
		untrack(() => {
			if (id === observedSession) return;
			observedSession = id;
			if (id) void openWorkspace(id, destination);
			else showEmailStep();
		});
	});
	async function openWorkspace(id: string, destination: string) {
		if (opening && navigatingSession === id) return;
		cancelPending();
		const current = generation;
		navigatingSession = id;
		opening = true;
		authErrorText = null;
		beginStartupAttempt();
		recordStartup('auth-accepted');
		try {
			await navigation.open(id, destination);
		} catch {
			if (current === generation) authErrorText = 'We couldn’t open your workspace. Try again.';
		} finally {
			if (current === generation) {
				opening = false;
				navigatingSession = undefined;
			}
		}
	}
	let ticketStarted = $state(false);
	$effect(() => {
		const ticket = invitationTicket;
		if (
			joining &&
			ticket &&
			!ticketStarted &&
			!clerk.session &&
			readiness.status === 'ready' &&
			signUpState.signUp
		) {
			ticketStarted = true;
			void acceptTicket(ticket);
		}
	});
	async function acceptTicket(ticket: string) {
		const current = ++generation;
		isSubmittingEmail = true;
		try {
			if (!(await waitForAuth(current))) return;
			await authController.acceptTicket(ticket);
		} catch (error) {
			if (current === generation) authErrorText = authController.getErrorMessage(error);
		} finally {
			if (current === generation) isSubmittingEmail = false;
		}
	}

	const signUpState = useSignUp();
	const signInState = useSignIn();
	const authController = createClerkEmailCodeAuthController({
		getSignIn: () => signInState.signIn,
		getSignUp: () => signUpState.signUp
	});

	let generation = 0;
	function cancelPending() {
		generation++;
		lifetime.abort();
		lifetime = new AbortController();
		authController.reset();
		navigation.reset();
		navigatingSession = undefined;
		opening = false;
		isSubmittingEmail = false;
		isSubmittingCode = false;
		isResendingCode = false;
	}
	onMount(() => {
		hydrated = true;
		recordStartup('sign-in-hydrated');
	});
	onDestroy(() => {
		cancelPending();
		lifetime.abort();
	});

	let step = $state<LoginStep>('login');
	let email = $state('');
	let verificationCode = $state('');
	let authErrorText = $state<string | null>(null);
	let isSubmittingEmail = $state(false);
	let isSubmittingCode = $state(false);
	let isResendingCode = $state(false);

	const joinHref = $derived(
		(joining ? '/login' : '/join') + '?returnTo=' + encodeURIComponent(returnTo)
	);
	const currentReturnButtonHref = undefined;
	const canContinue = $derived(
		hydrated && email.trim().length > 0 && !isSubmittingEmail && !opening
	);
	async function waitForAuth(current: number) {
		await readiness.ready({ signal: lifetime.signal });
		await tick();
		if (current !== generation || opening || clerk.session) return false;
		if (!(joining ? signUpState.signUp : signInState.signIn))
			throw new Error('Sign-in is unavailable. Please try again.');
		return true;
	}
	async function retry() {
		authErrorText = null;
		try {
			await readiness.retry();
		} catch {
			/* The provider exposes the inline connection error. */
		}
	}

	async function submitEmail() {
		const normalizedEmail = email.trim().toLowerCase();
		if (!normalizedEmail || isSubmittingEmail || opening || readiness.status === 'error') return;

		const current = ++generation;
		isSubmittingEmail = true;
		authErrorText = null;
		verificationCode = '';

		try {
			if (!(await waitForAuth(current))) return;
			// An invitation is consumed by its own serialized operation.
			if (joining && invitationTicket && !ticketStarted) return;
			if (joining) await authController.sendJoinCode(normalizedEmail);
			else await authController.sendLoginCode(normalizedEmail);
			if (current !== generation) return;
			email = normalizedEmail;
			step = 'code';
		} catch (error) {
			if (current !== generation) return;
			authErrorText =
				getClerkErrorCode(error) === 'form_identifier_not_found'
					? "Couldn't find your account."
					: authController.getErrorMessage(error);
		} finally {
			if (current === generation) isSubmittingEmail = false;
		}
	}

	async function submitCode() {
		const code = verificationCode.trim();
		if (!code || isSubmittingCode || opening) return;

		const current = generation;
		isSubmittingCode = true;
		authErrorText = null;

		try {
			if (!(await waitForAuth(current))) return;
			await authController.verifyCode(code);
		} catch (error) {
			if (current !== generation) return;
			authErrorText = authController.getErrorMessage(error);
		} finally {
			if (current === generation) isSubmittingCode = false;
		}
	}

	async function resendCode() {
		if (isResendingCode || opening) return;

		const current = generation;
		isResendingCode = true;
		authErrorText = null;

		try {
			if (!(await waitForAuth(current))) return;
			await authController.resendCode();
		} catch (error) {
			if (current !== generation) return;
			authErrorText = authController.getErrorMessage(error);
		} finally {
			if (current === generation) isResendingCode = false;
		}
	}

	function showEmailStep() {
		cancelPending();
		verificationCode = '';
		authErrorText = null;
		step = 'login';
	}
</script>

<AuthEntryShell
	accent="link"
	onReturnButtonClick={step === 'code' ? showEmailStep : undefined}
	returnButtonHref={currentReturnButtonHref}
	showFooter={step === 'login'}
>
	{#snippet footer()}
		<p class="m-0 text-[13px] leading-5 text-[#8f9297]">
			{joining ? 'Already have an account?' : 'Need an account?'}
			<a
				href={joinHref}
				class="text-stone-500 underline underline-offset-2 transition-colors hover:text-[#202124]"
			>
				{joining ? 'Log in' : 'Join'}
			</a>
		</p>
	{/snippet}

	{#if opening}
		<p role="status" class="text-sm text-ink-muted">Opening your workspace…</p>
	{:else if clerk.session}
		<AuthStepFrame title="Open your workspace">
			{#if authErrorText}
				<p role="alert" class="m-0 text-sm leading-5 text-[#ff3a1e]">{authErrorText}</p>
			{/if}
			<AuthHotkeyButton onclick={() => void openWorkspace(clerk.session!.id, returnTo)}>
				Try again
			</AuthHotkeyButton>
		</AuthStepFrame>
	{:else if step === 'login'}
		<AuthStepFrame title={joining ? 'Join Agreed' : 'Log in to Agreed'}>
			<form
				class="grid gap-3.5"
				onsubmit={(event) => {
					event.preventDefault();
					if (canContinue) {
						void submitEmail();
					}
				}}
			>
				<AuthTextInput
					label="Your work email"
					bind:value={email}
					type="email"
					autocomplete="email"
					required
					autofocus
					invalid={Boolean(authErrorText)}
				/>
				{#if readiness.error || authErrorText}
					<p role="alert" class="m-0 text-sm leading-5 text-[#ff3a1e]">
						{readiness.error || authErrorText}
					</p>
				{/if}
				{#if readiness.status === 'error'}
					<button type="button" class="text-sm underline" onclick={() => void retry()}
						>Try again</button
					>
				{/if}
				<AuthHotkeyButton type="submit" disabled={!canContinue || readiness.status === 'error'}>
					{isSubmittingEmail
						? readiness.status === 'ready'
							? 'Sending…'
							: 'Connecting…'
						: 'Email me a code'}
				</AuthHotkeyButton>
			</form>
		</AuthStepFrame>
	{:else}
		<AuthCodeStep
			{email}
			bind:code={verificationCode}
			errorText={authErrorText}
			isSubmitting={isSubmittingCode}
			isResending={isResendingCode}
			onSubmit={() => void submitCode()}
			onResend={() => void resendCode()}
			onChangeEmail={showEmailStep}
		/>
	{/if}
</AuthEntryShell>
