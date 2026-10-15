/**
 * Guard against smoke tests that run a `dist/` older than `src/`.
 */

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
  throw new Error(`not implemented: ${srcDir} ${distEntry}`);
}

/**
 * Fail fast when `dist/index.js` is older than `src/`.
 *
 * @throws Error telling to run `npm run build`
 */
export function assertDistFresh(): void {
  throw new Error('not implemented');
}
