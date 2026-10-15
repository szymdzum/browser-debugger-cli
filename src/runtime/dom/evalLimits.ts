/**
 * Time limits of `bdg dom eval` and the busy-page recovery, with test-only
 * overrides.
 */

/**
 * The eval time limit, in ms.
 *
 * @param env - Environment to read the test override from
 * @returns Limit in ms
 */
export function evalTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  void env;
  throw new Error('not implemented');
}

/**
 * The time after the eval limit within which a failure counts as V8 terminating it, in ms.
 *
 * @param env - Environment to read the test override from
 * @returns Grace in ms
 */
export function terminationGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  void env;
  throw new Error('not implemented');
}
