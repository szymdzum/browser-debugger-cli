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

function formatRange(options?: IntegerValidationOptions): string | undefined {
  if (options?.min !== undefined && options?.max !== undefined) {
    return `Valid range: ${options.min} to ${options.max}`;
  }
  if (options?.min !== undefined) return `Must be at least ${options.min}`;
  if (options?.max !== undefined) return `Must be at most ${options.max}`;
  return undefined;
}

function formatExample(fieldName: string, options?: IntegerValidationOptions): string {
  const example = options?.exampleValue ?? options?.min ?? 30;
  return `Example: --${fieldName} ${example}`;
}

/**
 * Generate "not a valid integer" error message (for non-numeric input).
 *
 * Use for values that failed to parse as integers (e.g., "abc").
 * Use {@link outOfRangeError} for values that parsed but violated min/max.
 */
export function invalidIntegerError(
  fieldName: string,
  value: string,
  options?: IntegerValidationOptions
): string {
  return joinLines(
    `Invalid --${fieldName}: "${value}" is not a valid integer`,
    formatRange(options),
    '',
    formatExample(fieldName, options)
  );
}

/**
 * Generate "out of range" error message (for integers that violate min/max).
 *
 * Use when the value parsed as an integer but fell outside the permitted range.
 * The message must NOT claim the value isn't an integer — it is.
 */
export function outOfRangeError(
  fieldName: string,
  value: string,
  options?: IntegerValidationOptions
): string {
  return joinLines(
    `--${fieldName} out of range: ${value}`,
    formatRange(options),
    '',
    formatExample(fieldName, options)
  );
}
