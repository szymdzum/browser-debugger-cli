/**
 * Validation error messages
 *
 * User-facing messages for input validation failures across commands.
 */

import { joinLines } from '@/ui/formatting.js';

/**
 * Options for integer validation error messages.
 */
export interface IntegerValidationOptions {
  /** Minimum allowed value */
  min?: number;
  /** Maximum allowed value */
  max?: number;
  /** Example valid value to show */
  exampleValue?: number;
}

/**
 * Generate invalid integer error message with context.
 *
 * @param fieldName - Name of the field being validated
 * @param value - The invalid value provided
 * @param options - Optional range and example information
 * @returns Formatted error message with suggestions
 *
 * @example
 * ```typescript
 * // Basic usage
 * throw new Error(invalidIntegerError('timeout', 'abc'));
 *
 * // With range
 * throw new Error(invalidIntegerError('timeout', 'abc', { min: 1, max: 3600 }));
 *
 * // With example
 * throw new Error(invalidIntegerError('port', 'xyz', { min: 1024, max: 65535, exampleValue: 9222 }));
 * ```
 */
export function invalidIntegerError(
  fieldName: string,
  value: string,
  options?: IntegerValidationOptions
): string {
  const header = `Error: Invalid ${fieldName}: "${value}" is not a valid integer`;

  let rangeInfo: string | undefined;
  if (options?.min !== undefined && options?.max !== undefined) {
    rangeInfo = `Valid range: ${options.min} to ${options.max}`;
  } else if (options?.min !== undefined) {
    rangeInfo = `Must be at least ${options.min}`;
  } else if (options?.max !== undefined) {
    rangeInfo = `Must be at most ${options.max}`;
  }

  const example = options?.exampleValue ?? options?.min ?? 30;

  return joinLines(header, rangeInfo, '', `Example: --${fieldName} ${example}`);
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
