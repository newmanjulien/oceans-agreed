import type { ConvexClient } from 'convex/browser';
import { ConvexError } from 'convex/values';
import { api } from '../../convex/_generated/api';
import type { PlaybookItem, PlaybookItemRecord } from './model';

export type SaveRequest = {
	id?: PlaybookItemRecord['_id'];
	item: PlaybookItem;
	expectedRevision: number;
	operationId: string;
};
export type Operation =
	| { kind: 'save'; request: SaveRequest }
	| { kind: 'delete'; id: PlaybookItemRecord['_id']; expectedRevision: number };
export type SaveResult =
	| { status: 'saved' | 'conflict'; item: PlaybookItemRecord }
	| { status: 'deleted' | 'missing' }
	| { status: 'rejected'; message: string };
export type SaveTransport = (operation: Operation) => Promise<SaveResult>;
export const convexSaveTransport =
	(client: ConvexClient): SaveTransport =>
	async (operation) => {
		try {
			return await (operation.kind === 'save'
				? client.mutation(api.admin.savePlaybookItem, operation.request)
				: client.mutation(api.admin.deletePlaybookItem, {
						id: operation.id,
						expectedRevision: operation.expectedRevision
					}));
		} catch (error) {
			if (
				error instanceof ConvexError &&
				typeof error.data === 'object' &&
				error.data !== null &&
				'code' in error.data &&
				error.data.code === 'TEMPLATE_PUBLICATION_REJECTED' &&
				'message' in error.data &&
				typeof error.data.message === 'string'
			)
				return { status: 'rejected', message: error.data.message };
			throw error;
		}
	};
