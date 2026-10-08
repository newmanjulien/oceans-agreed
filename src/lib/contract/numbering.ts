import { PlaybookValidationError } from '../playbook/validation-error';
import type { ContractBlock, InlineAtom } from './model';

export type Address = { address: string; label: string };

function numberLabel(
	style: NonNullable<ContractBlock['numbering']>['style'],
	position: number
): string {
	if (position < 1) throw new PlaybookValidationError('Numbering positions start at one.');
	if (style === 'decimal') return `${position}.`;
	if (style === 'lower-roman') {
		let remaining = position;
		let result = '';
		for (const [value, symbol] of [
			[1000, 'm'],
			[900, 'cm'],
			[500, 'd'],
			[400, 'cd'],
			[100, 'c'],
			[90, 'xc'],
			[50, 'l'],
			[40, 'xl'],
			[10, 'x'],
			[9, 'ix'],
			[5, 'v'],
			[4, 'iv'],
			[1, 'i']
		] as const) {
			while (remaining >= value) {
				result += symbol;
				remaining -= value;
			}
		}
		return `(${result})`;
	}
	let result = '';
	for (let value = position; value > 0; value = Math.floor((value - 1) / 26)) {
		result = String.fromCharCode((style === 'upper-alpha' ? 65 : 97) + ((value - 1) % 26)) + result;
	}
	return `(${result})`;
}

function itemAddress(parent: string, label: string): string {
	return `${parent}${label.endsWith('.') ? label.slice(0, -1) : label}`;
}

function referenceAddress(start: string, end?: string): string {
	if (!end) return start;
	const lastOpen = end.lastIndexOf('(');
	if (lastOpen >= 0 && start.slice(0, lastOpen) === end.slice(0, lastOpen))
		return `${start}-${end.slice(lastOpen)}`;
	return `${start}-${end}`;
}

/** Sequences are counted in document order. A child address uses its parent's active address. */
export function numberAddresses(
	blocks: readonly Pick<ContractBlock, 'numbering'>[]
): Map<string, Address> {
	const iterator = iterateNumberAddresses(blocks);
	let next = iterator.next();
	while (!next.done) next = iterator.next();
	return next.value;
}

export function* iterateNumberAddresses(
	blocks: readonly Pick<ContractBlock, 'numbering'>[]
): Generator<undefined, Map<string, Address>> {
	const result = new Map<string, Address>();
	const positions = new Map<string, number>();
	for (const block of blocks) {
		const item = block.numbering;
		yield undefined;
		if (!item) continue;
		const parent = item.parentItemKey ? result.get(item.parentItemKey)?.address : '';
		if (item.parentItemKey && !parent)
			throw new PlaybookValidationError(`Missing parent address: ${item.itemKey}`);
		const position = (positions.get(item.sequenceKey) ?? 0) + 1;
		const label = numberLabel(item.style, position);
		positions.set(item.sequenceKey, position);
		result.set(item.itemKey, { label, address: itemAddress(parent ?? '', label) });
	}
	return result;
}

export function referenceText(
	atom: Extract<InlineAtom, { kind: 'reference' }>,
	addresses: ReadonlyMap<string, Address>
): string {
	const start = addresses.get(atom.targetItemKey)?.address;
	const end = atom.endTargetItemKey ? addresses.get(atom.endTargetItemKey)?.address : undefined;
	if (!start || (atom.endTargetItemKey && !end))
		throw new PlaybookValidationError(`Unresolved reference: ${atom.targetItemKey}`);
	return referenceAddress(start, end);
}
