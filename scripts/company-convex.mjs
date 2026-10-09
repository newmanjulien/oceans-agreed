import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { configuredEnv } from './convex-env.mjs';

const require = createRequire(import.meta.url);
const convexCli = resolve(
	dirname(require.resolve('convex/package.json')),
	require('convex/package.json').bin.convex
);
const runCli = promisify(execFile);

export function companyArguments({ audit = false } = {}) {
	const args = process.argv.slice(2);
	const index = args.indexOf('--company-id');
	const companyId = index >= 0 ? args[index + 1] : undefined;
	const exactSeed = audit && args.includes('--seed');
	const rest = args.filter(
		(_, i) => (index < 0 || (i !== index && i !== index + 1)) && !(audit && args[i] === '--seed')
	);
	if (!companyId || companyId.startsWith('--') || rest.length) {
		throw new Error(
			`Usage: ${audit ? 'npm run db:audit -- [--seed]' : 'npm run convex:seed --'} --company-id COMPANY_ID`
		);
	}
	return { companyId, exactSeed };
}

export async function companyDeployment({ readOnly = false } = {}) {
	const { PUBLIC_CONVEX_URL: url, CONVEX_DEPLOYMENT: deployment } = await configuredEnv(
		'PUBLIC_CONVEX_URL',
		'CONVEX_DEPLOYMENT'
	);
	const match = deployment?.match(/^(dev|local|prod):([^:]+)$/);
	if (!url || !match || (!readOnly && match[1] === 'prod')) {
		throw new Error(
			readOnly
				? 'Configure PUBLIC_CONVEX_URL and CONVEX_DEPLOYMENT for this audit.'
				: 'Seeding requires a configured development or local deployment.'
		);
	}
	const [, kind, name] = match;
	const hostname = new URL(url).hostname;
	const isLocal = ['127.0.0.1', 'localhost'].includes(hostname);
	if ((kind === 'local' && !isLocal) || (kind !== 'local' && hostname !== `${name}.convex.cloud`)) {
		throw new Error('PUBLIC_CONVEX_URL does not match CONVEX_DEPLOYMENT. No operation was run.');
	}
	const target = kind === 'local' ? [] : ['--deployment', name];
	console.log(
		`target: ${deployment} (${kind === 'prod' ? 'production, read-only' : kind === 'local' ? 'local' : 'personal dev'})`
	);
	return {
		url,
		async run(functionName, args) {
			if (readOnly && functionName !== 'companyTemplateImport:readPage')
				throw new Error('This audit allows only the scoped read query.');
			let stdout;
			try {
				({ stdout } = await runCli(
					process.execPath,
					[convexCli, 'run', functionName, JSON.stringify(args), ...target],
					{ encoding: 'utf8', maxBuffer: 8_000_000 }
				));
			} catch (error) {
				throw new Error(`${functionName} failed: ${error.stderr?.trim() || error.code}`);
			}
			return stdout.trim() ? JSON.parse(stdout) : null;
		}
	};
}

export async function companyRows(deployment, companyId, table) {
	const rows = [];
	let cursor = null;
	while (true) {
		const result = await deployment.run('companyTemplateImport:readPage', {
			companyId,
			table,
			paginationOpts: { cursor, numItems: 25 }
		});
		rows.push(...result.page);
		if (result.done) return rows;
		cursor = result.cursor;
	}
}
