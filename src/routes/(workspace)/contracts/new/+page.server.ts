import type { ContractRouteData } from '$lib/contract/saved';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	contractRoute: { id: null, status: 'new' } satisfies ContractRouteData
});
