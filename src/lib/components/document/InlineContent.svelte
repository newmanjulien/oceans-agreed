<script lang="ts">
	import { getAnnotationRegistry } from '$lib/document/annotation-registry';
	import type { InlineToken } from '$lib/document/pagination/types';
	import { annotationSegment, type AnnotationSegment } from '$lib/playbook/document-overlay';
	import type { AnnotationActivation } from '$lib/document/annotation-anchor';
	import RevisionText from './RevisionText.svelte';
	import { protectedInteraction } from '$lib/components/ui/interactions';
	const protect = protectedInteraction();

	const registry = getAnnotationRegistry();
	function registerOwner(owner: HTMLElement, memberships: readonly string[]) {
		let release = registry?.register(owner, memberships);
		return {
			update(next: readonly string[]) {
				if (memberships.length === next.length && memberships.every((id, i) => id === next[i]))
					return;
				release?.();
				release = registry?.register(owner, next);
				memberships = next;
			},
			destroy() {
				release?.();
			}
		};
	}

	interface Segment extends AnnotationSegment {
		tokens: InlineToken[];
	}

	let {
		tokens,
		profileMode = false,
		interactive = true,
		navigationCapable = false,
		selectedAnnotationId,
		canOpenPlaybookItems,
		onAnnotationSelect
	}: {
		tokens: readonly InlineToken[];
		profileMode?: boolean;
		interactive?: boolean;
		navigationCapable?: boolean;
		selectedAnnotationId: string | null;
		canOpenPlaybookItems: boolean;
		onAnnotationSelect: (
			itemId: string,
			annotationId: string,
			activation: AnnotationActivation
		) => void;
	} = $props();

	function segmentTokensByAnnotation(items: readonly InlineToken[]): Segment[] {
		const segments: Segment[] = [];
		for (const token of items) {
			const descriptor = annotationSegment(token.annotations);
			const previous = segments.at(-1);
			if (previous && previous.membershipKey === descriptor.membershipKey)
				previous.tokens.push(token);
			else segments.push({ ...descriptor, tokens: [token] });
		}
		return segments;
	}

	function handleKeydown(event: KeyboardEvent, itemId: string, annotationId: string) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		if (!canOpenPlaybookItems || event.repeat) return;
		onAnnotationSelect(itemId, annotationId, { owner: event.currentTarget as HTMLElement });
	}

	let segments = $derived(segmentTokensByAnnotation(tokens));
</script>

{#each segments as segment}
	{#if segment.target}
		{@const selected =
			selectedAnnotationId !== null && segment.membershipIds.includes(selectedAnnotationId)}
		<!-- Mounted semantics and ownership survive temporary action unavailability. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<span
			use:protect={interactive && !profileMode}
			use:registerOwner={profileMode ? [] : segment.membershipIds}
			class="playbook-trigger"
			role={navigationCapable && !profileMode ? 'button' : undefined}
			tabindex={navigationCapable && !profileMode ? 0 : undefined}
			aria-label={navigationCapable &&
			!profileMode &&
			segment.tokens.every((token) => !token.value.trim())
				? 'Open playbook item'
				: undefined}
			aria-pressed={navigationCapable && !profileMode ? selected : undefined}
			aria-disabled={navigationCapable && !profileMode ? !canOpenPlaybookItems : undefined}
			data-annotation-selected={profileMode ? undefined : selected}
			data-item-id={profileMode ? undefined : segment.target.itemId}
			data-annotation-id={profileMode ? undefined : segment.target.id}
			data-annotation-memberships={profileMode ? undefined : JSON.stringify(segment.membershipIds)}
			onkeydown={navigationCapable && !profileMode
				? (event) => handleKeydown(event, segment.target!.itemId, segment.target!.id)
				: undefined}
		>
			<RevisionText tokens={segment.tokens} {profileMode} />
		</span>
	{:else}
		<RevisionText tokens={segment.tokens} {profileMode} />
	{/if}
{/each}
