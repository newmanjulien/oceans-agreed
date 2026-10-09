import { json } from '@sveltejs/kit';
import { loadContractSnapshot } from '$lib/server/contract';
import { ReadAttempt, waitForRead } from '$lib/auth/attempt';
import type { RequestHandler } from './$types';
import type { Id } from '../../../../convex/_generated/dataModel';

export const GET: RequestHandler = async ({ params, locals, request, url }) => {
	const attempt = new ReadAttempt(12_000);
	const signal = AbortSignal.any([request.signal, attempt.signal]);
	const headers = { 'cache-control': 'private, no-store' };
	try {
		const membershipId = url.searchParams.get('membershipId');
		if (!membershipId)
			return json({ error: 'Company access is required.' }, { status: 400, headers });
		let token: string | null | undefined;
		try {
			token = await waitForRead(
				Promise.resolve().then(() => locals.auth?.().getToken({ template: 'convex' })),
				signal
			);
		} catch {
			return json({ error: 'Sign in required.' }, { status: signal.aborted ? 502 : 401, headers });
		}
		if (!token) return json({ error: 'Sign in required.' }, { status: 401, headers });
		const result = await waitForRead(
			loadContractSnapshot(params.id, membershipId as Id<'memberships'>, token, signal),
			signal
		);
		return json(result, {
			status: result.status === 'missing' ? 404 : result.status === 'error' ? 502 : 200,
			headers
		});
	} catch {
		return json({ id: params.id, status: 'error' }, { status: 502, headers });
	} finally {
		attempt.complete();
	}
};
