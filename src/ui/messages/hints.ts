/**
 * Runtime hint message generators.
 *
 * Provides formatted hint messages that guide agents toward more
 * efficient command patterns during active sessions.
 */

import type { PatternDefinition } from '@/daemon/patternDefinitions.js';
import { joinLines } from '@/ui/formatting.js';

/**
 * Generate runtime pattern hint message.
 *
 * Creates a formatted hint suggesting a more efficient command alternative.
 *
 * @param pattern - Detected pattern with alternative suggestion
 * @returns Formatted hint message
 *
 * @example
 * ```typescript
 * const hint = generatePatternHint(pattern);
 * console.error(hint);
 * ```
 */
export function generatePatternHint(pattern: PatternDefinition): string {
  return joinLines(
    '',
    `Hint: Consider using '${pattern.alternative}' instead of ${pattern.cdpMethods.join(' or ')}`,
    ''
  );
}

/**
 * Generate hint for multiple Runtime.evaluate calls.
 *
 * Specialized hint for the common pattern of multiple evaluate calls
 * that could be consolidated.
 *
 * @param count - Number of Runtime.evaluate calls detected
 * @returns Formatted hint message
 */
export function generateMultipleEvaluateHint(count: number): string {
  return joinLines(
    '',
    `Hint: Detected ${count} Runtime.evaluate calls`,
    `   Consider using 'bdg dom eval' for JavaScript execution`,
    `   Or 'bdg dom query' for DOM queries`,
    ''
  );
}
