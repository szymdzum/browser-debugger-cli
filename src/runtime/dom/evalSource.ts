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
 * script's, which {@link evalLine} and {@link withEvalPositions} take back.
 */

import type { Protocol } from '@/connection/typed-cdp.js';

/** Source URL of `bdg dom eval` scripts */
export const EVAL_SOURCE_URL = 'bdg-eval';

/** A stack frame position in a dom eval script (`bdg-eval:2:7`) */
const STACK_POSITION = new RegExp(`\\b${EVAL_SOURCE_URL}:(\\d+):(\\d+)\\b`, 'g');

/** A `"use strict"` directive at the start of a script */
const STRICT_DIRECTIVE = /^\s*(['"])use strict\1/;

/**
 * The source sent to the page for a dom eval script.
 *
 * @param script - The user's script
 * @returns The script in a block, named {@link EVAL_SOURCE_URL}
 */
export function wrapEvalScript(script: string): string {
  const strict = STRICT_DIRECTIVE.test(script) ? "'use strict';" : '';
  return `${strict}{\n${script}\n}\n//# sourceURL=${EVAL_SOURCE_URL}`;
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
 * A text's dom eval stack positions as the user wrote the script.
 *
 * @param text - Error description or stack
 * @returns Text with lines one less
 */
function withEvalPositions(text: string): string {
  return text.replace(STACK_POSITION, (_, line: string, column: string) => {
    return `${EVAL_SOURCE_URL}:${Math.max(1, Number(line) - 1)}:${column}`;
  });
}

/**
 * Message of a dom eval exception, at the user's positions. An exception
 * without a stack (a SyntaxError) gets its position as a stack line.
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
  const line = evalLine(EVAL_SOURCE_URL, details.lineNumber);
  return `${description}\n    at ${EVAL_SOURCE_URL}:${line + 1}:${details.columnNumber + 1}`;
}
