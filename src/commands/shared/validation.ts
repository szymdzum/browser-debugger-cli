/**
 * Validation layer for command options.
 *
 * Provides centralized validation with type safety and consistent error messages.
 * Eliminates scattered validation logic across commands.
 */

import { CommandError } from '@/ui/errors/index.js';
import { invalidIntegerError } from '@/ui/messages/validation.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Base validation rule interface
 */
export interface ValidationRule<T> {
  /** Validate and transform the value */
  validate: (value: unknown) => T;
  /** Optional custom error message */
  errorMessage?: (value: unknown) => string;
}

/**
 * Validation options for integer rules
 */
export interface IntegerRuleOptions {
  /** Minimum allowed value */
  min?: number;
  /** Maximum allowed value */
  max?: number;
  /** Default value if not provided */
  default?: number;
  /** Whether the field is required */
  required?: boolean;
}

/**
 * Create a positive integer validation rule
 *
 * @param options - Validation constraints
 * @returns Validation rule that parses and validates integers
 *
 * @example
 * ```typescript
 * const rules = {
 *   last: positiveIntRule({ min: 1, max: 1000, default: 10 }),
 *   timeout: positiveIntRule({ min: 1, max: 3600, required: false }),
 * };
 * ```
 */
export function positiveIntRule(options: IntegerRuleOptions = {}): ValidationRule<number> {
  const { min, max, default: defaultValue, required = true } = options;

  return {
    validate: (value: unknown): number => {
      // Handle undefined with default or required check
      if (value === undefined || value === null) {
        if (defaultValue !== undefined) {
          return defaultValue;
        }
        if (!required) {
          return 0; // Return 0 for optional fields (caller should check)
        }
        throw new CommandError('Value is required', {}, EXIT_CODES.INVALID_ARGUMENTS);
      }

      // Parse string to number - only accept strings and numbers
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new CommandError(
          `Value must be a number, got ${typeof value}`,
          {},
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }

      const strValue = String(value).trim();
      const parsed = parseInt(strValue, 10);

      // Build error options conditionally to satisfy exactOptionalPropertyTypes
      const errorOptions: { min?: number; max?: number } = {};
      if (min !== undefined) errorOptions.min = min;
      if (max !== undefined) errorOptions.max = max;

      // Validate it's a number
      if (isNaN(parsed)) {
        const message = invalidIntegerError('value', strValue, errorOptions);
        throw new CommandError(message, {}, EXIT_CODES.INVALID_ARGUMENTS);
      }

      // Validate range
      if (min !== undefined && parsed < min) {
        const message = invalidIntegerError('value', strValue, errorOptions);
        throw new CommandError(message, {}, EXIT_CODES.INVALID_ARGUMENTS);
      }

      if (max !== undefined && parsed > max) {
        const message = invalidIntegerError('value', strValue, errorOptions);
        throw new CommandError(message, {}, EXIT_CODES.INVALID_ARGUMENTS);
      }

      return parsed;
    },
  };
}

/**
 * Create a non-empty string validation rule
 *
 * @param fieldName - Name of field for error messages
 * @returns Validation rule that ensures strings are non-empty
 *
 * @example
 * ```typescript
 * const rules = {
 *   selector: nonEmptyStringRule('selector'),
 *   url: nonEmptyStringRule('url'),
 * };
 * ```
 */
export function nonEmptyStringRule(fieldName: string): ValidationRule<string> {
  return {
    validate: (value: unknown): string => {
      if (value === undefined || value === null) {
        throw new CommandError(
          `${fieldName} is required`,
          { suggestion: `Provide a valid ${fieldName}` },
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }

      // Only accept string values
      if (typeof value !== 'string') {
        throw new CommandError(
          `${fieldName} must be a string, got ${typeof value}`,
          {},
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }

      const str = value.trim();
      if (str.length === 0) {
        throw new CommandError(
          `${fieldName} cannot be empty`,
          { suggestion: `Provide a valid ${fieldName}` },
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }

      return str;
    },
  };
}

/**
 * Create an optional integer validation rule
 *
 * @param options - Validation constraints
 * @returns Validation rule that parses integers or returns undefined
 *
 * @example
 * ```typescript
 * const rules = {
 *   timeout: optionalIntRule({ min: 1, max: 3600 }),
 *   maxSize: optionalIntRule({ min: 1, max: 100 }),
 * };
 * ```
 */
export function optionalIntRule(
  options: Omit<IntegerRuleOptions, 'required'>
): ValidationRule<number | undefined> {
  const rule = positiveIntRule({ ...options, required: false });

  return {
    validate: (value: unknown): number | undefined => {
      if (value === undefined || value === null) {
        return undefined;
      }
      return rule.validate(value);
    },
  };
}

/**
 * Validate options object using a set of rules
 *
 * @param options - Raw options object to validate
 * @param rules - Validation rules for each field
 * @returns Validated and type-safe options object
 * @throws CommandError if any validation fails
 *
 * @example
 * ```typescript
 * const validated = validateOptions(options, {
 *   last: positiveIntRule({ min: 1, max: 1000, default: 10 }),
 *   selector: nonEmptyStringRule('selector'),
 *   timeout: optionalIntRule({ min: 1, max: 3600 }),
 * });
 * // validated.last is number
 * // validated.selector is string
 * // validated.timeout is number | undefined
 * ```
 */
export function validateOptions<T extends Record<string, unknown>>(
  options: Record<string, unknown>,
  rules: { [K in keyof T]: ValidationRule<T[K]> }
): T {
  const validated = {} as T;

  for (const key of Object.keys(rules) as Array<keyof T>) {
    const rule = rules[key];
    const value = options[key as string];
    validated[key] = rule.validate(value);
  }

  return validated;
}
