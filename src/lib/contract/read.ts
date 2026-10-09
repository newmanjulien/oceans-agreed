import type { ContractRouteData } from './saved';
import type { Id } from '../../convex/_generated/dataModel';

export async function readContract(
	request: typeof fetch,
	id: string,
	membershipId: Id<'memberships'>,
	signal?: AbortSignal
): Promise<ContractRouteData> {
	const response = await request(
		`/api/contracts/${encodeURIComponent(id)}?membershipId=${encodeURIComponent(membershipId)}`,
		{
			cache: 'no-store',
			signal
		}
	);
	if (!response.ok && response.status !== 404) throw new Error('Contract read failed.');
	return response.json();
}
