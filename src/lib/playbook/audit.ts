import { PlaybookValidationError } from './validation-error';
import type { BaselineBlock } from '../contract/source-model';
import { CompiledContract } from '../contract/compiled-contract';
import { PlaybookGeometryIndex } from './geometry-index';
import type { PlaybookItem } from './model';
import { MAX_CONTRACT_BLOCKS, MAX_PLAYBOOK_ITEMS } from './validation';

/** Call after shape validation, on the complete proposed live set, for create and update. */
export function validatePlaybook(blocks: readonly BaselineBlock[], items: readonly PlaybookItem[]) {
	if (blocks.length > MAX_CONTRACT_BLOCKS || items.length > MAX_PLAYBOOK_ITEMS)
		throw new PlaybookValidationError('Contract exceeds the supported source or Playbook size');
	const compiled = new CompiledContract(blocks);
	const geometry = new PlaybookGeometryIndex(compiled);
	items.forEach((item, i) => geometry.set(String(i), item));
	geometry.audit();
	return compiled;
}
