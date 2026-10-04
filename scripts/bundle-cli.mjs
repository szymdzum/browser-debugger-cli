#!/usr/bin/env node
/**
 * Bundles the CLI entry point into a single dist/index.js.
 *
 * Every bdg invocation starts a fresh Node process, and resolving and reading
 * the ~170 separate modules of the tsc output dominates CLI startup. The
 * daemon stays as tsc output (dist/daemon.js) since it starts once per session.
 * The banner provides `require` for bundled CommonJS dependencies.
 * `npm run watch` does not bundle: its first tsc emit replaces dist/index.js
 * with the unbundled entry, which runs the same code, only slower to start.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
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
