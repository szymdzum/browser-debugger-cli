#!/usr/bin/env node
/**
 * Bundles the CLI (dist/index.js) and the daemon (dist/daemon.js) into one
 * file each.
 *
 * Every bdg invocation starts a fresh Node process, and resolving and reading
 * the ~170 separate modules of the tsc output dominates CLI startup (and
 * delays every session start by the daemon's own load).
 * The banner provides `require` for bundled CommonJS dependencies.
 * `npm run watch` does not bundle: its first tsc emit replaces both entries
 * with the unbundled ones, which run the same code, only slower to start.
 */
import { build } from 'esbuild';

const entries = [
  ['src/index.ts', 'dist/index.js'],
  ['src/daemon.ts', 'dist/daemon.js'],
];

for (const [entry, outfile] of entries) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: 'tsconfig.json',
    sourcemap: true,
    logLevel: 'warning',
    banner: {
      js: "import { createRequire as __bdgCreateRequire } from 'module';\nconst require = __bdgCreateRequire(import.meta.url);",
    },
  });
}
