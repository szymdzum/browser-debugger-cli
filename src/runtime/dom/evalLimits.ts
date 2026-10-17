/**
 * Time limits of `bdg dom eval` and the busy-page recovery. Production values
 * are fixed; the test suites shorten them through `BDG_TEST_EVAL_*`
 * environment variables (not a user feature) so the timeout paths do not take
 * their full production time. The daemon and the CLI read the limits through
 * these functions, so a value is accepted or ignored the same way everywhere.
 */

/** How long a `bdg dom eval` script may run before V8 terminates it */
const EVAL_TIMEOUT_DEFAULT_MS = 20_000;

/** Time after the limit within which a failed evaluate counts as V8 terminating it */
const TERMINATION_GRACE_DEFAULT_MS = 5_000;

/** Time the script's answer gets to arrive after the page answered the lost-answer check */
const UNSENT_GRACE_DEFAULT_MS = 12_000;

/** Shortest accepted override: below this the page cannot answer in time */
const MIN_OVERRIDE_MS = 100;

/**
 * A limit, shortened by a test override when it is a whole number of ms
 * between {@link MIN_OVERRIDE_MS} and the default. Anything else is ignored.
 *
 * @param env - Environment to read the override from
 * @param name - Override variable
 * @param defaultMs - Production limit
 * @returns Limit in ms
 */
function limitMs(env: NodeJS.ProcessEnv, name: string, defaultMs: number): number {
  const raw = env[name];
  if (raw === undefined || !/^\d+$/.test(raw)) return defaultMs;
  const value = Number(raw);
  return value >= MIN_OVERRIDE_MS && value <= defaultMs ? value : defaultMs;
}

/**
 * The eval time limit (`BDG_TEST_EVAL_TIMEOUT_MS` shortens it).
 *
 * @param env - Environment to read the test override from
 * @returns Limit in ms
 */
export function evalTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return limitMs(env, 'BDG_TEST_EVAL_TIMEOUT_MS', EVAL_TIMEOUT_DEFAULT_MS);
}

/**
 * The time after the eval limit within which a failure counts as V8
 * terminating it (`BDG_TEST_EVAL_GRACE_MS` shortens it).
 *
 * @param env - Environment to read the test override from
 * @returns Grace in ms
 */
export function terminationGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  return limitMs(env, 'BDG_TEST_EVAL_GRACE_MS', TERMINATION_GRACE_DEFAULT_MS);
}

/**
 * The time a script's answer gets to arrive once the page answered the
 * lost-answer check (`BDG_TEST_EVAL_UNSENT_GRACE_MS` shortens it).
 *
 * @param env - Environment to read the test override from
 * @returns Grace in ms
 */
export function unsentGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  return limitMs(env, 'BDG_TEST_EVAL_UNSENT_GRACE_MS', UNSENT_GRACE_DEFAULT_MS);
}
