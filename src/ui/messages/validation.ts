/**
 * Validation error messages
 *
 * User-facing messages for input validation failures across commands.
 */

import { joinLines } from '@/ui/formatting.js';

/**
 * Allowed range for an integer option.
 */
export interface IntegerValidationOptions {
  /** Minimum allowed value */
  min?: number;
  /** Maximum allowed value */
  max?: number;
}

/**
 * Describe an integer range for error messages.
 *
 * @param options - Range bounds
 * @returns e.g. "Valid range: 1 to 65535", or undefined without bounds
 */
function describeRange(options?: IntegerValidationOptions): string | undefined {
  if (options?.min !== undefined && options.max !== undefined) {
    return `Valid range: ${options.min} to ${options.max}`;
  }
  if (options?.min !== undefined) return `Must be at least ${options.min}`;
  if (options?.max !== undefined) return `Must be at most ${options.max}`;
  return undefined;
}

/**
 * Generate error message for a value that is not an integer.
 *
 * @param value - The invalid value provided
 * @param options - Allowed range, shown when known
 * @param name - Option name, e.g. "--port" (defaults to "value")
 * @returns Formatted error message
 *
 * @example
 * ```typescript
 * invalidIntegerError('abc', { min: 1, max: 3600 });
 * // 'Invalid value: "abc" is not an integer\nValid range: 1 to 3600'
 * invalidIntegerError('abc', { min: 1, max: 65535 }, '--port');
 * // 'Invalid --port: "abc" is not an integer\nValid range: 1 to 65535'
 * ```
 */
export function invalidIntegerError(
  value: string,
  options?: IntegerValidationOptions,
  name = 'value'
): string {
  return joinLines(`Invalid ${name}: "${value}" is not an integer`, describeRange(options));
}

/**
 * Generate error message for an integer outside the allowed range.
 *
 * @param value - The out-of-range value provided
 * @param options - Allowed range
 * @param name - Option name, e.g. "--port" (defaults to "value")
 * @returns Formatted error message
 */
export function integerOutOfRangeError(
  value: string,
  options: IntegerValidationOptions,
  name = 'value'
): string {
  return joinLines(`Invalid ${name}: ${value} is out of range`, describeRange(options));
}
