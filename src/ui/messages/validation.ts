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

/**
 * Generate invalid range error message for --last option.
 *
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Formatted error message
 *
 * @example
 * ```typescript
 * throw new Error(invalidLastRangeError(0, 10000));
 * // "--last must be between 0 and 10000"
 * ```
 */
export function invalidLastRangeError(min: number = 0, max: number = 10000): string {
  return `--last must be between ${min} and ${max}`;
}
