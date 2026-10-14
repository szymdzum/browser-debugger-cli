/**
 * Whether a `bdg dom eval` script waits at its top level (REPL mode lets a
 * script `await` outside an async function, and Chrome then answers only once
 * the promise settles).
 *
 * @param script - The script
 * @returns True when the script has a top-level `await`
 */
export function hasTopLevelAwait(script: string): boolean {
  return /\bawait\b/.test(script);
}
