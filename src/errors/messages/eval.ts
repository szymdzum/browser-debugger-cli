/**
 * Eval and script error messages.
 */

import { EVAL_FULL_MAX_BYTES } from '@/constants.js';
import { formatMiB } from '@/ui/formatting.js';
import { frameUrlLabel } from '@/ui/messages/commands.js';
import { detectScriptQuoteDamage } from '@/utils/shellDetection.js';

import { type ErrorWithSuggestion } from './shared.js';

/**
 * A `bdg eval` script ran too long and was terminated.
 *
 * @param timeoutMs - Time limit in ms
 * @returns Error with suggestion
 */
export function scriptTimeoutError(timeoutMs: number): ErrorWithSuggestion {
  return {
    message: `Script did not finish within ${Math.round(timeoutMs / 1000)}s and was terminated`,
    suggestion: 'Check for endless loops or long-running work; the page is usable again',
  };
}

/**
 * The page (or an iframe) was kept busy by a script (e.g. a loop started
 * from a timer) and bdg terminated it.
 *
 * @param timeoutMs - Time waited
 * @param scope - What was busy: the page, or the iframe a command ran in
 */
export function pageBusyError(
  timeoutMs: number,
  scope: 'page' | 'frame' = 'page',
  recovered = true
): ErrorWithSuggestion {
  const busy = `The ${scope} was busy for ${Math.round(timeoutMs / 1000)}s (a script kept it running)`;
  if (!recovered) {
    return {
      message: `${busy} and its scripts could not be stopped`,
      suggestion: 'Retry in a moment; if it stays busy, reload the page: bdg page reload',
    };
  }
  return {
    message: `${busy}, so its scripts were terminated`,
    suggestion: `The ${scope} is usable again; re-run the command`,
  };
}

/**
 * The page did not answer because a navigation is still waiting for the
 * server (Chrome holds commands for the page until the new document arrives).
 *
 * @param url - URL being loaded
 */
export function navigationPendingError(url: string): ErrorWithSuggestion {
  return {
    message: `The page is not answering: it is still waiting for the server to respond to ${url}`,
    suggestion: 'Wait for the page to load, or load another one: bdg page navigate <url>',
  };
}

/**
 * `eval` given an empty script (often a shell variable that was not set).
 */
export function emptyScriptError(): ErrorWithSuggestion {
  return {
    message: 'The script is empty',
    suggestion: `Pass an expression, e.g. bdg eval 'document.title'`,
  };
}

/**
 * A promise returned by `eval` that did not settle in time.
 *
 * @param timeoutMs - Time waited
 * @param resultMayBeUnsent - The script may have finished, its result too large to send
 */
export function promiseTimeoutError(
  timeoutMs: number,
  resultMayBeUnsent = false
): ErrorWithSuggestion {
  const unsent = resultMayBeUnsent
    ? '; if the script finished, its result may be too large to send (about 256 MiB): return a slice or the .length'
    : '';
  return {
    message: `The awaited promise did not settle within ${Math.round(timeoutMs / 1000)}s`,
    suggestion: `Nothing was busy; check that the promise resolves or rejects, or race it with a timeout in the script${unsent}`,
  };
}

/**
 * A `eval` result Chrome could not send (about 256 MiB and more).
 *
 * @returns Error naming the likely cause and a way to read the data that works
 */
export function resultNotSentError(): ErrorWithSuggestion {
  return {
    message:
      'The script ran, but Chrome could not send its result: it is probably too large to send',
    suggestion: `Return a slice or the .length instead. To read all of it, keep it in the page (bdg eval '(window.data = <expression>, window.data.length)') and read parts of under ${formatMiB(EVAL_FULL_MAX_BYTES, 0)} with --full: a string as bdg eval 'window.data.slice(0, 10000000)' (10 million characters; fewer for multibyte text), a Map by its keys first (bdg eval '[...window.data.keys()]'), then one value as bdg eval 'window.data.get(KEY).slice(0, 10000000)' (until the page navigates)`,
  };
}

/** How to get a smaller `eval` result */
const SMALLER_RESULT_SUGGESTION =
  'Return a smaller part of the value (a slice of a string or array, a few keys of an object) or a count (.length)';

/** The same, for a result that did arrive: without `--full` it is cut to its first characters */
const TOO_LARGE_SUGGESTION = `${SMALLER_RESULT_SUGGESTION}, or drop --full to get the first 20000 characters`;

/**
 * `eval --full` given a result over its size cap.
 *
 * @param size - Size of the result in bytes, or counted so far; Infinity when it was too large to measure (JSON text past V8's string limit)
 * @param cap - The cap, in the same unit
 * @param exact - Whether the result arrived whole (`size` is its size), so dropping `--full` prints its start; false when the count only says the page stopped copying at the cap
 * @returns Error naming the size and the cap, and how to get a smaller result
 */
export function evalResultTooLargeError(
  size: number,
  cap: number,
  exact: boolean
): ErrorWithSuggestion {
  const limit = formatMiB(cap, 0);
  const suggestion = exact ? TOO_LARGE_SUGGESTION : SMALLER_RESULT_SUGGESTION;
  if (!Number.isFinite(size)) {
    return {
      message: `The result is too large to measure (over 512 MiB), over the ${limit} limit of eval --full`,
      suggestion,
    };
  }
  const shown = formatMiB(size) === formatMiB(cap) ? `${size} bytes` : formatMiB(size);
  return {
    message: exact
      ? `The result is ${shown}, over the ${limit} limit of eval --full`
      : `The result is over the ${limit} limit of eval --full (copying stopped at ${shown})`,
    suggestion,
  };
}

/**
 * `eval --full` whose result Chrome could not send, so it is over the cap.
 *
 * @param cap - The cap, in bytes
 * @returns Error naming the cap and how to get a smaller result
 */
export function evalResultUnsentFullError(cap: number): ErrorWithSuggestion {
  return {
    message: `The result is over the ${formatMiB(cap, 0)} limit of eval --full (Chrome could not send it)`,
    suggestion: SMALLER_RESULT_SUGGESTION,
  };
}

/**
 * `eval` (without `--full`) given a result Chrome cannot send.
 *
 * @param counted - Size counted on the page when it stopped, in bytes
 * @param cap - The most Chrome sends, in bytes
 * @returns Error naming the limit and how to get a smaller result
 */
export function evalResultNotSendableError(counted: number, cap: number): ErrorWithSuggestion {
  const shown = formatMiB(counted) === formatMiB(cap) ? `${counted} bytes` : formatMiB(counted);
  return {
    message: `The result is too large to send: over ${formatMiB(cap, 0)} (counted ${shown} when it stopped)`,
    suggestion: SMALLER_RESULT_SUGGESTION,
  };
}

/**
 * The iframe a `eval --frame` script ran in navigated before it finished.
 *
 * @param url - Frame URL when the script started
 */
export function frameNavigatedDuringEvalError(url: string): ErrorWithSuggestion {
  return {
    message: `The frame navigated while the script ran: ${frameUrlLabel(url)}`,
    suggestion:
      'The result was lost with the old document; re-run the script once the frame has loaded. List frames: bdg dom frames',
  };
}

/**
 * The iframe a `eval --frame` script ran in was removed (or vanished
 * before it started).
 *
 * @param url - Frame URL when the script started
 */
export function frameRemovedDuringEvalError(url: string): ErrorWithSuggestion {
  return {
    message: `The frame was removed before the script finished: ${frameUrlLabel(url)}`,
    suggestion: 'The frame no longer exists; re-run bdg dom frames to see the current ones',
  };
}

/**
 * The page (its tab) was closed while a `eval` script ran.
 */
export function pageClosedDuringEvalError(): ErrorWithSuggestion {
  return {
    message: 'The page was closed while the script ran',
    suggestion: 'Its tab is gone; start a new session with: bdg <url>',
  };
}

/**
 * The iframe a `eval --frame` script ran in went away, and bdg could not
 * tell whether it navigated or was removed.
 *
 * @param url - Frame URL when the script started
 */
export function frameLostDuringEvalError(url: string): ErrorWithSuggestion {
  return {
    message: `The frame navigated or was removed while the script ran: ${frameUrlLabel(url)}`,
    suggestion: 'Re-run bdg dom frames to see the current frames, then the script',
  };
}

/**
 * The page navigated while a `eval` script ran (e.g. it set
 * `location.href` and then awaited).
 */
export function pageNavigatedDuringEvalError(): ErrorWithSuggestion {
  return {
    message: 'The page navigated while the script ran',
    suggestion:
      'The result was lost with the old document; re-run the script on the new page (navigate with: bdg page navigate <url>)',
  };
}

/** `Identifier 'x' has already been declared` */
const REDECLARED_PATTERN = /^SyntaxError: Identifier '([\w$]+)' has already been declared/;

/**
 * Tip for a name declared twice: `eval` runs a script in a block, so
 * only the script itself, or a `var`/function of it meeting the page's own
 * top-level `let`/`const`/`class`, can declare a name again.
 *
 * @param name - The redeclared identifier
 * @returns Tip
 */
function redeclarationTip(name: string): string {
  return `'${name}' is already declared in this script (or, for a var or function, by the page's top-level let, const or class). Rename it.`;
}

/**
 * Script execution error with shell quote detection.
 *
 * Shows the script as received to help diagnose shell quote stripping issues.
 * Detects common patterns like `querySelector(input)` that indicate shell damage.
 *
 * @param errorMessage - The JavaScript error message
 * @param receivedScript - The script as received by the command (optional for backwards compat)
 * @returns Error with context-aware suggestions
 */
export function scriptExecutionError(
  errorMessage: string,
  receivedScript?: string
): ErrorWithSuggestion {
  if (!receivedScript) {
    return {
      message: errorMessage,
      suggestion: 'Check JavaScript syntax and ensure the expression is valid',
    };
  }

  const quoteCheck = detectScriptQuoteDamage(receivedScript, errorMessage);
  const redeclared = REDECLARED_PATTERN.exec(errorMessage)?.[1];
  const truncatedScript =
    receivedScript.length > 100 ? receivedScript.slice(0, 100) + '...' : receivedScript;

  const lines: string[] = [];
  lines.push(`Script received: ${truncatedScript}`);

  if (quoteCheck.damaged) {
    lines.push('');
    lines.push('Shell quote damage detected:');
    if (quoteCheck.details) {
      lines.push(`  ${quoteCheck.details}`);
    }
    if (quoteCheck.suggestion) {
      lines.push('');
      lines.push(quoteCheck.suggestion);
    }
  } else if (redeclared) {
    lines.push('');
    lines.push(redeclarationTip(redeclared));
  } else if (/^SyntaxError\b/.test(errorMessage)) {
    lines.push('');
    lines.push('Tips:');
    lines.push("  - Use single quotes around script: bdg eval '...'");
    lines.push('  - For complex scripts, read them from a file: bdg eval "$(cat script.js)"');
    lines.push('  - Escape inner quotes: \\" or use opposite quote style');
  }

  return {
    message: errorMessage,
    suggestion: lines.join('\n'),
  };
}

/**
 * Unexpected CDP response format.
 */
export function unexpectedResponseFormatError(context: string): ErrorWithSuggestion {
  return {
    message: 'Unexpected response format',
    suggestion: `CDP response missing result.value or invalid ${context} structure`,
  };
}

/**
 * Generic operation failure with dynamic error message.
 */
export function operationFailedError(operation: string, errorMessage: string): ErrorWithSuggestion {
  return {
    message: `Failed to ${operation}`,
    suggestion: errorMessage,
  };
}
