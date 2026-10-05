/**
 * Shared internal helpers for form-fill operations: script-error formatting
 * and JS string escaping.
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { invalidSelectorError } from '@/errors/messages.js';
import type { FillResult } from '@/ipc/protocol/domTypes.js';
import { multipleMatchesWarning, valueMismatchWarning } from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { detectSelectorQuoteDamage } from '@/utils/shellDetection.js';

/**
 * Escape a CSS selector for embedding in a single-quoted JS string.
 */
export function escapeSelectorForJS(selector: string): string {
  return JSON.stringify(selector).slice(1, -1).replace(/'/g, "\\'");
}

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
  const { expected, actual } = result.valueMismatch;
  const warning = valueMismatchWarning(expected, actual);
  return { ...result, warning: result.warning ? `${warning}; ${result.warning}` : warning };
}

/**
 * Escape a value for embedding in a single-quoted JS string.
 */
export function escapeValueForJS(value: string): string {
  return JSON.stringify(value).slice(1, -1).replace(/'/g, "\\'");
}

/**
 * Format a CDP exception into a user-friendly error with troubleshooting
 * hints. Detects shell-quote-damaged selectors and recommends the
 * query-then-act pattern.
 */
export function formatScriptExecutionError(
  exceptionDetails: Protocol.Runtime.ExceptionDetails,
  selector: string,
  operationType: 'fill' | 'click' = 'fill',
  expression?: string
): string {
  const errorText = exceptionDetails.text || 'Unknown error';
  const location =
    exceptionDetails.lineNumber !== undefined && exceptionDetails.columnNumber !== undefined
      ? ` at line ${exceptionDetails.lineNumber + 1}, column ${exceptionDetails.columnNumber + 1}`
      : '';

  const lines: string[] = [];
  lines.push(`Script execution failed: ${errorText}${location}`);

  if (expression) {
    const truncated = expression.length > 150 ? expression.slice(0, 150) + '...' : expression;
    lines.push('');
    lines.push(`Expression received: ${truncated}`);

    const selectorCheck = detectSelectorQuoteDamage(selector);
    if (selectorCheck.damaged) {
      lines.push('');
      lines.push('Shell quote damage detected in selector:');
      if (selectorCheck.details) {
        lines.push(`  ${selectorCheck.details}`);
      }
      lines.push('');
      lines.push('Try using the two-step pattern:');
      lines.push(`  1. bdg dom query '${selector}'`);
      lines.push(`  2. bdg dom ${operationType} 0${operationType === 'fill' ? ' "value"' : ''}`);
      return lines.join('\n');
    }
  }

  const troubleshootingSteps =
    operationType === 'fill'
      ? [
          `1. Verify element exists: bdg dom query "${selector}"`,
          '2. Check element is visible and not disabled',
          `3. Try direct eval: bdg dom eval "document.querySelector('${escapeSelectorForJS(selector)}').value = 'your-value'"`,
        ]
      : [
          `1. Verify element exists: bdg dom query "${selector}"`,
          '2. Check element is visible and clickable',
          `3. Try direct eval: bdg dom eval "document.querySelector('${escapeSelectorForJS(selector)}').click()"`,
        ];

  lines.push('');
  lines.push('Troubleshooting:');
  lines.push(`  ${troubleshootingSteps.join('\n  ')}`);

  return lines.join('\n');
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
