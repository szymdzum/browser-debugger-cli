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
