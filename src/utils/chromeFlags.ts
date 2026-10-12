/**
 * Parsing of Chrome flag lists (`BDG_CHROME_FLAGS`, `--chrome-flags`).
 */

/**
 * Split a flag list into flags. Flags are separated by spaces; there is no
 * quoting, so a flag value cannot contain a space.
 *
 * @param raw - Space-separated flags, or undefined
 * @returns The flags, without empty entries
 */
export function parseChromeFlags(raw: string | undefined): string[] {
  return raw?.split(' ').filter(Boolean) ?? [];
}
