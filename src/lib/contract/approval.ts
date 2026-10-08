import type { ConcessionSelection, PlaybookItemRecord } from '../playbook/model';

/** A valid selected concession needs approval when its frozen instruction is nonblank. */
export function requiresApproval(
	items: readonly PlaybookItemRecord[],
	selection: ConcessionSelection
) {
	return items.some(
		(item) =>
			Boolean(item.instructions?.changesNeedApproval?.trim()) &&
			item.concessions.some((c) => c.id === selection[item._id])
	);
}

/** Compare compact request references with the choices in the frozen snapshot. */
export function matchesApprovalSelection(
	items: readonly PlaybookItemRecord[],
	selection: ConcessionSelection,
	requested: readonly { itemId: string; concessionPosition: number }[]
) {
	if (Object.keys(selection).length !== requested.length) return false;
	const byId = new Map<string, PlaybookItemRecord>(items.map((item) => [item._id, item]));
	return requested.every(({ itemId, concessionPosition }) => {
		const concession = byId.get(itemId)?.concessions[concessionPosition];
		return concession !== undefined && selection[itemId] === concession.id;
	});
}
