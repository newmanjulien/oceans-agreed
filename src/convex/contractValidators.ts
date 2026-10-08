import { v } from 'convex/values';

export const selections = v.record(v.id('playbookItems'), v.string());
// The item identity is resolved within this contract's immutable snapshot, even
// when the corresponding live playbook item has been deleted.
export const approvalSelection = v.object({
	itemId: v.id('playbookItems'),
	concessionPosition: v.number()
});
export const approvalRequest = v.object({
	id: v.string(),
	companyName: v.string(),
	selectedConcessions: v.array(approvalSelection),
	status: v.union(
		v.literal('sending'),
		v.literal('sent'),
		v.literal('failed'),
		v.literal('uncertain')
	),
	requestedAt: v.number(),
	completedAt: v.optional(v.number()),
	error: v.optional(v.string()),
	retryAt: v.optional(v.number()),
	retryEligible: v.boolean()
});
export const storedApprovalRequest = approvalRequest.extend({
	contractId: v.id('savedContracts'),
	sendJobId: v.id('_scheduled_functions'),
	dispatchStarted: v.boolean(),
	messageId: v.optional(v.string())
});
