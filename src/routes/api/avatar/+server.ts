import { env } from '$env/dynamic/public';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ locals, request, url }) => {
	const token = await locals.auth?.().getToken({ template: 'convex' });
	if (!token) return new Response('Sign in required.', { status: 401 });
	if (!env.PUBLIC_CONVEX_URL)
		return new Response('Missing backend configuration.', { status: 503 });
	const contentType = request.headers.get('content-type') ?? '';
	const bytes = await request.arrayBuffer();
	if (bytes.byteLength > 2 * 1024 * 1024)
		return new Response('Avatar image must be 2 MB or smaller.', { status: 400 });
	const endpoint = new URL(
		'/avatar',
		env.PUBLIC_CONVEX_URL.replace('.convex.cloud', '.convex.site')
	);
	if (url.searchParams.has('membershipId'))
		endpoint.searchParams.set('membershipId', url.searchParams.get('membershipId')!);
	endpoint.searchParams.set('company', String(url.searchParams.get('company') === 'true'));
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
			body: bytes
		});
		const headers = new Headers({ 'cache-control': 'no-store' });
		const responseContentType = response.headers.get('content-type');
		if (responseContentType) headers.set('content-type', responseContentType);
		return new Response(response.body, { status: response.status, headers });
	} catch (error) {
		console.error('Unable to contact Convex for avatar upload.', error);
		return new Response('Unable to save your avatar. Try again.', {
			status: 502,
			headers: { 'cache-control': 'no-store' }
		});
	}
};
