import { ConvexHttpClient } from 'convex/browser';
import { env } from '$env/dynamic/public';
import { api } from '../../convex/_generated/api';
import type { ContractRouteData } from '$lib/contract/saved';
import type { Id } from '../../convex/_generated/dataModel';

export async function loadContractSnapshot(
	id: string,
	membershipId: Id<'memberships'>,
	token: string,
	signal?: AbortSignal
): Promise<ContractRouteData> {
	try {
		if (!env.PUBLIC_CONVEX_URL) throw new Error('Missing Convex configuration');
		const client = new ConvexHttpClient(env.PUBLIC_CONVEX_URL, {
			fetch: (input, init) =>
				fetch(input, {
					...init,
					cache: 'no-store',
					signal: signal
						? AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])])
						: init?.signal
				})
		});
		client.setAuth(token);
		const result = await client.query(api.savedContracts.load, {
			id,
			membershipId
		});
		return result ? { id, status: 'ready', ...result } : { id, status: 'missing' };
	} catch {
		return { id, status: 'error' };
	}
}
