import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { configuredEnv } from './convex-env.mjs';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';

function run(...args) {
	console.log(`target: ${deployment} (${isLocal ? 'local' : 'personal dev'}), convex ${args[0]}`);
	const result = spawnSync('npx', ['convex', ...args], { stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`convex ${args[0]} failed (${result.status}).`);
}

// The import is deliberately restricted to a configured dev deployment.
const { PUBLIC_CONVEX_URL: url, CONVEX_DEPLOYMENT: deployment } = await configuredEnv(
	'PUBLIC_CONVEX_URL',
	'CONVEX_DEPLOYMENT'
);
if (!url || !deployment || !/^(dev|local):/.test(deployment)) {
	throw new Error('Set PUBLIC_CONVEX_URL and a development CONVEX_DEPLOYMENT before seeding.');
}
const deploymentName = deployment.split(':', 2)[1];
const hostname = new URL(url).hostname;
const isLocal = ['127.0.0.1', 'localhost'].includes(hostname);
if (
	(!isLocal &&
		(deployment !== `dev:${deploymentName}` || hostname !== `${deploymentName}.convex.cloud`)) ||
	(isLocal && deploymentName !== 'anonymous-agent' && !deployment.startsWith('local:'))
) {
	throw new Error('PUBLIC_CONVEX_URL does not match CONVEX_DEPLOYMENT. Import aborted.');
}
const target = isLocal ? [] : ['--deployment', deploymentName];

async function readRows(name) {
	const source = (await readFile(`data/convex/${name}.jsonl`, 'utf8')).trim();
	if (!source) throw new Error(`${name} import records are empty.`);
	return source.split('\n').map((row) => JSON.parse(row));
}
const expectedBlocks = await readRows('contractBlocks');
const expectedItems = await readRows('playbookItems');

// Deploy schema and read functions; no records are changed by this command.
run('run', 'contract:getBlocks', '{}', '--push', ...target);
const client = new ConvexHttpClient(url);
const actual = async () => {
	const [blocks, items] = await Promise.all([
		client.query(anyApi.contract.getBlocks, {}),
		client.query(anyApi.playbookItems.list, {})
	]);
	return { blocks, items: items.map(({ _id, _creationTime, ...item }) => item) };
};
function status(rows, expected, table) {
	if (!rows.length) return 'missing';
	if (isDeepStrictEqual(rows, expected)) return 'complete';
	throw new Error(`${table} contains unexpected data. Import aborted without changing records.`);
}
const before = await actual();
const blockStatus = status(before.blocks, expectedBlocks, 'contractBlocks');
const itemStatus = status(before.items, expectedItems, 'playbookItems');

if (blockStatus === 'complete' && itemStatus === 'missing') {
	throw new Error('Contract blocks exist but no items remain. Refusing to restore deleted items.');
}
// Maintenance stays enabled after an interrupted import; a verified retry finishes it.
run('run', 'templates:beginImport', '{}', ...target);
// Import items first so an interrupted initial import can resume without
// confusing an intentionally empty item table with a fresh deployment.
if (itemStatus === 'missing') {
	run('import', '--table', 'playbookItems', ...target, 'data/convex/playbookItems.jsonl');
	if (status((await actual()).items, expectedItems, 'playbookItems') !== 'complete') {
		throw new Error('Playbook Item import did not complete.');
	}
}
if (blockStatus === 'missing') {
	run('import', '--table', 'contractBlocks', ...target, 'data/convex/contractBlocks.jsonl');
	if (status((await actual()).blocks, expectedBlocks, 'contractBlocks') !== 'complete') {
		throw new Error('Contract block import did not complete.');
	}
}
const after = await actual();
if (
	status(after.blocks, expectedBlocks, 'contractBlocks') !== 'complete' ||
	status(after.items, expectedItems, 'playbookItems') !== 'complete'
) {
	throw new Error('Contract import is incomplete.');
}
run('run', 'templates:finishImport', '{}', ...target);
console.log(
	`Seed baseline round trip verified: ${after.blocks.length} blocks, ${after.items.length} items.`
);
