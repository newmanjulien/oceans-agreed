import { env } from '$env/dynamic/public';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';
import type { InvitationPreview } from '../../../convex/invitationValidators';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals, setHeaders }) => {
	setHeaders({ 'Referrer-Policy': 'no-referrer' });
	const token = url.searchParams.get('invitation');
	if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
		return {
			token,
			preview: { status: 'unavailable' } satisfies InvitationPreview,
			previewSkipped: false,
			error: ''
		};
	const error = 'Unable to load this invitation. Please try again.';
	const auth = locals.auth?.();
	if (auth && 'sessionId' in auth && auth.sessionId)
		return { token, preview: null, previewSkipped: true, error };
	try {
		if (!env.PUBLIC_CONVEX_URL) throw new Error('Invitation lookup is unavailable.');
		const signal = AbortSignal.timeout(15_000);
		const client = new ConvexHttpClient(env.PUBLIC_CONVEX_URL, {
			logger: false,
			fetch: (input, init) => fetch(input, { ...init, signal, cache: 'no-store' })
		});
		const preview = await client.action(api.invitationLinks.preview, { token });
		return { token, preview, previewSkipped: false, error: '' };
	} catch {
		return { token, preview: null, previewSkipped: false, error };
	}
};
