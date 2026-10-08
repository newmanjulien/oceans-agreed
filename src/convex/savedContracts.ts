import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import {
	contractCard,
	contractState,
	saveResult,
	selections,
	snapshot
} from './savedContractValidators';
import { MAX_SELECTED_CONCESSIONS } from '../lib/contract/selection-limits';
import {
	currentPointer,
	readLiveSnapshot,
	readSnapshot,
	readSnapshotBlocks,
	readSnapshotItem
} from './templates';
import { CompiledContract } from '../lib/contract/compiled-contract';
import { toDocumentOverlay } from '../lib/playbook/document-overlay';
import { activeConflicts } from '../lib/playbook/selection-conflicts';
import { sameSelection } from '../lib/playbook/model';
import { requireProfile, accessibleContract, creatorDeleted, scopedOperation } from './auth';

function companyName(value: string) {
	const name = value.trim();
	if (!name) throw new ConvexError('Enter a buyer company name.');
	if (name.length > 200) throw new ConvexError('Company names must be 200 characters or fewer.');
	return name;
}

function stateOf(contract: Doc<'savedContracts'>) {
	return {
		companyName: contract.companyName,
		selectedConcessions: contract.selectedConcessions,
		revision: contract.revision ?? 0,
		lastOperationId: contract.lastOperationId ?? null
	};
}

function validateOperationId(operationId: string) {
	if (!operationId.trim() || operationId.length > 200)
		throw new ConvexError('Invalid save operation.');
}

export const browse = query({
	args: { search: v.string(), paginationOpts: paginationOptsValidator },
	returns: paginationResultValidator(contractCard),
	handler: async (ctx, args) => {
		await requireProfile(ctx);
		const search = args.search.trim().slice(0, 200);
		const contracts = ctx.db.query('savedContracts');
		const query = search
			? contracts.withSearchIndex('search_companyName', (q) => q.search('companyName', search))
			: contracts.withIndex('by_savedAt').order('desc');
		const result = await query.paginate(args.paginationOpts);
		const creators = new Map<
			Id<'profiles'> | undefined,
			Promise<{
				name: string;
				avatarUrl: string | null;
			} | null>
		>();
		function resolveCreator(id: Id<'profiles'> | undefined) {
			let creator = creators.get(id);
			if (!creator) {
				creator = (async () => {
					if (await creatorDeleted(ctx, id)) return null;
					const profile = id ? await ctx.db.get('profiles', id) : null;
					return {
						name: profile?.name || profile?.email || 'Colleague',
						avatarUrl: profile?.avatarId ? await ctx.storage.getUrl(profile.avatarId) : null
					};
				})();
				creators.set(id, creator);
			}
			return creator;
		}
		return {
			...result,
			page: (
				await Promise.all(
					result.page.map(async (contract) => {
						const creator = await resolveCreator(contract.creatorId);
						if (!creator) return null;
						return {
							_id: contract._id,
							companyName: contract.companyName,
							savedAt: contract.savedAt,
							creator
						};
					})
				)
			).filter((card): card is NonNullable<typeof card> => card !== null)
		};
	}
});

export const currentSnapshot = query({
	args: {},
	returns: snapshot,
	handler: async (ctx) => {
		await requireProfile(ctx);
		return readLiveSnapshot(ctx);
	}
});

export const load = query({
	// Invalid URLs return the same missing state as deleted contracts.
	args: { id: v.string() },
	returns: v.union(
		v.null(),
		v.object({
			contract: schema.doc('savedContracts').omit('baselineVersion', 'playbookVersion'),
			snapshot
		})
	),
	handler: async (ctx, { id }) => {
		await requireProfile(ctx);
		const contractId = ctx.db.normalizeId('savedContracts', id);
		const contract = contractId
			? await accessibleContract(ctx, await ctx.db.get('savedContracts', contractId))
			: null;
		if (!contract) return null;
		const { baselineVersion, playbookVersion, ...details } = contract;
		return { contract: details, snapshot: await readSnapshot(ctx, contract) };
	}
});

export const state = query({
	// Like full reads, route IDs may be malformed or refer to deleted contracts.
	args: { id: v.string() },
	returns: v.union(contractState, v.null()),
	handler: async (ctx, { id }) => {
		await requireProfile(ctx);
		const contractId = ctx.db.normalizeId('savedContracts', id);
		const contract = contractId
			? await accessibleContract(ctx, await ctx.db.get('savedContracts', contractId))
			: null;
		return contract ? stateOf(contract) : null;
	}
});

export const create = mutation({
	args: { companyName: v.string(), operationId: v.string() },
	returns: v.union(
		v.object({
			status: v.literal('created'),
			id: v.id('savedContracts'),
			contract: schema.doc('savedContracts').omit('baselineVersion', 'playbookVersion')
		}),
		v.object({ status: v.literal('deleted') })
	),
	handler: async (ctx, args) => {
		const profile = await requireProfile(ctx);
		validateOperationId(args.operationId);
		const receipt = await ctx.db
			.query('contractCreationReceipts')
			.withIndex('by_operationId', (q) =>
				q.eq('operationId', scopedOperation(profile, args.operationId))
			)
			.unique();
		if (receipt) {
			const original = await ctx.db.get('savedContracts', receipt.contractId);
			if (!(await accessibleContract(ctx, original))) return { status: 'deleted' as const };
			const { baselineVersion, playbookVersion, ...contract } = original!;
			return { status: 'created' as const, id: receipt.contractId, contract };
		}
		const name = companyName(args.companyName);
		const pointer = await currentPointer(ctx);
		if (pointer?.maintenance)
			throw new ConvexError('Template maintenance is in progress. Try again shortly.');
		const version = pointer?.versionId
			? await ctx.db.get('templateVersions', pointer.versionId)
			: null;
		if (!version) throw new ConvexError('The baseline contract is not available.');
		const id = await ctx.db.insert('savedContracts', {
			companyName: name,
			creatorId: profile._id,
			savedAt: Date.now(),
			selectedConcessions: {},
			revision: 0,
			templateVersionId: version._id,
			blockCount: version.blockCount,
			itemCount: version.itemCount
		});
		await ctx.db.insert('contractCreationReceipts', {
			operationId: scopedOperation(profile, args.operationId),
			contractId: id
		});
		const { baselineVersion, playbookVersion, ...contract } = (await ctx.db.get(
			'savedContracts',
			id
		))!;
		return { status: 'created' as const, id, contract };
	}
});

export const saveChoices = mutation({
	args: {
		id: v.id('savedContracts'),
		selectedConcessions: selections,
		expectedRevision: v.number(),
		operationId: v.string()
	},
	returns: saveResult,
	handler: async (ctx, { id, selectedConcessions, expectedRevision, operationId }) => {
		const profile = await requireProfile(ctx);
		validateOperationId(operationId);
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
			throw new ConvexError('Invalid contract revision.');
		const contract = await accessibleContract(ctx, await ctx.db.get('savedContracts', id));
		if (!contract) return { status: 'deleted' as const };
		// A replay is acknowledged before checking its now-stale expected revision.
		if (contract.lastOperationId === operationId && contract.lastOperationCaller === profile._id)
			return { status: 'saved' as const, state: stateOf(contract) };
		if ((contract.revision ?? 0) !== expectedRevision)
			return { status: 'conflict' as const, state: stateOf(contract) };
		// An unchanged save acknowledges current state without consuming a revision or
		// operation ID. A retry after an intervening change still follows conflict rules.
		if (sameSelection(contract.selectedConcessions, selectedConcessions))
			return { status: 'saved' as const, state: stateOf(contract) };
		// Snapshots are validated once at publication and never edited. Validate membership
		// first; baseline compilation is only needed to check conflicts between items.
		const selectedIds = Object.keys(selectedConcessions) as Doc<'playbookItems'>['_id'][];
		if (selectedIds.length > MAX_SELECTED_CONCESSIONS)
			throw new ConvexError('Too many selected concessions.');
		const items: Doc<'playbookItems'>[] = [];
		// Bound concurrent I/O while reading only the selected snapshot items.
		const batchSize = 64;
		for (let offset = 0; offset < selectedIds.length; offset += batchSize) {
			const selected = selectedIds.slice(offset, offset + batchSize);
			const rows = await Promise.all(
				selected.map((itemId) => readSnapshotItem(ctx, contract, itemId))
			);
			for (let index = 0; index < rows.length; index++) {
				const item = rows[index];
				if (!item?.concessions.some((c) => c.id === selectedConcessions[selected[index]]))
					throw new ConvexError('A selected concession does not belong to this contract.');
				items.push(item);
			}
		}
		if (items.length > 1) {
			const blocks = await readSnapshotBlocks(ctx, contract);
			const compiled = new CompiledContract(blocks);
			if (activeConflicts(compiled.index, items.map(toDocumentOverlay), selectedConcessions).length)
				throw new ConvexError('Remove conflicting concessions before saving.');
		}
		const revision = expectedRevision + 1;
		await ctx.db.patch('savedContracts', id, {
			selectedConcessions,
			revision,
			lastOperationId: operationId,
			lastOperationCaller: profile._id,
			savedAt: Date.now()
		});
		return {
			status: 'saved' as const,
			state: stateOf({ ...contract, selectedConcessions, revision, lastOperationId: operationId })
		};
	}
});

export const rename = mutation({
	args: { id: v.id('savedContracts'), companyName: v.string() },
	returns: v.null(),
	handler: async (ctx, { id, companyName: value }) => {
		await requireProfile(ctx);
		const contract = await accessibleContract(ctx, await ctx.db.get('savedContracts', id));
		if (!contract) throw new ConvexError('This contract was deleted.');
		const name = companyName(value);
		if (name === contract.companyName) return null;
		await ctx.db.patch('savedContracts', id, { companyName: name, savedAt: Date.now() });
		return null;
	}
});

export const remove = mutation({
	args: { id: v.id('savedContracts') },
	returns: v.null(),
	handler: async (ctx, { id }) => {
		await requireProfile(ctx);
		if (!(await accessibleContract(ctx, await ctx.db.get('savedContracts', id)))) return null;
		for (const table of ['contractSnapshotBlocks', 'contractSnapshotItems'] as const) {
			const rows = await ctx.db
				.query(table)
				.withIndex('by_contractId', (q) => q.eq('contractId', id))
				.take(4097);
			if (rows.length > 4096) throw new ConvexError('Contract exceeds supported size.');
			for (const row of rows) await ctx.db.delete(table, row._id);
		}
		const request = await ctx.db
			.query('approvalRequests')
			.withIndex('by_contractId', (q) => q.eq('contractId', id))
			.unique();
		if (request) {
			const job = await ctx.db.system.get('_scheduled_functions', request.sendJobId);
			if (job?.state.kind === 'pending' || job?.state.kind === 'inProgress')
				await ctx.scheduler.cancel(request.sendJobId);
			await ctx.db.delete('approvalRequests', request._id);
		}
		await ctx.db.delete('savedContracts', id);
		return null;
	}
});
