/**
 * Parsing of Chrome flag lists (`BDG_CHROME_FLAGS`, `--chrome-flags`).
 */

/**
 * Split a flag list into flags.
 *
 * @param raw - Space-separated flags, or undefined
 * @returns The flags, without empty entries
 */
export function parseChromeFlags(raw: string | undefined): string[] {
  throw new Error(`not implemented: ${String(raw)}`);
}
