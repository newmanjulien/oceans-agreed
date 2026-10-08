import { defineSchema, defineTable, docValidator } from 'convex/server';
import { v } from 'convex/values';
import { baselineBlock } from './sourceValidators';
import { playbookItem } from './playbookValidators';
import { storedApprovalRequest, selections } from './contractValidators';
import { role } from './permissions';
const playbookItems = defineTable(
	playbookItem.extend({
		// Read old records without migration; full-item saves remove this unused field.
		authoringMode: v.optional(v.union(v.literal('explain'), v.literal('concession'))),
		revision: v.optional(v.number()),
		lastOperationId: v.optional(v.string()),
		lastOperationCaller: v.optional(v.id('profiles'))
	})
);
export default defineSchema({
	profiles: defineTable({
		identity: v.string(),
		issuer: v.string(),
		clerkId: v.string(),
		email: v.string(),
		name: v.string(),
		role,
		avatarId: v.optional(v.id('_storage'))
	})
		.index('by_identity', ['identity'])
		.index('by_issuer_and_clerkId', ['issuer', 'clerkId']),
	company: defineTable({
		key: v.literal('shared'),
		name: v.string(),
		avatarId: v.optional(v.id('_storage'))
	}).index('by_key', ['key']),
	workspace: defineTable({
		key: v.literal('shared'),
		legacyOwnerId: v.id('profiles'),
		ready: v.boolean()
	}).index('by_key', ['key']),
	deletedUsers: defineTable({
		issuer: v.string(),
		clerkId: v.string(),
		profileId: v.optional(v.id('profiles')),
		deletedAt: v.number(),
		complete: v.boolean(),
		cleanupJobId: v.optional(v.id('_scheduled_functions')),
		cleanupGeneration: v.optional(v.number())
	})
		.index('by_issuer_and_clerkId', ['issuer', 'clerkId'])
		.index('by_profileId', ['profileId'])
		.index('by_complete', ['complete']),
	contractBlocks: defineTable(baselineBlock).index('by_order', ['order']),
	playbookItems,
	templateVersions: defineTable({
		publishedAt: v.number(),
		blockCount: v.number(),
		itemCount: v.number(),
		snapshotBytes: v.number()
	}),
	currentTemplate: defineTable({
		key: v.literal('current'),
		versionId: v.optional(v.id('templateVersions')),
		maintenance: v.boolean()
	}).index('by_key', ['key']),
	templateVersionBlocks: defineTable({
		versionId: v.id('templateVersions'),
		block: baselineBlock
	}).index('by_versionId', ['versionId']),
	templateVersionItems: defineTable({
		versionId: v.id('templateVersions'),
		itemId: v.id('playbookItems'),
		item: docValidator('playbookItems', playbookItems)
	})
		.index('by_versionId', ['versionId'])
		.index('by_versionId_and_itemId', ['versionId', 'itemId']),
	savedContracts: defineTable({
		creatorId: v.optional(v.id('profiles')),
		templateVersionId: v.optional(v.id('templateVersions')),
		companyName: v.string(),
		savedAt: v.number(),
		selectedConcessions: selections,
		revision: v.optional(v.number()),
		lastOperationId: v.optional(v.string()),
		lastOperationCaller: v.optional(v.id('profiles')),
		// Legacy snapshot hashes; no longer written or returned.
		baselineVersion: v.optional(v.string()),
		playbookVersion: v.optional(v.string()),
		blockCount: v.number(),
		itemCount: v.number()
	})
		.index('by_savedAt', ['savedAt'])
		.index('by_creatorId', ['creatorId'])
		.searchIndex('search_companyName', { searchField: 'companyName' }),
	approvalRequests: defineTable(storedApprovalRequest).index('by_contractId', ['contractId']),
	contractSnapshotBlocks: defineTable({
		contractId: v.id('savedContracts'),
		block: baselineBlock
	}).index('by_contractId', ['contractId']),
	contractSnapshotItems: defineTable({
		contractId: v.id('savedContracts'),
		itemId: v.id('playbookItems'),
		// Keep the original identity even after the live playbook item is deleted.
		item: docValidator('playbookItems', playbookItems)
	})
		.index('by_contractId', ['contractId'])
		.index('by_contractId_and_itemId', ['contractId', 'itemId']),
	// Receipts survive contract deletion so a creation retry cannot resurrect it.
	contractCreationReceipts: defineTable({
		operationId: v.string(),
		contractId: v.id('savedContracts')
	}).index('by_operationId', ['operationId']),
	// Transport receipts survive deletion; retry must never recreate a deleted item.
	creationReceipts: defineTable({ operationId: v.string(), itemId: v.id('playbookItems') }).index(
		'by_operationId',
		['operationId']
	)
});
