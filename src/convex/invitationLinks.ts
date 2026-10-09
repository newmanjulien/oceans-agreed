import { v } from 'convex/values';
import { action } from './_generated/server';
import { internal } from './_generated/api';
import {
	invitationPreview,
	invitationResolution,
	type InvitationPreview,
	type InvitationResolution
} from './invitationValidators';

async function tokenHash(token: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const preview = action({
	args: { token: v.string() },
	returns: invitationPreview,
	handler: async (ctx, args): Promise<InvitationPreview> => {
		if (!/^[A-Za-z0-9_-]{43}$/.test(args.token)) return { status: 'unavailable' };
		const preview = await ctx.runQuery(internal.companyInvitations.previewHash, {
			tokenHash: await tokenHash(args.token)
		});
		if (preview.status !== 'available') return preview;
		const { expiresAt, ...details } = preview;
		const expiresInMs = expiresAt - Date.now();
		return expiresInMs > 0 ? { ...details, expiresInMs } : { status: 'expired' };
	}
});

export const resolve = action({
	args: { token: v.string() },
	returns: invitationResolution,
	handler: async (ctx, args): Promise<InvitationResolution> => {
		if (!/^[A-Za-z0-9_-]{43}$/.test(args.token))
			return { status: 'unavailable', companyName: null };
		const resolution = await ctx.runQuery(internal.companyInvitations.resolveHash, {
			tokenHash: await tokenHash(args.token)
		});
		if (!('expiresAt' in resolution)) return resolution;
		const { expiresAt, ...details } = resolution;
		return expiresAt !== undefined && expiresAt <= Date.now()
			? { status: 'expired', companyName: details.companyName }
			: details;
	}
});
