/**
 * Top-level `await` detection with V8 itself (the daemon's, through
 * `node:vm`): the script is compiled, never run. Compiling in the daemon
 * costs no CDP round trip and works while the page is busy, which a page-side
 * probe (`Runtime.compileScript`) would wait behind.
 */

import { Script } from 'node:vm';

/**
 * Whether V8 compiles a source (it is not run).
 *
 * @param source - JavaScript
 * @returns False on a SyntaxError
 */
function compiles(source: string): boolean {
  try {
    new Script(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a `bdg dom eval` script waits at its top level (REPL mode lets a
 * script `await` outside an async function, and Chrome then answers only once
 * the promise settles). The script is compiled as the body of an async
 * function, where `await` is a keyword as in REPL mode, and as a class static
 * block, where it is reserved yet cannot wait: only a top-level `await` fails
 * the second. `await` in a string, comment, regex or nested function counts
 * as none. A script without the word is not compiled at all; one V8 cannot
 * place this way (a syntax error, newer syntax than the daemon's Node,
 * `return` or `arguments` at the top) counts as awaiting, as a text search
 * would.
 *
 * @param script - The script
 * @returns True when the script has a top-level `await`
 */
export function hasTopLevelAwait(script: string): boolean {
  if (!/\bawait\b/.test(script)) return false;
  if (!compiles(`(async function () {\n${script}\n})`)) return true;
  return !compiles(`(class { static {\n${script}\n} })`);
}
