import type { SourceRange } from './source-model';
import type { ContractState } from './saved';
import type { Id } from '../../convex/_generated/dataModel';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type ReviewDecision = Exclude<ReviewStatus, 'pending'>;
export type ReviewTag = {
	itemId: string;
	concessionId: string;
	concessionPosition: number;
	lifecycle: string;
	status: ReviewStatus;
	description: string;
	/** The main edit anchors the single tag; approval covers every concession change. */
	range: SourceRange;
	admin: boolean;
	disabled: boolean;
};
export type ReviewNavigation = { afterItemId?: string };
export const legacyLifecycle = (itemId: string, concessionId: string) =>
	JSON.stringify(['legacy', itemId, concessionId]);

/** Approval metadata never contributes to document or Word content identity. */
export function selectionLifecycles(state: ContractState, required: ReadonlySet<string>) {
	if (!required.size) return {};
	return Object.fromEntries(
		Object.entries(state.selectedConcessions)
			.filter(([id]) => required.has(id))
			.map(([id, concessionId]) => [
				id,
				state.reviews?.[id as Id<'playbookItems'>]?.concessionId === concessionId
					? state.reviews[id as Id<'playbookItems'>].lifecycle
					: legacyLifecycle(id, concessionId)
			])
	);
}
export function reviewStatus(
	state: Pick<ContractState, 'reviews'>,
	itemId: string,
	concessionId: string,
	lifecycle: string
): ReviewStatus {
	const review = state.reviews?.[itemId as Id<'playbookItems'>];
	return review?.concessionId === concessionId && review.lifecycle === lifecycle
		? review.status
		: 'pending';
}
/** Only the current pending lifecycles determine whether an email already covers this review. */
export function approvalCoversPending(
	pending: readonly {
		itemId: string;
		concessionId: string;
		concessionPosition: number;
		lifecycle: string;
	}[],
	requested: readonly {
		itemId: string;
		concessionPosition: number;
		lifecycle?: string;
		reviewStatus?: ReviewStatus;
	}[]
) {
	if (!pending.length) return false;
	const byItem = new Map(requested.map((s) => [s.itemId, s]));
	return pending.every((current) => {
		const old = byItem.get(current.itemId);
		return (
			old &&
			old.concessionPosition === current.concessionPosition &&
			(old.lifecycle ?? legacyLifecycle(current.itemId, current.concessionId)) ===
				current.lifecycle &&
			(old.reviewStatus ?? 'pending') === 'pending'
		);
	});
}
