import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { companyArguments, companyDeployment, companyRows } from './company-convex.mjs';

const { companyId } = companyArguments();
const deployment = await companyDeployment();
async function readRows(name) {
	const source = (await readFile(`data/convex/${name}.jsonl`, 'utf8')).trim();
	if (!source) throw new Error(`${name} import records are empty.`);
	return source.split('\n').map((row) => JSON.parse(row));
}
const blocks = await readRows('contractBlocks');
const items = await readRows('playbookItems');
const importKey = createHash('sha256').update(JSON.stringify({ blocks, items })).digest('hex');
const scope = { companyId, importKey };
let progress = await deployment.run('companyTemplateImport:begin', scope);
async function verifyCommitted() {
	const [actualBlocks, actualItems] = await Promise.all([
		companyRows(deployment, companyId, 'blocks'),
		companyRows(deployment, companyId, 'items')
	]);
	if (
		!isDeepStrictEqual(actualBlocks, blocks.slice(0, progress.blockCount)) ||
		!isDeepStrictEqual(actualItems, items.slice(0, progress.itemCount))
	) {
		throw new Error(
			'Company data differs from the committed seed prefix. Refusing to overwrite or restore it.'
		);
	}
}
await verifyCommitted();
// Small atomic batches keep retries within Convex and CLI argument limits.
while (progress.blockCount < blocks.length || progress.itemCount < items.length) {
	const next = {
		...scope,
		expectedBlockCount: progress.blockCount,
		expectedItemCount: progress.itemCount,
		blocks: [],
		items: []
	};
	for (const [table, count] of [
		['items', progress.itemCount],
		['blocks', progress.blockCount]
	]) {
		const source = table === 'items' ? items : blocks;
		for (let i = count; i < source.length && next.blocks.length + next.items.length < 4; i++) {
			next[table].push(source[i]);
			if (Buffer.byteLength(JSON.stringify(next)) > 64_000) {
				next[table].pop();
				break;
			}
		}
	}
	if (!next.blocks.length && !next.items.length)
		throw new Error(
			'A seed record exceeds the supported CLI batch size. Import remains in maintenance.'
		);
	await deployment.run('companyTemplateImport:append', next);
	progress = {
		blockCount: progress.blockCount + next.blocks.length,
		itemCount: progress.itemCount + next.items.length,
		complete: false
	};
}
await verifyCommitted();
await deployment.run('companyTemplateImport:finish', {
	...scope,
	blockCount: blocks.length,
	itemCount: items.length
});
console.log(
	`Company ${companyId} seed round trip verified: ${blocks.length} blocks, ${items.length} items.`
);
