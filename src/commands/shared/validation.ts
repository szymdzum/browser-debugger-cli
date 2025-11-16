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
