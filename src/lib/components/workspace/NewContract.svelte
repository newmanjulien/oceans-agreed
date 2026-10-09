<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { beforeNavigate, goto, preloadCode } from '$app/navigation';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { ConvexError } from 'convex/values';
	import { useViewer, useViewerSession } from '$lib/auth/viewer-session.svelte';
	import { ConnectionInterruptedError } from '$lib/auth/convex-session.svelte';
	import { api } from '../../../convex/_generated/api';
	import type { Id } from '../../../convex/_generated/dataModel';
	import { beginCreation, creationPhase } from '$lib/contract/creation-perf';
	import { saveError } from '$lib/contract/saved';
	import AppHeader from '$lib/components/chrome/AppHeader.svelte';
	import CompanyNameDialog from '$lib/components/ui/modal/CompanyNameDialog.svelte';
	import { getContractSnapshotCache } from '$lib/contract/snapshot-cache';
	import type { ContractSnapshot } from '$lib/contract/saved';
	import {
		getDocumentResources,
		type DocumentResource,
		type ReadyContract
	} from '$lib/document/runtime/resources.svelte';
	import ContractPreview from './ContractPreview.svelte';
	let {
		onOpen,
		showPreview = true
	}: {
		onOpen: (id: Id<'savedContracts'>) => Promise<boolean>;
		showPreview?: boolean;
	} = $props();
	const client = useConvexClient();
	const session = useViewerSession();
	const viewer = useViewer();
	const membershipId = viewer().membership.id;
	const cache = getContractSnapshotCache();
	const resources = getDocumentResources();
	let createdId = $state<Id<'savedContracts'> | null>(null);
	const published = useQuery(api.templates.current, () => (createdId ? 'skip' : { membershipId }));
	const preview = $derived(published.error ? undefined : published.data?.snapshot);
	let draft = $state.raw<DocumentResource>();
	let draftSnapshot: ContractSnapshot | undefined;
	let draftVersion: Id<'templateVersions'> | undefined;
	let host = $state<HTMLDivElement>();
	let confirmed: ReadyContract['contract'] | undefined;
	$effect(() => {
		const current = published.data;
		if (!current || createdId) return;
		untrack(() => {
			draftSnapshot = current.snapshot;
			draftVersion = current.versionId;
			if (!resources) return;
			const input = {
				blocks: { data: current.snapshot.blocks },
				items: { data: current.snapshot.items }
			};
			if (draft) draft.workspace.accept(input);
			else draft = resources.createDraft(input);
		});
	});
	$effect(() => {
		const entry = draft,
			target = host;
		if (!entry || !target) return;
		entry.target = target;
		return () => {
			if (entry.target === target) entry.target = undefined;
		};
	});
	let busy = $state(false);
	let error = $state<string | null>(null);
	let deleted = $state(false);
	let creationRequest:
		{ args: { companyName: string; operationId: string }; uncertain: boolean } | undefined;
	let active = true;
	onDestroy(() => {
		active = false;
		if (draft && resources) resources.releaseDraft(draft);
	});
	onMount(() => {
		void preloadCode('/contracts/_').catch(() => {});
	});
	beforeNavigate((navigation) => {
		if (session.closing) return;
		if (session.blocked && !navigation.willUnload) {
			navigation.cancel();
			return;
		}
		if (busy && navigation.to?.url.pathname !== `/contracts/${createdId}`) navigation.cancel();
	});
	async function submit(companyName: string) {
		if (!active || session.blocked || busy || deleted) return;
		const generation = session.transportGeneration;
		beginCreation(Boolean(draft?.workspace.viewer.prepared));
		busy = true;
		error = null;
		try {
			if (!createdId) {
				creationRequest ??= {
					args: { companyName, operationId: crypto.randomUUID() },
					uncertain: false
				};
				const result = await client.mutation(api.savedContracts.create, {
					...creationRequest.args,
					membershipId
				});
				if (!active) return;
				if (session.transportGeneration !== generation) throw new ConnectionInterruptedError();
				if (result.status === 'deleted') {
					deleted = true;
					throw new Error('deleted');
				}
				createdId = result.id;
				confirmed = result.contract;
				creationPhase('confirmed');
			}
			const contract = confirmed!;
			const versionId = contract.templateVersionId;
			if (!versionId) throw new Error('Missing template version');
			const snapshot =
				draftVersion === versionId && draftSnapshot
					? draftSnapshot
					: await client.query(api.templates.version, { membershipId, versionId });
			if (!active) return;
			if (session.transportGeneration !== generation) throw new ConnectionInterruptedError();
			draftVersion = versionId;
			draftSnapshot = snapshot;
			const data: ReadyContract = { id: createdId, status: 'ready', contract, snapshot };
			if (resources) {
				if (!draft)
					draft = resources.createDraft({
						blocks: { data: snapshot.blocks },
						items: { data: snapshot.items }
					});
				resources.adopt(draft, data);
				creationPhase('adopted');
			}
			if (!cache.seedConfirmed(data)) throw new Error('Contract unavailable');
			creationPhase('snapshot-ready');
			creationPhase('navigation-start');
			if (!(await onOpen(createdId))) throw new Error('navigation');
			if (active) creationPhase('displayed');
		} catch (cause) {
			if (!active) return;
			if (!createdId && creationRequest) {
				// A rejected first attempt rolled back. A later rejection cannot resolve
				// an earlier uncertain attempt, so keep its original identity and arguments.
				if (cause instanceof ConvexError && !creationRequest.uncertain) creationRequest = undefined;
				else creationRequest.uncertain = true;
			}
			creationPhase('failed');
			if (createdId && cache.isDeleted(createdId)) deleted = true;
			if (active)
				error = deleted
					? 'This contract was deleted. Return to Home to start another contract.'
					: createdId
						? 'Your contract was created, but we couldn’t open it. Try again.'
						: saveError(cause, 'We couldn’t create this contract. Try again.');
		} finally {
			if (active) busy = false;
		}
	}
	async function cancel() {
		if (busy) return;
		try {
			await goto('/');
		} catch {
			error = 'We couldn’t return to Home. Try again.';
		}
	}
</script>

{#if showPreview}<AppHeader />
	<main inert aria-hidden="true" class="pointer-events-none pt-6 pb-12 blur-sm">
		{#if resources}
			<div bind:this={host}></div>
		{:else if preview}
			<ContractPreview snapshot={preview} />
		{:else}
			<div
				class="mx-auto min-h-[1000px] w-[min(816px,calc(100%-32px))] border border-line bg-white p-12 shadow-sm"
			>
				<div class="mx-auto mb-12 h-5 w-2/3 rounded bg-fill-subtle"></div>
				{#each Array(36) as _, i}
					<div
						class="mb-3 h-2.5 rounded bg-fill-subtle"
						style:width={i % 7 === 6 ? '65%' : '100%'}
					></div>
				{/each}
			</div>
		{/if}
	</main>{/if}
<CompanyNameDialog
	title="Name your contract"
	submitLabel={deleted ? 'Back to Home' : createdId ? 'Open contract' : 'Create contract'}
	busyLabel={createdId ? 'Opening…' : 'Creating…'}
	lockName={Boolean(createdId) || deleted}
	{busy}
	{error}
	onSubmit={(name) => void (deleted ? cancel() : submit(name))}
	onClose={() => void cancel()}
/>
