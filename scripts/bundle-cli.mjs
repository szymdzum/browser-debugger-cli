#!/usr/bin/env node
/**
 * Bundles the CLI and the daemon (dist/daemon.js) into one file each. The
 * CLI is two files: the small entry (dist/index.js), which reports Ctrl-C
 * and SIGTERM before anything else loads, and the CLI it then imports
 * (dist/cli.js), kept out of the entry's bundle so it is compiled only once
 * the signals are reported.
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
  ['src/cli.ts', 'dist/cli.js'],
  ['src/daemon.ts', 'dist/daemon.js'],
];

/** Leaves the entry's `import('./cli.js')` to load dist/cli.js at run time */
const cliExternal = {
  name: 'cli-external',
  setup(build) {
    build.onResolve({ filter: /^\.\/cli\.js$/ }, (args) => ({ path: args.path, external: true }));
  },
};

for (const [entry, outfile] of entries) {
  await build({
    entryPoints: [entry],
    plugins: [cliExternal],
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
