/**
 * Guard against smoke tests that run a `dist/` older than `src/`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Test code does not make the compiled CLI stale */
const TEST_CODE = /(^|[\\/])(__tests__|__testutils__)([\\/]|$)|\.test\.[cm]?[jt]s$/;

/** Set once `dist/` was found current: a process checks only once */
let verified = false;

/**
 * First product source file under `dir` modified after `builtAtMs`.
 *
 * @param dir - Directory to search
 * @param builtAtMs - Modification time of the compiled entry point
 * @returns Path of a newer file, or undefined
 */
function newerThan(dir: string, builtAtMs: number): string | undefined {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (TEST_CODE.test(file)) continue;
    if (entry.isDirectory()) {
      const found = newerThan(file, builtAtMs);
      if (found) return found;
    } else if (fs.statSync(file).mtimeMs > builtAtMs) {
      return file;
    }
  }
  return undefined;
}

/**
 * First product source file under `srcDir` modified after `distEntry`.
 * Test code (`__tests__`, `__testutils__`, `*.test.ts`) is skipped: editing a
 * test does not make the compiled CLI stale.
 *
 * @param srcDir - Source directory
 * @param distEntry - Compiled CLI entry point
 * @returns Path of a newer source file, or undefined when `dist/` is current
 */
export function findStaleSource(srcDir: string, distEntry: string): string | undefined {
  return newerThan(srcDir, fs.statSync(distEntry).mtimeMs);
}

/**
 * Fail fast when `dist/index.js` is older than `src/`. Skipped on CI: the
 * smoke job gets `dist/` as a downloaded artifact next to a fresh checkout, so
 * file times say nothing there, and CI builds before it tests.
 *
 * @throws Error telling to run `npm run build`
 */
export function assertDistFresh(): void {
  if (verified || process.env['CI']) return;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const entry = path.join(root, 'dist', 'index.js');
  if (!fs.existsSync(entry)) {
    throw new Error('dist/index.js is missing: run npm run build');
  }
  const stale = findStaleSource(path.join(root, 'src'), entry);
  if (stale) {
    throw new Error(
      `dist/ is older than src/ (${path.relative(root, stale)} changed): run npm run build`
    );
  }
  verified = true;
}
