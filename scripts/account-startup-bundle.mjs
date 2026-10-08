import fs from 'node:fs';
import zlib from 'node:zlib';

const manifest = JSON.parse(
	fs.readFileSync('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
);
// SvelteKit's root layout, protected layout and dashboard page.
const roots = [0, 2, 4].map((id) => `.svelte-kit/generated/client-optimized/nodes/${id}.js`);
const visited = new Set();
function visit(key) {
	if (visited.has(key)) return;
	const entry = manifest[key];
	if (!entry) throw new Error(`Missing manifest entry: ${key}`);
	visited.add(key);
	for (const dependency of entry.imports ?? []) visit(dependency);
}
roots.forEach(visit);
const files = [...visited].map((key) => manifest[key].file);
const contents = files.map((file) => fs.readFileSync(`.svelte-kit/output/client/${file}`));
const result = {
	kind: 'static-bundle-analysis',
	roots,
	files,
	bytes: contents.reduce((total, content) => total + content.length, 0),
	gzipBytes: contents.reduce((total, content) => total + zlib.gzipSync(content).length, 0),
	authenticatedBrowserTimings: null
};
const destination = process.argv[2];
if (destination) fs.writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
