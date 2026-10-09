<script lang="ts">
	import { untrack, onMount, onDestroy, tick } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { createContractWorkspace, setContractWorkspace } from '$lib/document/runtime/context';
	import {
		recordAdminQueryOwner,
		recordAdminSourceUpdate,
		recordContractInput
	} from '$lib/document/runtime/render-perf';
	import { sameSourceRange, snapshotPreviewChanges } from '$lib/document/runtime/types';
	import { env } from '$env/dynamic/public';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api';
	import type { ContractSourceInput } from '$lib/document/runtime/source.svelte';
	import { AuthoringSession } from '$lib/playbook/authoring.svelte';
	import { convexSaveTransport } from '$lib/playbook/save-transport';
	import type { OperationStatus } from '$lib/components/chrome/operation-status';
	import { AuthoringFlow } from '$lib/playbook/authoring-flow.svelte';
	import { getDocumentResources } from '$lib/document/runtime/resources.svelte';
	import DocumentViewerSlot from '$lib/components/document/DocumentViewerSlot.svelte';
	import LoadingPagination from '$lib/components/document/LoadingPagination.svelte';
	import SourceSelectionToolbar from '$lib/components/document/SourceSelectionToolbar.svelte';
	import PlaybookEditor from '$lib/components/playbook/PlaybookEditor.svelte';
	import WorkspaceChrome from './WorkspaceChrome.svelte';
	import { setInteractionOwner } from '$lib/components/ui/interactions';
	import { useViewer, useViewerSession } from '$lib/auth/viewer-session.svelte';

	const client = env.PUBLIC_CONVEX_URL ? useConvexClient() : null;
	const session = useViewerSession();
	const accountViewer = useViewer();
	const membershipId = accountViewer().membership.id;
	const data: ContractSourceInput = client
		? {
				blocks: useQuery(api.contract.getBlocks, { membershipId }),
				items: useQuery(api.playbookItems.list, { membershipId })
			}
		: { blocks: { error: true }, items: { error: true } };
	onMount(() => (client ? recordAdminQueryOwner() : undefined));
	const resources = getDocumentResources();
	const resource = resources ? untrack(() => resources.acquire('admin', data)) : undefined;
	if (resource && resources) untrack(() => resources.activate(resource));
	onDestroy(() => {
		if (resource && resources) resources.deactivate(resource);
	});
	setInteractionOwner(resource?.owner ?? Symbol('authoring-workspace'));
	const workspace = setContractWorkspace(
		resource?.workspace ?? untrack(() => createContractWorkspace(data))
	);
	const { source, renderer, viewer } = workspace;
	const authoring = new AuthoringSession(client ? convexSaveTransport(client, membershipId) : null);
	$effect(() => {
		const { compiled, geometry, geometryVersion, items } = source;
		void geometryVersion;
		untrack(() => authoring.accept(compiled, geometry, items));
	});
	let feedback = $state<OperationStatus | null>(null);
	$effect(() => {
		const completion = authoring.completion;
		feedback = completion
			? { message: completion.kind === 'saved' ? 'Changes saved' : 'Box deleted.' }
			: null;
		if (!completion) return;
		const timer = setTimeout(() => {
			feedback = null;
		}, 2500);
		return () => clearTimeout(timer);
	});
	$effect(() => {
		workspace.accept(data);
		recordAdminSourceUpdate();
	});
	const flow: AuthoringFlow = new AuthoringFlow(authoring, () => ({
		index: source.compiled?.index ?? null,
		geometry: source.geometry,
		items: source.items,
		available: viewer.ready
	}));
	const entry = $derived(flow.entry);
	const draft = $derived(flow.draft);
	const previewConcession = $derived(
		flow.creationConcession ??
			draft?.concessions.find((concession) => concession.id === flow.previewConcessionId)
	);
	const previewChanges = $derived(
		snapshotPreviewChanges(
			previewConcession?.changes.filter((change) =>
				change.replacement.some((atom) => atom.kind === 'reference' || Boolean(atom.text.trim()))
			) ?? []
		)
	);
	onMount(() =>
		session.registerEditor({
			get pending() {
				return flow.hasUnsavedWork;
			},
			flush: async () => (await authoring.flush()) && !flow.addingConcession,
			retry: () => {
				void authoring.retry();
			},
			suspend: () => {},
			resume: () => {},
			freeze: () => {},
			discard: () => {
				flow.cancelAddition();
				authoring.discard();
			},
			restartTransport: () => authoring.restartTransport()
		})
	);
	onDestroy(() => authoring.restartTransport());
	// Each selection stays blue until its own replacement participates in the preview.
	const authoringHighlightRanges = $derived(
		flow.selectedRanges.filter(
			(range) => !previewChanges.some((change) => sameSourceRange(range, change.range))
		)
	);
	/** Restore the captured annotation only when an action actually closes the editor. */
	async function runEditorAction(action: () => boolean | Promise<boolean>) {
		const restore = viewer.captureAnnotationFocus?.();
		if (!(await action())) return;
		await tick();
		restore?.();
	}
	function cancel() {
		if (flow.addingConcession) flow.cancelAddition();
		else void runEditorAction(() => flow.cancel());
	}
	function remove() {
		if (!authoring.canDelete) return;
		if (
			!window.confirm(
				'Permanently delete this instruction box? Any unsaved local edits will also be discarded.'
			)
		)
			return;
		void runEditorAction(() => authoring.remove());
		flow.clearFeedback();
	}
	beforeNavigate((navigation) => {
		if (session.closing) return;
		if (session.blocked && !navigation.willUnload) {
			navigation.cancel();
			return;
		}
		// Document unload uses the browser warning below, without discarding first.
		if (navigation.willUnload) return;
		if (authoring.unresolved) {
			navigation.cancel();
			flow.editError = 'Resolve the current operation before leaving this instruction box.';
			return;
		}
		if (
			flow.hasUnsavedWork &&
			!window.confirm('Abandon your unsaved instruction-box changes and leave?')
		) {
			navigation.cancel();
			return;
		}
		flow.cancel();
	});
	onMount(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (session.closing) return;
			if (!flow.hasUnsavedWork) return;
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', warn);
		return () => {
			window.removeEventListener('beforeunload', warn);
		};
	});
</script>

<WorkspaceChrome variant="admin" {feedback} />
{#if source.renderSource}
	<main
		oninputcapture={recordContractInput}
		onclickcapture={recordContractInput}
		class="pt-14 pb-12 admin-selection-enabled min-[1000px]:pt-6"
		aria-label="Contract authoring"
	>
		<h1 class="mb-5 px-2 text-center text-[13px] leading-6 text-ink-muted/50">
			Edit the instructions reps will see
		</h1>
		{#snippet panelContent()}{#if entry && source.renderSource}{#key entry.key}<PlaybookEditor
						{flow}
						onCancel={cancel}
						onPrimary={() =>
							runEditorAction(() => (flow.creating ? flow.next() : authoring.save()))}
						onRetry={() => runEditorAction(() => authoring.retry())}
						onDelete={remove}
					/>{/key}{/if}{/snippet}
		{#if !entry && flow.feedback}<p
				class="mx-auto max-w-3xl px-6 text-sm text-danger"
				role="status"
			>
				{flow.feedback}
			</p>{/if}
		<DocumentViewerSlot
			entry={resource}
			hasPanel={Boolean(draft)}
			followScroll={flow.otherClauseActive}
			{panelContent}
			selectedAnnotationId={flow.selectedAnnotationId}
			selectedRanges={authoringHighlightRanges}
			{previewChanges}
			selectedConcessions={{}}
			onRemoveConcession={() => (flow.previewConcessionId = null)}
			panelSource={draft?.triggers[0]?.range.start}
			picking={flow.picking}
			allowPlaybookNavigation={!flow.creating}
			onSelect={(itemId, triggerId) => flow.openItem(itemId, triggerId)}
		/>
	</main>
	{#if viewer.ready && viewer.displayedSnapshot}<SourceSelectionToolbar
			container={viewer.documentStageElement}
			snapshot={viewer.displayedSnapshot}
			enabled={flow.selectionMode !== 'inactive'}
			autoConfirm={flow.picking}
			onSelectionIssue={(issue) => flow.reportIssue(issue)}
			onGestureStart={() => flow.clearFeedback()}
			evaluate={(range) => flow.selectionEligibility(range)}
			onConfirm={(range, mode) => flow.acceptSelection(range, mode)}
		/>{/if}
{:else if source.issue}<p role="alert">
		We couldn’t load this contract. Please refresh to try again.
	</p>
{:else}<LoadingPagination label="Loading contract" />{/if}
