import { PlaybookValidationError } from '../playbook/validation-error';
import type { SourcePoint, SourceRange } from './source-model';
import { pointPosition, resolvePoint, type SourceIndex, type SourceUnit } from './source-index';

export const comparePoints = (index: SourceIndex, a: SourcePoint, b: SourcePoint): number =>
	Math.sign(pointPosition(index, a) - pointPosition(index, b));
export function validateRange(index: SourceIndex, range: SourceRange): void {
	if (comparePoints(index, range.start, range.end) > 0)
		throw new PlaybookValidationError('Source range is reversed');
}
export function isEmptyRange(index: SourceIndex, range: SourceRange): boolean {
	validateRange(index, range);
	return comparePoints(index, range.start, range.end) === 0;
}
/** Half-open geometry. Empty ranges do not overlap; edit collisions are a separate policy. */
export function rangesOverlap(index: SourceIndex, a: SourceRange, b: SourceRange): boolean {
	const aIsEmpty = isEmptyRange(index, a);
	const bIsEmpty = isEmptyRange(index, b);
	return (
		!aIsEmpty &&
		!bIsEmpty &&
		comparePoints(index, a.start, b.end) < 0 &&
		comparePoints(index, b.start, a.end) < 0
	);
}
export function containsPoint(
	index: SourceIndex,
	range: SourceRange,
	point: SourcePoint,
	includeEnd = false
): boolean {
	validateRange(index, range);
	return (
		comparePoints(index, range.start, point) <= 0 &&
		(includeEnd
			? comparePoints(index, point, range.end) <= 0
			: comparePoints(index, point, range.end) < 0)
	);
}
export function containsRange(index: SourceIndex, outer: SourceRange, inner: SourceRange): boolean {
	validateRange(index, outer);
	validateRange(index, inner);
	return (
		comparePoints(index, outer.start, inner.start) <= 0 &&
		comparePoints(index, inner.end, outer.end) <= 0
	);
}
export function localContainer(index: SourceIndex, range: SourceRange): string {
	validateRange(index, range);
	const start = resolvePoint(index, range.start),
		end = resolvePoint(index, range.end);
	if (start.containerKey !== end.containerKey)
		throw new PlaybookValidationError('Edit must target one source container');
	return start.containerKey;
}
export function unitsInRange(index: SourceIndex, range: SourceRange): readonly SourceUnit[] {
	validateRange(index, range);
	const start = pointPosition(index, range.start),
		end = pointPosition(index, range.end);
	if (start === end) return [resolvePoint(index, range.start)];
	// Source units and their ends are ordered, including persisted empty anchors.
	const units = index.units;
	let low = 0,
		high = units.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (units[mid].position + units[mid].length <= start) low = mid + 1;
		else high = mid;
	}
	let last = low;
	while (last < units.length && units[last].position < end) last++;
	return units.slice(low, last);
}
export function rangeTouchesTable(index: SourceIndex, range: SourceRange): boolean {
	validateRange(index, range);
	const start = pointPosition(index, range.start),
		end = pointPosition(index, range.end);
	return (
		resolvePoint(index, range.start).inTable ||
		resolvePoint(index, range.end).inTable ||
		index.units.some((u) => u.inTable && u.position < end && u.position + u.length >= start)
	);
}
/** Baseline display text: atom offsets stay 0/1 even when the displayed reference is longer. */
export function rangeText(index: SourceIndex, range: SourceRange): string {
	if (isEmptyRange(index, range)) return '';
	const start = pointPosition(index, range.start),
		end = pointPosition(index, range.end);
	let text = '',
		previous: SourceUnit | undefined;
	for (const unit of unitsInRange(index, range)) {
		if (previous)
			text +=
				previous.containerKey !== unit.containerKey
					? '\n'
					: previous.kind === 'number' && previous.displayText
						? ' '
						: '';
		text +=
			unit.kind === 'text'
				? unit.displayText.slice(
						Math.max(0, start - unit.position),
						Math.min(unit.length, end - unit.position)
					)
				: unit.displayText;
		previous = unit;
	}
	return text;
}
