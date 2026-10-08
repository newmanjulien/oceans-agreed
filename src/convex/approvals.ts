import { requireProfile, accessibleContract } from './auth';
import { ConvexError, v, type Infer } from 'convex/values';
import { internal } from './_generated/api';
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { approvalRequest, approvalSelection } from './contractValidators';
import { readSnapshot, readSnapshotItem } from './templates';
import { CompiledContract } from '../lib/contract/compiled-contract';
import { activeConflicts } from '../lib/playbook/selection-conflicts';
import { toDocumentOverlay } from '../lib/playbook/document-overlay';

const RECOVERY_INTERVAL = 60_000;
const UNCERTAIN_COOLDOWN = 10 * 60_000;
const requestArgs = { id: v.id('savedContracts'), requestId: v.string() };
type Request = Doc<'approvalRequests'>;

function latestFor(ctx: QueryCtx, id: Id<'savedContracts'>) {
	return ctx.db
		.query('approvalRequests')
		.withIndex('by_contractId', (q) => q.eq('contractId', id))
		.unique();
}

function publicRequest(request: Infer<typeof approvalRequest>): Infer<typeof approvalRequest> {
	return {
		id: request.id,
		companyName: request.companyName,
		selectedConcessions: request.selectedConcessions,
		status: request.status,
		requestedAt: request.requestedAt,
		retryEligible: request.retryEligible,
		completedAt: request.completedAt,
		error: request.error,
		retryAt: request.retryAt
	};
}

async function jobActive(ctx: QueryCtx, request: Request) {
	const job = await ctx.db.system.get('_scheduled_functions', request.sendJobId);
	return job?.state.kind === 'pending' || job?.state.kind === 'inProgress';
}

async function requestForClient(ctx: QueryCtx, request: Request) {
	// The job can finish between recovery polls. React to its state so a confirmed
	// failure becomes retryable immediately, while an active action still blocks it.
	const retryEligible =
		(request.status === 'failed' || request.retryEligible) && !(await jobActive(ctx, request));
	return publicRequest({ ...request, retryEligible });
}

export const latest = query({
	args: { id: v.id('savedContracts') },
	returns: v.union(approvalRequest, v.null()),
	handler: async (ctx, { id }) => {
		await requireProfile(ctx);
		if (!(await accessibleContract(ctx, await ctx.db.get('savedContracts', id)))) return null;
		const request = await latestFor(ctx, id);
		return request ? requestForClient(ctx, request) : null;
	}
});

export const request = mutation({
	args: { id: v.id('savedContracts'), expectedRevision: v.number() },
	returns: approvalRequest,
	handler: async (ctx, { id, expectedRevision }): Promise<Infer<typeof approvalRequest>> => {
		await requireProfile(ctx);
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
			throw new ConvexError('Invalid contract revision.');
		const contract = await accessibleContract(ctx, await ctx.db.get('savedContracts', id));
		if (!contract) throw new ConvexError('This contract was deleted.');
		if ((contract.revision ?? 0) !== expectedRevision)
			throw new ConvexError(
				'This contract changed. Wait for the latest saved version before requesting approval.'
			);
		const snapshot = await readSnapshot(ctx, contract);
		const selectedConcessions: Infer<typeof approvalSelection>[] = [];
		let approvalNeeded = false;
		for (const item of snapshot.items) {
			const concessionPosition = item.concessions.findIndex(
				(c) => c.id === contract.selectedConcessions[item._id]
			);
			if (concessionPosition < 0) continue;
			selectedConcessions.push({ itemId: item._id, concessionPosition });
			approvalNeeded ||= Boolean(item.instructions?.changesNeedApproval?.trim());
		}
		if (selectedConcessions.length !== Object.keys(contract.selectedConcessions).length)
			throw new ConvexError('A selected concession does not belong to this contract.');
		if (!approvalNeeded) throw new ConvexError('These concessions do not require approval.');
		if (!contract.companyName.trim()) throw new ConvexError('Enter a buyer company name.');
		try {
			const compiled = new CompiledContract(snapshot.blocks);
			if (
				activeConflicts(
					compiled.index,
					snapshot.items.map(toDocumentOverlay),
					contract.selectedConcessions
				).length
			)
				throw new ConvexError('Remove conflicting concessions before requesting approval.');
		} catch (error) {
			if (error instanceof ConvexError) throw error;
			throw new ConvexError('This contract snapshot has errors. Approval could not be requested.');
		}
		const previous = await latestFor(ctx, id);
		if (previous) {
			const sameSelections =
				previous.selectedConcessions.length === selectedConcessions.length &&
				previous.selectedConcessions.every(
					(selection, i) =>
						selection.itemId === selectedConcessions[i].itemId &&
						selection.concessionPosition === selectedConcessions[i].concessionPosition
				);
			// Block the entire contract while unresolved, including changed selections.
			if (
				previous.status === 'sending' ||
				(previous.status === 'sent' &&
					previous.companyName === contract.companyName &&
					sameSelections) ||
				(previous.status === 'uncertain' && !previous.retryEligible) ||
				(await jobActive(ctx, previous))
			)
				return requestForClient(ctx, previous);
		}
		const requestedAt = Date.now();
		const requestId = `${requestedAt}-${Math.random().toString(36).slice(2)}`;
		const args = { id, requestId };
		const sendJobId = await ctx.scheduler.runAfter(0, internal.approvalEmail.send, args);
		await ctx.scheduler.runAfter(RECOVERY_INTERVAL, internal.approvals.recover, args);
		const next = {
			id: requestId,
			contractId: id,
			companyName: contract.companyName,
			selectedConcessions,
			status: 'sending' as const,
			requestedAt,
			sendJobId,
			dispatchStarted: false,
			retryEligible: false
		};
		if (previous) await ctx.db.replace('approvalRequests', previous._id, next);
		else await ctx.db.insert('approvalRequests', next);
		return publicRequest(next);
	}
});

export const forSend = internalQuery({
	args: requestArgs,
	returns: v.union(v.object({ companyName: v.string(), selectionCount: v.number() }), v.null()),
	handler: async (ctx, { id, requestId }) => {
		const request = await latestFor(ctx, id);
		if (request?.id !== requestId || request.status !== 'sending' || request.dispatchStarted)
			return null;
		if (!(await accessibleContract(ctx, await ctx.db.get('savedContracts', id)))) return null;
		return { companyName: request.companyName, selectionCount: request.selectedConcessions.length };
	}
});

export const descriptions = internalQuery({
	args: { ...requestArgs, offset: v.number() },
	returns: v.union(
		v.array(v.object({ description: v.string(), requiresApproval: v.boolean() })),
		v.null()
	),
	handler: async (ctx, { id, requestId, offset }) => {
		if (!Number.isSafeInteger(offset) || offset < 0)
			throw new ConvexError('Invalid selection offset.');
		const request = await latestFor(ctx, id);
		if (request?.id !== requestId || request.status !== 'sending' || request.dispatchStarted)
			return null;
		const contract = await accessibleContract(ctx, await ctx.db.get('savedContracts', id));
		if (!contract) return null;
		return Promise.all(
			request.selectedConcessions.slice(offset, offset + 4).map(async (selection) => {
				const item = await readSnapshotItem(ctx, contract, selection.itemId);
				const concession = item?.concessions[selection.concessionPosition];
				if (!item || !concession) throw new ConvexError('This contract snapshot is incomplete.');
				return {
					description: concession.description,
					requiresApproval: Boolean(item.instructions?.changesNeedApproval?.trim())
				};
			})
		);
	}
});

export const startDispatch = internalMutation({
	args: requestArgs,
	returns: v.boolean(),
	handler: async (ctx, { id, requestId }) => {
		const request = await latestFor(ctx, id);
		if (request?.id !== requestId || request.status !== 'sending' || request.dispatchStarted)
			return false;
		if (!(await accessibleContract(ctx, await ctx.db.get('savedContracts', id)))) return false;
		await ctx.db.patch('approvalRequests', request._id, { dispatchStarted: true });
		return true;
	}
});

async function recordOutcome(
	ctx: MutationCtx,
	request: Request,
	status: 'sent' | 'failed' | 'uncertain',
	error?: string,
	messageId?: string
) {
	const completedAt = Date.now();
	const retryAt = status === 'uncertain' ? completedAt + UNCERTAIN_COOLDOWN : undefined;
	await ctx.db.patch('approvalRequests', request._id, {
		status,
		completedAt,
		error,
		messageId,
		retryAt,
		retryEligible: false
	});
	return retryAt;
}

export const complete = internalMutation({
	args: {
		...requestArgs,
		status: v.union(v.literal('sent'), v.literal('failed'), v.literal('uncertain')),
		error: v.optional(v.string()),
		messageId: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, { id, requestId, status, error, messageId }) => {
		const request = await latestFor(ctx, id);
		if (
			request?.id !== requestId ||
			(request.status !== 'sending' && request.status !== 'uncertain')
		)
			return null;
		// Late acceptance may resolve uncertainty, but duplicate persistence must not
		// restart its cooldown or replace a recorded result with a different failure.
		if (request.status === 'uncertain' && status !== 'sent') return null;
		await recordOutcome(ctx, request, status, error, messageId);
		return null;
	}
});

export const recover = internalMutation({
	args: requestArgs,
	returns: v.null(),
	handler: async (ctx, { id, requestId }) => {
		const request = await latestFor(ctx, id);
		if (
			request?.id !== requestId ||
			request.status === 'sent' ||
			request.status === 'failed' ||
			request.retryEligible
		)
			return null;
		if (await jobActive(ctx, request)) {
			await ctx.scheduler.runAfter(RECOVERY_INTERVAL, internal.approvals.recover, {
				id,
				requestId
			});
			return null;
		}
		let retryAt = request.retryAt;
		if (request.status === 'sending') {
			const status = request.dispatchStarted ? 'uncertain' : 'failed';
			console.warn('approval_delivery', { requestId, stage: 'recovery', status });
			retryAt = await recordOutcome(
				ctx,
				request,
				status,
				request.dispatchStarted
					? 'Gmail delivery could not be confirmed. Wait 10 minutes before retrying; another request may deliver a duplicate email.'
					: 'The approval email stopped before Gmail dispatch. You can retry the request.'
			);
		}
		// This chain owns the cooldown whether the action or recovery recorded it.
		// The original send job is inactive before explicit retry is enabled.
		if (retryAt !== undefined && Date.now() >= retryAt) {
			await ctx.db.patch('approvalRequests', request._id, { retryEligible: true });
		} else if (retryAt !== undefined) {
			await ctx.scheduler.runAt(retryAt, internal.approvals.recover, { id, requestId });
		}
		return null;
	}
});
