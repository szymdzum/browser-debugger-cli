/**
 * Shared internal helpers for form-fill operations: script errors and JS
 * string escaping.
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { actionScriptFailedError, invalidSelectorError } from '@/errors/messages.js';
import type { FillResult } from '@/ipc/protocol/domTypes.js';
import { multipleMatchesWarning, valueMismatchWarning } from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Add a warning when the selector matched several elements and no index was
 * given, so the caller knows which one was used. Keeps an existing warning.
 *
 * @param result - Action result with the number of matches
 * @param index - The --index given, if any
 * @param action - What was done, e.g. "scrolled to the first"
 * @returns The result, with a warning when applicable
 */
export function withMultipleMatchesWarning<
  T extends { matchCount?: number | undefined; warning?: string | undefined },
>(result: T, index: number | undefined, action: string): T {
  const count = result.matchCount ?? 0;
  if (index !== undefined || count <= 1) return result;
  const warning = multipleMatchesWarning(count, action);
  return { ...result, warning: result.warning ? `${result.warning}; ${warning}` : warning };
}

/**
 * Put a warning first when the filled field's value is not the one given
 * (see `valueMismatch`). Keeps an existing warning after it.
 *
 * @param result - Fill result
 * @returns The result, with the warning when the value differs
 */
export function withValueMismatchWarning(result: FillResult): FillResult {
  if (!result.valueMismatch) return result;
  const warning = valueMismatchWarning(result.valueMismatch);
  return { ...result, warning: result.warning ? `${warning}; ${result.warning}` : warning };
}

/**
 * Escape a value for embedding in a single-quoted JS string.
 */
export function escapeValueForJS(value: string): string {
  return JSON.stringify(value).slice(1, -1).replace(/'/g, "\\'");
}

/**
 * An action's page script threw. The action that ran it reports what was
 * thrown; when the page replaced built-ins the script uses,
 * `onScriptTarget` makes that the error instead.
 */
export class ActionScriptError extends CommandError {
  /**
   * @param action - The action, e.g. `fill`
   * @param exception - What the script threw, in one line
   * @param selector - Selector the action was for
   */
  constructor(
    readonly action: string,
    readonly exception: string,
    selector: string
  ) {
    const err = actionScriptFailedError(action, exception, selector);
    super(err.message, { suggestion: err.suggestion }, EXIT_CODES.SOFTWARE_ERROR);
  }
}

/**
 * What a page script threw, in one line (`TypeError: Cannot read …` rather
 * than CDP's bare "Uncaught").
 *
 * @param details - Exception details from Runtime.evaluate
 * @returns First line of the exception's description
 */
export function exceptionSummary(details: Protocol.Runtime.ExceptionDetails): string {
  const description = details.exception?.description ?? details.text;
  return description.split('\n')[0] ?? description;
}

/**
 * Throw a user error when a page script failed because the CSS selector is
 * invalid (the browser's `querySelectorAll` rejected it), instead of reporting
 * a script failure.
 *
 * @param details - Exception details from Runtime.evaluate
 * @param selector - Selector the user gave
 * @throws CommandError (81) for an invalid selector
 */
export function throwIfInvalidSelector(
  details: Protocol.Runtime.ExceptionDetails,
  selector: string
): void {
  const description = details.exception?.description ?? details.text;
  if (!/Failed to execute '\w+' on '\w+': .* is not a valid selector/.test(description)) return;
  const err = invalidSelectorError(selector);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}
