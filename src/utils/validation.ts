import { invalidIntegerError } from '@/ui/messages/validation.js';

/**
 * Build range options object for error messages.
 *
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Range options object or undefined if no range constraints
 */
function buildRangeOptions(
  min: number | undefined,
  max: number | undefined
): { min: number; max: number } | undefined {
  return min !== undefined && max !== undefined ? { min, max } : undefined;
}

/**
 * Parse and validate an integer option with range constraints.
 *
 * @param name - The option name for error messages
 * @param value - The string value to parse (or undefined)
 * @param options - Validation configuration
 * @returns Parsed integer value or undefined if not required and not provided
 * @throws Error if validation fails
 *
 * @example
 * ```typescript
 * // Required with default
 * const lastN = parseIntOption('last', options.last, {
 *   defaultValue: 10,
 *   min: 1,
 *   max: 1000
 * });
 *
 * // Optional
 * const timeout = parseIntOption('timeout', options.timeout, {
 *   required: false,
 *   min: 1,
 *   max: 3600
 * });
 * ```
 */
export function parseIntOption(
  name: string,
  value: string | undefined,
  options: {
    required?: boolean;
    defaultValue?: number;
    min?: number;
    max?: number;
    errorFormatter?: (value: string | undefined) => string;
  } = {}
): number | undefined {
  const { required = true, defaultValue, min, max, errorFormatter } = options;

  const strValue = value ?? (defaultValue !== undefined ? defaultValue.toString() : undefined);

  if (strValue === undefined) {
    if (required) {
      throw new Error(`Option --${name} is required`);
    }
    return undefined;
  }

  const trimmed = strValue.trim();
  const parsed = parseInt(trimmed, 10);

  if (isNaN(parsed)) {
    const errorMessage =
      errorFormatter?.(value) ?? invalidIntegerError(name, trimmed, buildRangeOptions(min, max));
    throw new Error(errorMessage);
  }

  if ((min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
    const errorMessage =
      errorFormatter?.(value) ?? invalidIntegerError(name, trimmed, buildRangeOptions(min, max));
    throw new Error(errorMessage);
  }

  return parsed;
}

/**
 * Parse and validate a positive integer option with range constraints.
 *
 * @param name - The option name for error messages
 * @param value - The string value to parse (or undefined)
 * @param options - Validation configuration
 * @returns Parsed integer value
 * @throws Error if validation fails
 *
 * @example
 * ```typescript
 * const lastN = parsePositiveIntOption('last', options.last, {
 *   defaultValue: 10,
 *   min: 1,
 *   max: 1000
 * });
 * ```
 */
export function parsePositiveIntOption(
  name: string,
  value: string | undefined,
  options: {
    defaultValue?: number;
    min?: number;
    max?: number;
    errorFormatter?: (value: string | undefined) => string;
  } = {}
): number {
  const result = parseIntOption(name, value, { ...options, required: true });
  // With required: true, parseIntOption will either return a number or throw.
  // This extra check keeps TypeScript and lint rules satisfied without
  // relying on a non-null assertion.
  if (result === undefined) {
    throw new Error(`Option --${name} is required`);
  }
  return result;
}

/**
 * Parse an optional integer option (returns undefined if not provided).
 *
 * @param name - The option name for error messages
 * @param value - The string value to parse (or undefined)
 * @param options - Validation configuration
 * @returns Parsed integer or undefined
 * @throws Error if value is provided but invalid
 *
 * @example
 * ```typescript
 * const timeout = parseOptionalIntOption('timeout', options.timeout, {
 *   min: 1,
 *   max: 3600
 * });
 * ```
 */
export function parseOptionalIntOption(
  name: string,
  value: string | undefined,
  options: {
    min?: number;
    max?: number;
  } = {}
): number | undefined {
  return parseIntOption(name, value, { ...options, required: false });
}
