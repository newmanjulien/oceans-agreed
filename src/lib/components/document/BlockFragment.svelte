<script lang="ts">
	import type { AnnotationActivation } from '$lib/document/annotation-anchor';
	import InlineContent from './InlineContent.svelte';
	import { fragmentKey, type PageFragment } from '$lib/document/pagination/types';

	let {
		fragment,
		profileMode = false,
		interactive = true,
		navigationCapable = false,
		selectedAnnotationId,
		canOpenPlaybookItems,
		onAnnotationSelect
	}: {
		fragment: PageFragment;
		/** Preserve layout markup while suppressing global IDs and interactive semantics. */
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
</script>

{#if fragment.type === 'heading'}
	<svelte:element
		this={`h${fragment.level}`}
		id={profileMode ? undefined : fragment.anchor}
		class="contract-block contract-heading"
		data-block-key={fragment.blockKey}
		data-source-fragment-key={fragmentKey(fragment)}
		tabindex={interactive && !profileMode ? -1 : undefined}
	>
		<InlineContent
			{profileMode}
			{interactive}
			{navigationCapable}
			tokens={fragment.tokens}
			{selectedAnnotationId}
			canOpenPlaybookItems={canOpenPlaybookItems && interactive && !profileMode}
			{onAnnotationSelect}
		/>
	</svelte:element>
{:else if fragment.type === 'paragraph'}
	<p
		class="contract-block contract-paragraph"
		class:is-continuation={fragment.isContinuation}
		class:is-final={fragment.isFinal}
		class:is-empty-insertion-slot={fragment.emptyInsertionSlot}
		data-block-key={fragment.blockKey}
		data-source-fragment-key={fragmentKey(fragment)}
	>
		<InlineContent
			{profileMode}
			{interactive}
			{navigationCapable}
			tokens={fragment.tokens}
			{selectedAnnotationId}
			canOpenPlaybookItems={canOpenPlaybookItems && interactive && !profileMode}
			{onAnnotationSelect}
		/>
	</p>
{:else}
	<table
		class="contract-block contract-table"
		class:signature-table={fragment.variant === 'signature'}
		data-block-key={fragment.blockKey}
		data-source-fragment-key={fragmentKey(fragment)}
		style:table-layout={fragment.columnWidths ? 'fixed' : undefined}
	>
		{#if fragment.columnWidths}
			<colgroup>
				{#each fragment.columnWidths as width}<col style:width={`${width}px`} />{/each}
			</colgroup>
		{/if}
		<thead>
			{#each fragment.rows.slice(0, fragment.headerRowCount) as row, rowIndex}
				<tr
					>{#each row as cell, cellIndex}
						<th scope="col" data-source-row={rowIndex} data-source-cell={cellIndex}>
							<InlineContent
								{profileMode}
								{interactive}
								{navigationCapable}
								tokens={cell.tokens}
								{selectedAnnotationId}
								canOpenPlaybookItems={canOpenPlaybookItems && interactive && !profileMode}
								{onAnnotationSelect}
							/>
						</th>{/each}</tr
				>
			{/each}
		</thead>
		<tbody>
			{#each fragment.rows.slice(fragment.headerRowCount) as row, rowIndex}
				<tr
					>{#each row as cell, cellIndex}
						<td
							data-source-row={(fragment.interval?.start ?? 0) + rowIndex + fragment.headerRowCount}
							data-source-cell={cellIndex}
						>
							<InlineContent
								{profileMode}
								{interactive}
								{navigationCapable}
								tokens={cell.tokens}
								{selectedAnnotationId}
								canOpenPlaybookItems={canOpenPlaybookItems && interactive && !profileMode}
								{onAnnotationSelect}
							/>
						</td>{/each}</tr
				>
			{/each}
		</tbody>
	</table>
{/if}
