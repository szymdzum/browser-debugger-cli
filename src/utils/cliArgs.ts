/**
 * Reading the command line before Commander parses it: which words can be
 * flags, and whether JSON output was requested. Free of imports, so the
 * entry point can use it before the CLI loads.
 */

/** The spellings of the JSON output flag */
export const JSON_FLAGS = ['--json', '-j'];

/**
 * CLI arguments that can be flags: everything before a literal `--`.
 *
 * Values after `--` (e.g. `bdg dom fill sel -- -j`) must never be mistaken
 * for `--json` / `--help`.
 *
 * @returns Option-position arguments
 */
export function flagArgs(): string[] {
  const args = process.argv.slice(2);
  const end = args.indexOf('--');
  return end === -1 ? args : args.slice(0, end);
}

/**
 * Whether JSON output was requested (`--json` / `-j`).
 *
 * @returns True for JSON mode
 */
export function isJsonMode(): boolean {
  const args = flagArgs();
  return JSON_FLAGS.some((flag) => args.includes(flag));
}
