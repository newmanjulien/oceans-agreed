import { getContext, setContext, type Snippet } from 'svelte';

const key = Symbol('entryPresentation');
export class EntryPresentation {
	footer = $state<Snippet>();
	showFooter = $state(true);
}
export const setEntryPresentation = () => setContext(key, new EntryPresentation());
export const useEntryPresentation = () => getContext<EntryPresentation>(key);
