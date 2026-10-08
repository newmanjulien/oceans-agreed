<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { useViewerSession } from '$lib/auth/viewer-session.svelte';
	import { ConnectionInterruptedError } from '$lib/auth/convex-session.svelte';
	import { useConvexClient, usePaginatedQuery } from 'convex-svelte';
	import type { FunctionReturnType } from 'convex/server';
	import { api } from '../../../convex/_generated/api';
	import AppHeader from '$lib/components/chrome/AppHeader.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import InviteColleaguesModal from '$lib/features/settings/InviteColleaguesModal.svelte';
	import { Button } from '$lib/ui';
	import { fieldClass } from '$lib/ui/field-styles';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	const client = useConvexClient();
	const session = useViewerSession();
	const colleagues = usePaginatedQuery(api.profiles.colleagues, {}, { initialNumItems: 50 });
	const people = $derived(colleagues.results);
	let invitations = $state<FunctionReturnType<typeof api.clerk.invitations>['page']>([]);
	let total = $state(0);
	let loading = $state(true);
	let search = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let modalOpen = $state(false);
	let emailInput = $state('');
	let sending = $state(false);
	let error = $state<string | null>(null);
	let modalError = $state<string | null>(null);
	let busy = $state(false);
	let alive = true;
	let epoch = 0;
	onDestroy(() => {
		alive = false;
		epoch++;
		clearTimeout(searchTimer);
	});
	function changeSearch(value: string) {
		const changed = value.trim() !== search.trim();
		search = value;
		if (!changed) return;
		epoch++;
		clearTimeout(searchTimer);
		error = null;
		invitations = [];
		total = 0;
		loading = true;
		searchTimer = setTimeout(() => void loadInvitations(), 250);
	}
	async function loadInvitations() {
		clearTimeout(searchTimer);
		if (!alive || session.blocked) return;
		const generation = ++epoch;
		const transportGeneration = session.transportGeneration;
		loading = true;
		error = null;
		try {
			const page = await client.action(api.clerk.invitations, {
				query: search.trim() || undefined
			});
			if (!alive || epoch !== generation || session.transportGeneration !== transportGeneration)
				return;
			invitations = [
				...new Map(page.page.map((invitation) => [invitation.id, invitation])).values()
			];
			total = page.total;
		} catch (e) {
			if (alive && epoch === generation)
				error = e instanceof Error ? e.message : 'Could not load invitations.';
		} finally {
			if (alive && epoch === generation) loading = false;
		}
	}
	$effect(() => {
		// Reload when the session transport changes, even if it stays ready.
		session.transportGeneration;
		if (!session.blocked) untrack(() => void loadInvitations());
	});
	async function invite() {
		if (!alive || session.blocked || sending) return;
		const generation = session.transportGeneration;
		const emails = [
			...new Set(
				emailInput
					.split(/[;,\n]/)
					.map((email) => email.trim().toLowerCase())
					.filter(Boolean)
			)
		];
		if (!emails.length || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
			modalError = 'Enter valid email addresses separated by commas.';
			return;
		}
		sending = true;
		modalError = null;
		let confirmed = 0;
		emailInput = emails.join(', ');
		try {
			for (const email of emails) {
				if (session.blocked || session.transportGeneration !== generation)
					throw new ConnectionInterruptedError();
				await client.action(api.clerk.invite, { email });
				if (!alive) return;
				if (session.transportGeneration !== generation) throw new ConnectionInterruptedError();
				confirmed++;
				emailInput = emails.slice(confirmed).join(', ');
			}
			if (alive) {
				modalOpen = false;
			}
		} catch (e) {
			if (alive) modalError = e instanceof Error ? e.message : 'Could not send invitations.';
		} finally {
			if (alive) {
				sending = false;
				// Refresh even when an interrupted action had no confirmed response.
				void loadInvitations();
			}
		}
	}
	async function changeInvitation(id: string, resend: boolean) {
		if (!alive || session.blocked || busy) return;
		busy = true;
		const generation = epoch;
		const transportGeneration = session.transportGeneration;
		error = null;
		try {
			await client.action(api.clerk.revoke, { id, resend });
			if (alive && session.transportGeneration === transportGeneration) await loadInvitations();
		} catch (e) {
			if (alive && epoch === generation)
				error =
					e instanceof Error
						? e.message
						: 'Could not update invitation. Refresh to check its status.';
		} finally {
			if (alive) busy = false;
		}
	}
</script>

<svelte:head><title>Invite colleagues · Agreed</title></svelte:head>
<AppHeader />
<main
	class="min-h-[calc(100dvh-var(--app-header-height))] w-full bg-surface px-3 py-4 md:px-6 md:py-6"
>
	<div class="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-10 md:gap-7 md:pb-16">
		<div class="flex items-center justify-between gap-4">
			<h1 class="text-[0.82rem] leading-5 font-medium text-stone-950">Invite colleagues</h1>
			<Button
				onclick={() => {
					modalError = null;
					modalOpen = true;
				}}>Invite colleagues</Button
			>
		</div>

		<section aria-labelledby="registered-colleagues-heading">
			<h2 id="registered-colleagues-heading" class="mb-3 text-[0.82rem] leading-5 text-stone-950">
				Registered colleagues
			</h2>
			<div class="overflow-hidden rounded-xl border border-[#e5e5e5] bg-surface">
				{#if people.length}
					<ul class="divide-y divide-[#e5e5e5]">
						{#each people as person (person.id)}
							{@const name = person.name?.trim()}
							<li class="flex min-h-14 items-center gap-3 px-4 py-3">
								<Avatar
									name={name || person.email}
									avatarUrl={person.avatarUrl}
									size={28}
									decorative
								/>
								<div class="min-w-0 flex-1">
									<p
										class="truncate text-[0.74rem] leading-5 text-stone-950"
										title={name || person.email}
									>
										{name || person.email}
									</p>
									{#if name && name.toLowerCase() !== person.email.toLowerCase()}
										<p
											class="truncate text-[0.72rem] leading-5 text-stone-500"
											title={person.email}
										>
											{person.email}
										</p>
									{/if}
								</div>
								<span class="shrink-0 text-[0.72rem] leading-5 text-stone-500">
									{person.role === 'admin' ? 'Admin' : 'Rep'}
								</span>
							</li>
						{/each}
					</ul>
				{:else if !colleagues.error}
					<p role="status" class="px-4 py-5 text-[0.74rem] leading-5 text-stone-500">
						{colleagues.status === 'LoadingFirstPage'
							? 'Loading colleagues...'
							: 'No registered colleagues yet.'}
					</p>
				{/if}
				{#if colleagues.error}
					<p role="alert" class="px-4 py-3 text-[0.72rem] leading-5 text-red-700">
						{colleagues.error.message}
					</p>
				{/if}
			</div>
			{#if colleagues.status === 'CanLoadMore' || colleagues.status === 'LoadingMore'}
				<div class="mt-3 flex justify-end">
					<Button
						variant="secondary"
						disabled={colleagues.status === 'LoadingMore'}
						onclick={() => colleagues.loadMore(50)}
					>
						{colleagues.status === 'LoadingMore' ? 'Loading...' : 'More colleagues'}
					</Button>
				</div>
			{/if}
		</section>

		<section aria-labelledby="pending-invitations-heading">
			<h2 id="pending-invitations-heading" class="mb-3 text-[0.82rem] leading-5 text-stone-950">
				Pending invitations
			</h2>
			<div class="mb-3 flex flex-wrap items-center gap-3">
				<div class="relative min-w-0 flex-1 basis-48">
					<label for="invitation-search" class="sr-only">Search invitations by email</label>
					<MagnifyingGlassIcon
						size={16}
						aria-hidden="true"
						class="pointer-events-none absolute top-2.5 left-3 text-stone-400"
					/>
					<input
						id="invitation-search"
						type="search"
						value={search}
						placeholder="Search by email"
						class={`${fieldClass} h-9 pl-9`}
						oninput={(event) => changeSearch(event.currentTarget.value)}
					/>
				</div>
				<Button variant="secondary" disabled={loading} onclick={() => loadInvitations()}>
					{loading ? 'Refreshing...' : 'Refresh invitations'}
				</Button>
			</div>
			<div
				class="overflow-hidden rounded-xl border border-[#e5e5e5] bg-surface"
				aria-busy={loading}
			>
				{#if invitations.length}
					<ul class="divide-y divide-[#e5e5e5]">
						{#each invitations as invitation (invitation.id)}
							<li class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
								<div class="flex min-w-0 flex-1 basis-48 items-center gap-3">
									<Avatar name={invitation.email} avatarUrl={null} size={28} decorative />
									<div class="min-w-0 flex-1">
										<p
											class="truncate text-[0.74rem] leading-5 text-stone-950"
											title={invitation.email}
										>
											{invitation.email}
										</p>
										<p class="text-[0.72rem] leading-5 text-stone-500">Pending</p>
									</div>
								</div>
								<div class="ml-auto flex items-center gap-2">
									<Button
										variant="secondary"
										aria-label={`Resend invitation to ${invitation.email}`}
										disabled={busy}
										onclick={() => changeInvitation(invitation.id, true)}>Resend</Button
									>
									<Button
										variant="ghost"
										aria-label={`Revoke invitation to ${invitation.email}`}
										disabled={busy}
										onclick={() => changeInvitation(invitation.id, false)}>Revoke</Button
									>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				{#if error}
					<p role="alert" class="px-4 py-5 text-[0.72rem] leading-5 text-red-700">{error}</p>
				{:else if !invitations.length}
					<p role="status" class="px-4 py-5 text-[0.74rem] leading-5 text-stone-500">
						{loading
							? 'Loading invitations...'
							: search.trim()
								? 'No invitations match your search.'
								: 'No pending invitations.'}
					</p>
				{/if}
			</div>
			{#if !loading && !error && total > invitations.length}
				<p class="mt-3 text-[0.72rem] leading-5 text-stone-500">
					Showing the newest 500 matching invitations. Narrow your search to find others.
				</p>
			{/if}
		</section>
	</div>
</main>
<InviteColleaguesModal
	open={modalOpen}
	value={emailInput}
	error={modalError}
	isAdding={sending}
	onClose={() => {
		if (!sending) modalOpen = false;
	}}
	onSubmit={invite}
	onValueChange={(value) => {
		if (!sending) emailInput = value;
	}}
/>
