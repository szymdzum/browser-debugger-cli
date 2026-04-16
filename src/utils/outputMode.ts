/**
 * Global output-mode detection helpers.
 *
 * These look at `process.argv` directly rather than threading Commander's
 * parsed options through every formatter. Output verbosity is a concern
 * every command shares, but only a few care enough to change behavior —
 * letting them query a single helper avoids widening option types across
 * the codebase just to pass a boolean.
 */

const QUIET_FLAGS = new Set(['-q', '--quiet']);
const JSON_FLAGS = new Set(['--json', '-j']);

/**
 * Whether the current invocation requested quiet output.
 *
 * Quiet mode suppresses decorative output — tips, "Next steps:" blocks,
 * "Suggestions:" sections, post-success hints. Primary data/results and
 * errors are still emitted. Agents should prefer `--json`; `--quiet` is
 * for humans and scripts that want terse text output.
 */
export function isQuietMode(): boolean {
  return process.argv.some((arg) => QUIET_FLAGS.has(arg));
}

/**
 * Whether the current invocation requested JSON output.
 */
export function isJsonMode(): boolean {
  return process.argv.some((arg) => JSON_FLAGS.has(arg));
}
