import type { AnnotationRegistry } from './annotation-registry';
import type { SourcePoint, SourceRange } from '$lib/contract/source-model';
import { pointPosition, type SourceIndex } from '$lib/contract/source-index';
import type { ResolvedRun } from '$lib/contract/model';

export interface AnnotationActivation {
	owner: HTMLElement;
	clientX?: number;
	clientY?: number;
}

export interface AnnotationOccurrence {
	annotationId: string;
	point: SourcePoint;
	visualSource?: SourceRange;
	generatedOffset?: number;
	generated?: ResolvedRun['generated'];
	pageNumber: number;
}

function tokenCoordinates(token: HTMLElement) {
	const visualSource: SourceRange | undefined = token.dataset.visualSource
		? JSON.parse(token.dataset.visualSource)
		: undefined;
	const point =
		visualSource?.start ??
		(token.dataset.sourceStartKey
			? {
					sourceKey: token.dataset.sourceStartKey,
					offset: Number(token.dataset.sourceStartOffset)
				}
			: undefined);
	return point
		? {
				point,
				visualSource,
				generated: token.dataset.generated as ResolvedRun['generated'],
				generatedOffset: visualSource ? Number(token.dataset.generatedOffset ?? 0) : undefined
			}
		: undefined;
}

function pageNumber(element: HTMLElement) {
	return Number(element.closest<HTMLElement>('[data-page-number]')?.dataset.pageNumber ?? 0);
}

/** Capture text coordinates, never the segment's ordinal or page-local row index. */
export function annotationOccurrence(
	annotationId: string,
	activation: AnnotationActivation
): AnnotationOccurrence | null {
	const { owner, clientX, clientY } = activation;
	const distance = (token: HTMLElement) => {
		if (clientX === undefined || clientY === undefined) return 0;
		const range = owner.ownerDocument.createRange();
		range.selectNodeContents(token);
		let nearest = Infinity;
		for (const bounds of range.getClientRects())
			nearest = Math.min(
				nearest,
				Math.hypot(
					Math.max(bounds.left - clientX, 0, clientX - bounds.right),
					Math.max(bounds.top - clientY, 0, clientY - bounds.bottom)
				)
			);
		return nearest;
	};
	let token: HTMLElement | undefined;
	let nearest = Infinity;
	for (const candidate of owner.querySelectorAll<HTMLElement>(
		'[data-source-start-key], [data-visual-source]'
	)) {
		const measured = distance(candidate);
		if (!token || measured < nearest) {
			token = candidate;
			nearest = measured;
		}
	}
	if (!token) return null;
	const coordinates = tokenCoordinates(token);
	if (!coordinates) return null;
	// Preserve the character within a long run as well as its token after repagination.
	const caretDocument = owner.ownerDocument as Document & {
		caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
	};
	let offset = 0;
	if (clientX !== undefined && clientY !== undefined) {
		const position = caretDocument.caretPositionFromPoint?.(clientX, clientY);
		const range = position ? null : caretDocument.caretRangeFromPoint?.(clientX, clientY);
		const node = position?.offsetNode ?? range?.startContainer;
		if (node?.nodeType === Node.TEXT_NODE && token.contains(node))
			offset = Math.min(
				position?.offset ?? range?.startOffset ?? 0,
				Math.max(0, (token.textContent?.length ?? 0) - 1)
			);
	}
	if (coordinates.visualSource) coordinates.generatedOffset! += offset;
	else if (token.dataset.sourceKind === 'text') coordinates.point.offset += offset;
	return { annotationId, ...coordinates, pageNumber: pageNumber(owner) };
}

export interface AnnotationAnchor {
	owner: HTMLElement;
	token: HTMLElement;
	characterOffset: number;
}

/** A character range keeps a wrapped token anchored to the selected line. */
export function annotationAnchorBounds(anchor: AnnotationAnchor): DOMRect {
	const { token, characterOffset } = anchor;
	const text = token.firstChild;
	if (text?.nodeType === Node.TEXT_NODE && text.textContent?.length) {
		const offset = Math.max(0, Math.min(characterOffset, text.textContent.length - 1));
		const range = token.ownerDocument.createRange();
		range.setStart(text, offset);
		range.setEnd(text, offset + 1);
		const bounds = range.getClientRects()[0];
		if (bounds?.height) return bounds;
	}
	return token.getBoundingClientRect();
}

function ranksBefore(rank: number[], previous: number[]): boolean {
	for (let i = 0; i < rank.length; i++) if (rank[i] !== previous[i]) return rank[i] < previous[i];
	return false;
}

/** Positioning and focus share membership-aware occurrence resolution. */
export function resolveAnnotationAnchor(
	registry: AnnotationRegistry,
	index: SourceIndex,
	annotationId: string | null,
	preference: AnnotationOccurrence | null,
	fallbackPoint?: SourcePoint
): AnnotationAnchor | undefined {
	if (!annotationId) return;
	const point = preference?.point ?? fallbackPoint;
	// A captured point may outlive its source unit or the unit's previous length.
	const unit = point ? index.byKey.get(point.sourceKey) : undefined;
	const position = unit && point ? unit.position + Math.min(point.offset, unit.length) : undefined;
	let best: (AnnotationAnchor & { rank: number[] }) | undefined;
	for (const owner of registry.forAnnotation(annotationId)) {
		for (const token of owner.querySelectorAll<HTMLElement>(
			'[data-source-start-key], [data-visual-source]'
		)) {
			const coordinates = tokenCoordinates(token);
			if (!coordinates) continue;
			const source = coordinates.visualSource ?? {
				start: coordinates.point,
				end: {
					sourceKey: token.dataset.sourceEndKey!,
					offset: Number(token.dataset.sourceEndOffset)
				}
			};
			const start = pointPosition(index, source.start),
				end = pointPosition(index, source.end);
			const sourceDistance =
				position === undefined ? 0 : Math.max(start - position, 0, position - end);
			const sameReplacement =
				preference?.visualSource &&
				coordinates.visualSource &&
				preference.generated === coordinates.generated &&
				JSON.stringify(preference.visualSource) === JSON.stringify(coordinates.visualSource);
			const offset = coordinates.generatedOffset ?? 0;
			const generatedDistance = sameReplacement
				? Math.max(
						offset - (preference.generatedOffset ?? 0),
						0,
						(preference.generatedOffset ?? 0) - offset - (token.textContent?.length ?? 0)
					)
				: 0;
			const containsSource =
				position !== undefined && position >= start && (position < end || start === end);
			const containsGenerated =
				(preference?.generatedOffset ?? 0) >= offset &&
				(preference?.generatedOffset ?? 0) < offset + (token.textContent?.length ?? 0);
			const exact = preference?.visualSource
				? Boolean(sameReplacement) && containsGenerated
				: !coordinates.visualSource && containsSource;
			const matchingProvenance = preference?.visualSource
				? Boolean(sameReplacement)
				: !coordinates.visualSource;
			const rank = [
				matchingProvenance ? 0 : 1,
				exact ? 0 : 1,
				sourceDistance,
				sameReplacement ? generatedDistance : 0,
				preference ? Math.abs(pageNumber(owner) - preference.pageNumber) : 0
			];
			if (!best || ranksBefore(rank, best.rank)) {
				const characterOffset = sameReplacement
					? (preference?.generatedOffset ?? 0) - offset
					: !coordinates.visualSource &&
						  token.dataset.sourceKind === 'text' &&
						  point?.sourceKey === source.start.sourceKey
						? point.offset - source.start.offset
						: 0;
				best = { owner, token, characterOffset, rank };
			}
		}
	}
	return best;
}
