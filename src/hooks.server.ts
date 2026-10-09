import { env as privateEnv } from '$env/dynamic/private';
import { env } from '$env/dynamic/public';
import { withClerkHandler } from 'svelte-clerk/server';
import { redirect, type Handle } from '@sveltejs/kit';

const callbackParameters = [
	'__clerk_handshake',
	'__clerk_handshake_nonce',
	'__clerk_help',
	'__clerk_db_jwt',
	'__dev_session',
	'__clerk_synced',
	'__clerk_hs_reason',
	'__clerk_redirect_url',
	'__session'
];
export const handle: Handle = async ({ event, resolve }) => {
	if (!env.PUBLIC_CLERK_PUBLISHABLE_KEY || !privateEnv.CLERK_SECRET_KEY) return resolve(event);
	const callback = callbackParameters.some((name) => event.url.searchParams.has(name));
	if (!callback && ['/login', '/join'].includes(event.url.pathname)) {
		return resolve(event);
	}
	// Cookie presence selects a route only. Protected loads still verify identity.
	const hasAuthArtifacts =
		event.request.headers.has('authorization') ||
		event.cookies
			.getAll()
			.some(({ name }) => /^(?:__session|__refresh|__client_uat|__clerk_)/.test(name));
	if (
		!callback &&
		!hasAuthArtifacts &&
		event.url.pathname === '/' &&
		event.request.method === 'GET' &&
		event.request.headers.get('sec-fetch-dest') === 'document'
	)
		redirect(303, '/login');
	return withClerkHandler({
		publishableKey: env.PUBLIC_CLERK_PUBLISHABLE_KEY,
		secretKey: privateEnv.CLERK_SECRET_KEY,
		signInUrl: '/login',
		signUpUrl: '/join',
		authorizedParties: [event.url.origin]
	})({ event, resolve });
};
