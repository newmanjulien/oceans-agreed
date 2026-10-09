<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api';
	import AuthTextInput from './components/AuthTextInput.svelte';
	import AuthButton from './components/AuthButton.svelte';
	import AuthStepFrame from './components/AuthStepFrame.svelte';
	import LoadingWheel from '$lib/ui/LoadingWheel.svelte';
	import { useAccount, useViewerSession } from './viewer-session.svelte';
	import { workspaceDestination } from './navigation';
	import { recordStartup } from './startup-perf';

	const account = useAccount();
	const client = useConvexClient();
	const session = useViewerSession();
	let step = $state<'choose' | 'create' | 'join'>('choose');
	const joining = $derived(step === 'join' && !account()?.membership);
	const invitations = useQuery(api.companyInvitations.inbox, () => (joining ? {} : 'skip'));
	const destination = $derived(workspaceDestination(page.url.searchParams.get('returnTo')));
	let invitationsTimedOut = $state(false);
	$effect(() => {
		void session.transportGeneration;
		const loading = invitations.isLoading;
		untrack(() => (invitationsTimedOut = false));
		if (!joining || !loading) return;
		const timer = setTimeout(() => (invitationsTimedOut = true), 15_000);
		return () => clearTimeout(timer);
	});
	onMount(() => recordStartup('usable'));
	let name = $state('');
	let pending = $state(false);
	let error = $state('');
	let alive = true;
	onDestroy(() => (alive = false));
	$effect(() => {
		if (account()?.membership && !pending)
			untrack(
				() =>
					void goto(destination, { replaceState: true }).catch(
						() => (error = 'We couldn’t open your workspace. Please reload.')
					)
			);
	});
	function showStep(next: typeof step) {
		if (pending) return;
		error = '';
		step = next;
	}
	async function run(work: () => Promise<unknown>) {
		if (pending || session.blocked) return;
		const generation = session.transportGeneration;
		const active = () => alive && generation === session.transportGeneration;
		pending = true;
		error = '';
		try {
			await work();
			if (active()) await goto(destination, { replaceState: true });
		} catch (e) {
			if (active())
				error = e instanceof Error ? e.message : 'Unable to join your company. Please try again.';
		} finally {
			if (alive) pending = false;
		}
	}
</script>

<svelte:head><title>Set up your company | Agreed</title></svelte:head>

{#if account()?.membership}
	<div class="flex justify-center py-8"><LoadingWheel label="Opening your workspace" /></div>
	{#if error}<p role="alert" class="text-center text-sm text-danger">{error}</p>{/if}
{:else}
	<AuthStepFrame
		title={step === 'create'
			? 'About your company'
			: step === 'join'
				? 'Join your team'
				: 'Get started with your team'}
		description={step === 'create'
			? 'Create a private company to manage contracts with your colleagues.'
			: step === 'join'
				? 'Accept an invitation to work with your colleagues on Agreed.'
				: 'Create a company for your team, or join one through a colleague’s invitation.'}
	>
		<div class="grid gap-3.5">
			{#if step === 'choose'}
				<AuthButton onclick={() => showStep('create')}>Create a company</AuthButton>
				<button
					class="rounded-button-lg border border-stone-200 px-4 py-3 text-sm hover:bg-stone-50"
					onclick={() => showStep('join')}>Join your team</button
				>
			{:else if step === 'create'}
				<form
					class="grid gap-3.5"
					onsubmit={(event) => {
						event.preventDefault();
						if (name.trim())
							void run(() => client.mutation(api.companies.create, { name: name.trim() }));
					}}
				>
					<AuthTextInput
						label="Your company's name"
						bind:value={name}
						autocomplete="organization"
						maxlength={120}
						required
						autofocus
						disabled={pending}
					/>
					<AuthButton type="submit" disabled={pending || session.blocked || !name.trim()}
						>{pending ? 'Creating…' : 'Create company'}</AuthButton
					>
					<p class="m-0 text-center text-xs leading-5 text-[#8f9297]">
						You can invite colleagues once your company is set up.
					</p>
				</form>
			{:else if invitations.error || invitationsTimedOut}
				<p role="alert" class="text-center text-sm text-danger">Unable to load invitations.</p>
				<button class="text-sm underline" onclick={() => session.retryAuth()}>Try again</button>
			{:else if invitations.data?.length}
				{#each invitations.data as invitation (invitation.id)}
					<div class="rounded-xl border border-stone-200/60 p-5">
						<p class="text-sm font-medium break-words">{invitation.companyName}</p>
						<p class="mt-1 mb-5 text-xs leading-5 break-words text-stone-500">
							Invited by {invitation.inviterName}
						</p>
						<AuthButton
							disabled={pending || session.blocked}
							onclick={() =>
								void run(() =>
									client.mutation(api.companyInvitations.accept, { invitationId: invitation.id })
								)}>{pending ? 'Joining…' : 'Join company'}</AuthButton
						>
					</div>
				{/each}
			{:else if invitations.data}
				<p class="text-center text-sm leading-6 text-[#686b73]">
					Ask a colleague to invite <span class="break-words text-ink"
						>{account()!.profile.email}</span
					>. Your invitation will appear here automatically.
				</p>
			{:else}
				<div class="flex justify-center py-6"><LoadingWheel label="Loading invitations" /></div>
			{/if}
			{#if error}<p role="alert" class="text-center text-sm leading-5 text-danger">{error}</p>{/if}
			{#if step !== 'choose'}<button
					class="mt-3 text-[13px] text-stone-500 underline underline-offset-2"
					disabled={pending}
					onclick={() => showStep('choose')}>Back</button
				>{/if}
		</div>
	</AuthStepFrame>
{/if}
