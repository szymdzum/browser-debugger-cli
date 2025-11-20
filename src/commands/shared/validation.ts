/**
 * Validation layer for command options.
 *
 * Provides centralized validation with type safety and consistent error messages.
 * Eliminates scattered validation logic across commands.
 */

import type { Protocol } from '@/connection/typed-cdp.js';
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
  /** Allow 0 to represent "all items" or unlimited */
  allowZeroForAll?: boolean;
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
  const { min, max, default: defaultValue, required = true, allowZeroForAll = false } = options;

  return {
    validate: (value: unknown): number => {
      if (value === undefined || value === null) {
        if (defaultValue !== undefined) {
          return defaultValue;
        }
        if (!required) {
          return 0;
        }
        throw new CommandError('Value is required', {}, EXIT_CODES.INVALID_ARGUMENTS);
      }

      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new CommandError(
          `Value must be a number, got ${typeof value}`,
          {},
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }

      const strValue = String(value).trim();
      const parsed = parseInt(strValue, 10);

      const errorOptions: { min?: number; max?: number } = {};
      if (min !== undefined) errorOptions.min = min;
      if (max !== undefined) errorOptions.max = max;

      if (isNaN(parsed)) {
        const message = invalidIntegerError('value', strValue, errorOptions);
        throw new CommandError(message, {}, EXIT_CODES.INVALID_ARGUMENTS);
      }

      if (parsed === 0 && allowZeroForAll) {
        return 0;
      }

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
 * Valid CDP ResourceType values for filtering.
 * Matches Protocol.Network.ResourceType enum.
 */
const VALID_RESOURCE_TYPES = [
  'Document',
  'Stylesheet',
  'Image',
  'Media',
  'Font',
  'Script',
  'TextTrack',
  'XHR',
  'Fetch',
  'Prefetch',
  'EventSource',
  'WebSocket',
  'Manifest',
  'SignedExchange',
  'Ping',
  'CSPViolationReport',
  'Preflight',
  'FedCM',
  'Other',
] as const;

/**
 * Parse comma-separated string into trimmed, non-empty tokens.
 *
 * @param value - Comma-separated string
 * @returns Array of trimmed, non-empty tokens
 */
function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Normalize resource type string to CDP format (case-insensitive lookup).
 *
 * @param type - User input (e.g., "document", "xhr")
 * @returns Normalized CDP type or undefined if invalid
 */
function normalizeResourceType(type: string): Protocol.Network.ResourceType | undefined {
  const found = VALID_RESOURCE_TYPES.find((valid) => valid.toLowerCase() === type.toLowerCase());
  return found;
}

/**
 * Validate and normalize array of resource type strings.
 *
 * @param types - Array of type strings to validate
 * @returns Object with normalized types and invalid entries
 */
function validateResourceTypes(types: string[]): {
  normalized: Protocol.Network.ResourceType[];
  invalid: string[];
} {
  const normalized: Protocol.Network.ResourceType[] = [];
  const invalid: string[] = [];

  for (const type of types) {
    const normalizedType = normalizeResourceType(type);
    if (normalizedType) {
      normalized.push(normalizedType);
    } else {
      invalid.push(type);
    }
  }

  return { normalized, invalid };
}

/**
 * Create a resource type validation rule for comma-separated type filters.
 * Performs case-insensitive matching and normalization.
 *
 * @returns Validation rule that parses and validates resource types
 *
 * @example
 * ```typescript
 * const rules = {
 *   type: resourceTypeRule(),
 * };
 * const validated = validateOptions(options, rules);
 * // Input: "document,xhr" → Output: ["Document", "XHR"]
 * ```
 */
export function resourceTypeRule(): ValidationRule<Protocol.Network.ResourceType[]> {
  return {
    validate: (value: unknown): Protocol.Network.ResourceType[] => {
      // Handle empty input
      if (value === undefined || value === null || value === '') {
        return [];
      }

      // Type guard
      if (typeof value !== 'string') {
        throw new CommandError('Resource type must be a string', {}, EXIT_CODES.INVALID_ARGUMENTS);
      }

      // Parse and validate
      const types = parseCommaSeparated(value);
      const { normalized, invalid } = validateResourceTypes(types);

      // Report errors if any invalid types
      if (invalid.length > 0) {
        const validList = VALID_RESOURCE_TYPES.join(', ');
        throw new CommandError(
          `Invalid resource type(s): ${invalid.join(', ')}`,
          { suggestion: `Valid types: ${validList}` },
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }

      return normalized;
    },
  };
}
