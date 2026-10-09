import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { loginHref } from '$lib/auth/navigation';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store' });
	const auth = locals.auth?.();
	if (env.PUBLIC_CLERK_PUBLISHABLE_KEY && (!auth || !('userId' in auth) || !auth.userId))
		redirect(303, loginHref(url.pathname + url.search));
	return {};
};
