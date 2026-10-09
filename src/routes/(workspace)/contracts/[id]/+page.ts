import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	return { contractRoute: { id: params.id, status: 'loading' as const } };
};
