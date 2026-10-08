import { PlaybookValidationError } from './validation-error';
import type { ContractChange, SourcePoint, SourceRange, Trigger } from './model';
import type { SourceIndex, SourceContainer } from '../contract/source-index';
import { resolvePoint } from '../contract/source-index';
import {
	containsPoint,
	containsRange,
	isEmptyRange,
	localContainer,
	rangesOverlap,
	validateRange
} from '../contract/ranges';

export class GeometryError extends PlaybookValidationError {
	constructor(
		readonly kind: 'trigger-boundary' | 'ambiguous-owner' | 'invalid-slot',
		message: string
	) {
		super(message);
		this.name = 'GeometryError';
	}
}

/** The same empty-slot definition drives discovery and validation. */
export function emptyTriggerPoint(
	index: SourceIndex,
	container: SourceContainer
): SourcePoint | undefined {
	const block = index.blocks.get(container.blockKey)!;
	const stored = container.units.filter((unit) => unit.kind !== 'number');
	if (
		(container.inTable || (block.kind === 'paragraph' && block.optional)) &&
		stored.length === 1 &&
		stored[0].kind === 'text' &&
		stored[0].length === 0
	)
		return { sourceKey: stored[0].sourceKey, offset: 0 };
}

/** Point discovery belongs to intentional empty source slots, not arbitrary carets. */
export function validateTriggerRange(index: SourceIndex, range: SourceRange): void {
	validateRange(index, range);
	if (!isEmptyRange(index, range)) return;
	const point = emptyTriggerPoint(index, index.containers.get(localContainer(index, range))!);
	if (
		!point ||
		range.start.sourceKey !== point.sourceKey ||
		range.end.sourceKey !== point.sourceKey
	)
		throw new GeometryError(
			'invalid-slot',
			'Point Triggers require an intentional empty source slot'
		);
}

export function triggersIntersect(index: SourceIndex, a: SourceRange, b: SourceRange): boolean {
	return (
		rangesOverlap(index, a, b) ||
		(isEmptyRange(index, a) && containsPoint(index, b, a.start, true)) ||
		(isEmptyRange(index, b) && containsPoint(index, a, b.start, true))
	);
}

/** Throws for partial boundary crossings or ambiguous insertion ownership. */
export function changeTriggerOwner(
	index: SourceIndex,
	triggers: readonly Trigger[],
	change: ContractChange
): Trigger | undefined {
	localContainer(index, change.range);
	const insertion = isEmptyRange(index, change.range);
	const owners = triggers.filter((trigger) => {
		if (insertion) return containsPoint(index, trigger.range, change.range.start, true);
		if (!rangesOverlap(index, trigger.range, change.range)) return false;
		if (!containsRange(index, trigger.range, change.range))
			throw new GeometryError('trigger-boundary', `Change crosses Trigger boundary: ${trigger.id}`);
		return true;
	});
	if (owners.length > 1)
		throw new GeometryError('ambiguous-owner', 'Change has ambiguous Trigger ownership');
	return owners[0];
}

/** Optional paragraph activation is a consequence of a normal nonempty insertion. */
export function activatedBlock(index: SourceIndex, change: ContractChange): string | undefined {
	localContainer(index, change.range);
	const unit = resolvePoint(index, change.range.start);
	const block = index.blocks.get(unit.blockKey)!;
	if (block.kind !== 'paragraph' || !block.optional) return;
	if (
		!isEmptyRange(index, change.range) ||
		unit.kind !== 'text' ||
		unit.length !== 0 ||
		change.range.end.sourceKey !== unit.sourceKey
	)
		throw new GeometryError(
			'invalid-slot',
			'Optional paragraphs only accept insertions at their empty source slot'
		);
	return change.replacement.some((atom) => atom.kind === 'reference' || atom.text.length > 0)
		? block.blockKey
		: undefined;
}

/** Wording only affects geometry through empty-slot activation; IDs belong to Triggers. */
export function playbookGeometryKey(item: {
	triggers: readonly Trigger[];
	concessions: readonly { changes: readonly ContractChange[] }[];
}): string {
	return JSON.stringify([
		item.triggers,
		item.concessions.map((concession) =>
			concession.changes.map((change) => ({
				range: change.range,
				hasContent: change.replacement.some(
					(atom) => atom.kind === 'reference' || atom.text.length > 0
				)
			}))
		)
	]);
}
