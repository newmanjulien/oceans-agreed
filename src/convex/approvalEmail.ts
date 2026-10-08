'use node';

import nodemailer from 'nodemailer';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { env, internalAction } from './_generated/server';

class ConfigurationError extends Error {}
class RecipientRejected extends Error {}

function configuration() {
	const values = {
		APPROVAL_EMAIL: env.APPROVAL_EMAIL?.trim(),
		APP_URL: env.APP_URL?.trim(),
		SMTP_USER: env.SMTP_USER?.trim(),
		SMTP_APP_PASSWORD: env.SMTP_APP_PASSWORD?.trim()
	};
	const missing = Object.entries(values)
		.filter(([, value]) => !value)
		.map(([key]) => key);
	if (missing.length)
		throw new ConfigurationError(
			`Approval email is not configured. Missing backend environment variables: ${missing.join(', ')}.`
		);
	let url: URL;
	try {
		url = new URL(values.APP_URL!);
	} catch {
		throw new ConfigurationError('APP_URL must be a valid HTTP or HTTPS app URL.');
	}
	if (
		!['https:', 'http:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new ConfigurationError(
			'APP_URL must be an HTTP or HTTPS app URL without credentials, a query, or a fragment.'
		);
	return {
		to: values.APPROVAL_EMAIL!,
		appUrl: url.href.replace(/\/$/, ''),
		user: values.SMTP_USER!,
		password: values.SMTP_APP_PASSWORD!
	};
}

const ERROR_CODES = new Set([
	'EAUTH',
	'EENVELOPE',
	'EMESSAGE',
	'ESTREAM',
	'ETLS',
	'EPROTOCOL',
	'ECONNECTION',
	'ESOCKET',
	'ETIMEDOUT',
	'ECONNRESET',
	'ECONNREFUSED',
	'ECONNABORTED',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'EDNS',
	'ENOTFOUND',
	'EAI_AGAIN'
]);
const SMTP_COMMANDS = new Set([
	'API',
	'CONN',
	'CONNECT',
	'EHLO',
	'HELO',
	'STARTTLS',
	'AUTH',
	'AUTH PLAIN',
	'AUTH LOGIN',
	'AUTH XOAUTH2',
	'MAIL FROM',
	'RCPT TO',
	'DATA',
	'RSET',
	'QUIT'
]);
function diagnostics(cause: unknown) {
	const error =
		typeof cause === 'object' && cause !== null
			? (cause as { code?: unknown; command?: unknown; responseCode?: unknown })
			: {};
	return {
		...(typeof error.code === 'string' && ERROR_CODES.has(error.code) ? { code: error.code } : {}),
		...(typeof error.command === 'string' && SMTP_COMMANDS.has(error.command)
			? { command: error.command }
			: {}),
		...(typeof error.responseCode === 'number' &&
		Number.isInteger(error.responseCode) &&
		error.responseCode >= 100 &&
		error.responseCode < 600
			? { responseCode: error.responseCode }
			: {})
	};
}

function failure(cause: unknown, dispatched: boolean) {
	const diagnostic = diagnostics(cause);
	const rejected =
		cause instanceof RecipientRejected ||
		(diagnostic.responseCode !== undefined && diagnostic.responseCode >= 400);
	const confirmed =
		!dispatched ||
		rejected ||
		['EAUTH', 'EENVELOPE', 'EDNS'].includes(diagnostic.code ?? '') ||
		(diagnostic.code === 'EMESSAGE' && ['API', 'MAIL FROM'].includes(diagnostic.command ?? ''));
	let error: string;
	if (!confirmed)
		error =
			'Gmail delivery could not be confirmed. Wait 10 minutes before retrying; another request may deliver a duplicate email.';
	else if (cause instanceof ConfigurationError) error = cause.message;
	else if (diagnostic.code === 'EAUTH')
		error = 'Gmail authentication failed. Check SMTP_USER and SMTP_APP_PASSWORD, then retry.';
	else if (rejected || diagnostic.code === 'EENVELOPE')
		error = 'Gmail rejected the approval email. Check the sender and APPROVAL_EMAIL, then retry.';
	else if (diagnostic.code === 'EMESSAGE')
		error =
			'The approval email could not be prepared. Check the Gmail SMTP configuration, then retry.';
	else
		error = 'The approval email stopped before Gmail dispatch. Check the configuration and retry.';
	return { status: confirmed ? ('failed' as const) : ('uncertain' as const), error };
}

export const send = internalAction({
	args: { id: v.id('savedContracts'), requestId: v.string() },
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		let stage = 'load_request';
		let dispatched = false;
		let outcome: { status: 'sent' | 'failed' | 'uncertain'; error?: string; messageId?: string };
		let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
		try {
			const request = await ctx.runQuery(internal.approvals.forSend, args);
			if (!request) return null;
			stage = 'configuration';
			const config = configuration();
			stage = 'load_descriptions';
			const requiresApproval: string[] = [];
			const noApprovalRequired: string[] = [];
			// Each query returns at most four descriptions, keeping both result size
			// and reads bounded. The full email exists only inside this Node action.
			for (let offset = 0; offset < request.selectionCount; offset += 4) {
				const descriptions = await ctx.runQuery(internal.approvals.descriptions, {
					...args,
					offset
				});
				if (!descriptions) return null;
				for (const c of descriptions)
					(c.requiresApproval ? requiresApproval : noApprovalRequired).push(`- ${c.description}`);
			}
			const concessions = `Concessions requiring approval:\n${requiresApproval.join('\n')}${
				noApprovalRequired.length
					? `\n\nConcessions not requiring approval:\n${noApprovalRequired.join('\n')}`
					: ''
			}`;
			stage = 'prepare_transport';
			transport = nodemailer.createTransport({
				host: 'smtp.gmail.com',
				port: 465,
				secure: true,
				auth: { user: config.user, pass: config.password },
				connectionTimeout: 30_000,
				greetingTimeout: 30_000,
				socketTimeout: 60_000
			});
			const mail = {
				from: config.user,
				to: config.to,
				subject: `Approval requested — ${request.companyName}'s contract`,
				text: `Approval was requested for contract that's being prepared for ${request.companyName}.\n\nOpen the contract to approve: ${config.appUrl}/contracts/${args.id}\n\n${concessions}`
			};
			stage = 'mark_dispatch';
			// Do not retry this write: an ambiguous write failure must never lead to SMTP.
			if (!(await ctx.runMutation(internal.approvals.startDispatch, args))) return null;
			dispatched = true;
			stage = 'smtp_dispatch';
			const result = await transport.sendMail(mail);
			if (!result.accepted.length) throw new RecipientRejected();
			outcome = { status: 'sent', messageId: result.messageId };
			console.info('approval_delivery', {
				requestId: args.requestId,
				stage: 'gmail_accepted',
				messageId: result.messageId
			});
		} catch (cause) {
			outcome = failure(cause, dispatched);
			console.warn('approval_delivery', {
				requestId: args.requestId,
				stage,
				...diagnostics(cause),
				status: outcome.status
			});
		} finally {
			try {
				transport?.close();
			} catch (cause) {
				console.warn('approval_delivery', {
					requestId: args.requestId,
					stage: 'close_transport',
					...diagnostics(cause)
				});
			}
		}
		// Only persistence is retried. Gmail is contacted at most once by this action.
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				await ctx.runMutation(internal.approvals.complete, { ...args, ...outcome });
				return null;
			} catch (cause) {
				console.warn('approval_delivery', {
					requestId: args.requestId,
					stage: 'persist_result',
					attempt: attempt + 1,
					...diagnostics(cause)
				});
				if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
			}
		}
		// The scheduled recovery observes this failed job and classifies its outcome
		// using the durable dispatch marker, including acceptance lost to persistence.
		throw new Error(
			'Approval delivery result could not be persisted; scheduled recovery will resolve the request.'
		);
	}
});
