/**
 * The source a `bdg dom eval` script runs as: the script in a block, so its
 * top-level `const`/`let`/`class` stay local to that eval instead of staying
 * in the page's global lexical scope (REPL mode still gives the block's
 * completion value and allows top-level `await`; `var` and function
 * declarations still become globals). The source is named `bdg-eval`, so
 * console messages and stack frames tell it apart from the page's scripts.
 *
 * The block's `{` is on a line of its own before the script (with a
 * `"use strict"` the script starts with, which would no longer be a
 * directive inside the block): Chrome's line numbers are one more than the
 * script's, which {@link evalLine} and {@link withEvalPositions} take back
 * in console messages and dom eval errors (a stack the script reads itself,
 * `new Error().stack`, keeps them).
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import { compiles, MAX_COMPILED_LENGTH } from '@/runtime/dom/topLevelAwait.js';

/** Source URL of `bdg dom eval` scripts */
const EVAL_SOURCE_URL = 'bdg-eval';

/** A stack frame's dom eval position (`    at f (bdg-eval:2:7)`), not one in a message */
const STACK_POSITION = new RegExp(`^(\\s+at\\s.*?)\\b${EVAL_SOURCE_URL}:(\\d+):(\\d+)`, 'gm');

/** A hashbang line at the start of a script */
const HASHBANG = /^#!/;

/** Statement that is a SyntaxError in strict code only */
const SLOPPY_ONLY = '\n;with (0) {}';

/**
 * The script as the body of an async function: where `await` works as in
 * REPL mode, and where a `}` of the script cannot close bdg's block.
 *
 * @param script - The script
 * @returns Source to compile
 */
function asyncBody(script: string): string {
  return `(async function () {\n${script}\n})`;
}

/**
 * Whether a script starts with a `"use strict"` directive (after comments,
 * whitespace or other directives; not `"use strict".length`). V8 compiles
 * it with a statement only sloppy code allows; nothing is run.
 *
 * @param script - A script that compiles as an async function body
 * @returns True for a strict script
 */
function isStrict(script: string): boolean {
  return /use strict/.test(script) && !compiles(asyncBody(script + SLOPPY_ONLY), 'sloppy code');
}

/**
 * The source sent to the page for a dom eval script. A hashbang becomes a
 * `//` comment of the same length; a strict directive is repeated before
 * the block. A script that does not compile on its own (a SyntaxError, or a
 * `}` that would close the block) is sent without the block, so it fails
 * as written; one over the compile limit is wrapped unchecked.
 *
 * @param script - The user's script
 * @returns The script in a block, named {@link EVAL_SOURCE_URL}
 */
export function wrapEvalScript(script: string): string {
  const source = script.replace(HASHBANG, '//');
  const sourceUrl = `\n//# sourceURL=${EVAL_SOURCE_URL}`;
  if (source.length > MAX_COMPILED_LENGTH) return `{\n${source}\n}${sourceUrl}`;
  if (!compiles(asyncBody(source), 'an async function body')) return `\n${source}${sourceUrl}`;
  const strict = isStrict(source) ? "'use strict';" : '';
  return `${strict}{\n${source}\n}${sourceUrl}`;
}

/**
 * A 0-based line Chrome reports for a script, as the user wrote it.
 *
 * @param url - Source URL of the script
 * @param lineNumber - 0-based line
 * @returns The line without the block's first line for a dom eval script
 */
export function evalLine(url: string, lineNumber: number): number {
  return url === EVAL_SOURCE_URL && lineNumber > 0 ? lineNumber - 1 : lineNumber;
}

/**
 * A text's dom eval stack frame positions as the user wrote the script
 * (positions in the message itself are left as written).
 *
 * @param text - Error description or stack
 * @returns Text with stack frame lines one less
 */
export function withEvalPositions(text: string): string {
  return text.replace(STACK_POSITION, (_, frame: string, line: string, column: string) => {
    return `${frame}${EVAL_SOURCE_URL}:${Math.max(1, Number(line) - 1)}:${column}`;
  });
}

/**
 * Message of a dom eval exception, at the user's positions. An exception
 * without a stack (a SyntaxError) gets its position as a stack line (its
 * 0-based line in the source is the script's 1-based line).
 *
 * @param description - Message from `describeException`
 * @param details - Exception details
 * @returns Message
 */
export function describeEvalException(
  description: string,
  details: Protocol.Runtime.ExceptionDetails
): string {
  if (/\n\s+at /.test(description) || !/^SyntaxError\b/.test(description)) {
    return withEvalPositions(description);
  }
  return `${description}\n    at ${EVAL_SOURCE_URL}:${details.lineNumber}:${details.columnNumber + 1}`;
}
