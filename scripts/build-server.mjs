// Bundles the API server (and shared code) into dist/server/index.js; npm packages stay external.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const external = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node20', sourcemap: true, external, alias: { '@shared': './shared' }, logLevel: 'info',
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } };
await build({ ...common, entryPoints: ['server/src/index.ts'], outfile: 'dist/server/index.js' });
await build({ ...common, entryPoints: ['server/src/admin.ts'], outfile: 'dist/server/admin.js' });
