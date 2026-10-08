import { PlaybookValidationError } from '../playbook/validation-error';
import type { BaselineBlock, ReplacementAtom } from './source-model';
import { buildSourceIndex } from './source-index';

type Reference = Extract<ReplacementAtom, { kind: 'reference' }>;

function key(value: string, label: string): void {
	if (!value?.trim() || value !== value.trim())
		throw new PlaybookValidationError(`Invalid ${label}: ${value}`);
}
function unique(seen: Set<string>, value: string, label: string): void {
	key(value, label);
	if (seen.has(value)) throw new PlaybookValidationError(`Duplicate ${label}: ${value}`);
	seen.add(value);
}

/** Immutable source validation, independent of the Playbook and authoring workflow. */
export function validateBaseline(blocks: readonly BaselineBlock[]) {
	if (!blocks.length) throw new PlaybookValidationError('Contract has no blocks');
	const anchors = new Set<string>();
	const items = new Map<string, { block: BaselineBlock; position: number }>();
	const sequences = new Map<string, { parent?: string; style: string }>();
	const references: Extract<ReplacementAtom, { kind: 'reference' }>[] = [];
	for (const [position, block] of blocks.entries()) {
		const item = block.numbering;
		if (item) {
			key(item.itemKey, 'numbering item');
			key(item.sequenceKey, 'numbering sequence');
			if (items.has(item.itemKey) || block.kind === 'table')
				throw new PlaybookValidationError(`Invalid numbering item: ${item.itemKey}`);
			if (item.parentItemKey !== undefined) {
				key(item.parentItemKey, 'numbering parent');
				const parent = items.get(item.parentItemKey)?.block;
				if (!parent || (parent.kind === 'paragraph' && parent.optional))
					throw new PlaybookValidationError(
						`Missing, late or optional numbering parent: ${item.itemKey}`
					);
			}
			const sequence = sequences.get(item.sequenceKey);
			if (sequence && (sequence.parent !== item.parentItemKey || sequence.style !== item.style))
				throw new PlaybookValidationError(`Mixed numbering sequence: ${item.sequenceKey}`);
			sequences.set(item.sequenceKey, { parent: item.parentItemKey, style: item.style });
			items.set(item.itemKey, { block, position });
		}
		if (block.kind === 'heading') unique(anchors, block.anchor, 'heading anchor');
		if (
			block.kind === 'paragraph' &&
			block.optional &&
			(!item ||
				block.content.length !== 1 ||
				block.content[0].kind !== 'text' ||
				block.content[0].text !== '')
		)
			throw new PlaybookValidationError(`Invalid optional block: ${block.blockKey}`);
		if (block.kind === 'table') {
			if (
				!block.rows.length ||
				!block.rows[0].length ||
				block.rows.some((row) => row.length !== block.rows[0].length) ||
				!Number.isSafeInteger(block.headerRowCount) ||
				block.headerRowCount < 0 ||
				block.headerRowCount > block.rows.length
			)
				throw new PlaybookValidationError(`Invalid table: ${block.blockKey}`);
		}
		const content =
			block.kind === 'table' ? block.rows.flat().flatMap((c) => c.content) : block.content;
		references.push(...content.filter((a) => a.kind === 'reference'));
	}
	const index = buildSourceIndex(blocks);
	function validateReference(ref: Reference): void {
		key(ref.targetItemKey, 'reference target');
		if (ref.endTargetItemKey !== undefined) key(ref.endTargetItemKey, 'reference end target');
		const start = items.get(ref.targetItemKey),
			end = ref.endTargetItemKey !== undefined ? items.get(ref.endTargetItemKey) : undefined;
		const optional = (entry: typeof start) =>
			entry?.block.kind === 'paragraph' && entry.block.optional;
		if (
			!start ||
			optional(start) ||
			(ref.endTargetItemKey !== undefined && (!end || optional(end)))
		)
			throw new PlaybookValidationError(`Unresolved reference: ${ref.targetItemKey}`);
		if (
			end &&
			(end.position <= start.position ||
				end.block.numbering!.sequenceKey !== start.block.numbering!.sequenceKey ||
				end.block.numbering!.parentItemKey !== start.block.numbering!.parentItemKey)
		)
			throw new PlaybookValidationError(`Invalid reference range: ${ref.targetItemKey}`);
	}
	for (const ref of references) validateReference(ref);
	return { index, validateReference };
}
