/**
 * Validation error messages
 *
 * User-facing messages for input validation failures across commands.
 */

/**
 * Generate invalid integer error message.
 *
 * @param fieldName - Name of the field being validated
 * @param value - The invalid value provided
 * @returns Formatted error message
 *
 * @example
 * ```typescript
 * throw new Error(invalidIntegerError('timeout', 'abc'));
 * // "Invalid timeout: "abc" is not a valid integer"
 * ```
 */
export function invalidIntegerError(fieldName: string, value: string): string {
  return `Invalid ${fieldName}: "${value}" is not a valid integer`;
}
