import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url, setHeaders }) => {
	const auth = locals.auth?.();
	if (env.PUBLIC_CLERK_PUBLISHABLE_KEY && (!auth || !('userId' in auth) || !auth.userId))
		redirect(303, '/login?returnTo=' + encodeURIComponent(url.pathname + url.search));
	setHeaders({ 'cache-control': 'private, no-store' });
	return {};
};
