/**
 * Shared internal helpers for form-fill operations: script-error formatting
 * and JS string escaping.
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import { detectSelectorQuoteDamage } from '@/utils/shellDetection.js';

/**
 * Escape a CSS selector for embedding in a single-quoted JS string.
 */
export function escapeSelectorForJS(selector: string): string {
  return JSON.stringify(selector).slice(1, -1).replace(/'/g, "\\'");
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
