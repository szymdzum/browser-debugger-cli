/**
 * Validation layer for command options.
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/ui/errors/index.js';
import { invalidIntegerError } from '@/ui/messages/validation.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { findSimilar } from '@/utils/suggestions.js';

export interface ValidationRule<T> {
  validate: (value: unknown) => T;
  errorMessage?: (value: unknown) => string;
}

export interface IntegerRuleOptions {
  min?: number;
  max?: number;
  default?: number;
  required?: boolean;
  allowZeroForAll?: boolean;
}

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

function buildRangeSuggestion(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `Use a value between ${min} and ${max}`;
  if (min !== undefined) return `Use a value >= ${min}`;
  if (max !== undefined) return `Use a value <= ${max}`;
  return 'Provide a valid integer';
}

function throwValidationError(message: string, suggestion: string): never {
  throw new CommandError(message, { suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

function buildErrorOptions(min?: number, max?: number): { min?: number; max?: number } {
  const opts: { min?: number; max?: number } = {};
  if (min !== undefined) opts.min = min;
  if (max !== undefined) opts.max = max;
  return opts;
}

function parseInteger(value: unknown, options: IntegerRuleOptions): number {
  const { min, max, default: defaultValue, required = true, allowZeroForAll = false } = options;

  if (value === undefined || value === null) {
    if (defaultValue !== undefined) return defaultValue;
    if (!required) return 0;
    throwValidationError('Value is required', 'Provide a numeric value for this option');
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throwValidationError(`Value must be a number, got ${typeof value}`, 'Provide a numeric value');
  }

  const parsed = parseInt(String(value).trim(), 10);
  const rangeSuggestion = buildRangeSuggestion(min, max);
  const errorOptions = buildErrorOptions(min, max);

  if (isNaN(parsed)) {
    throwValidationError(
      invalidIntegerError('value', String(value), errorOptions),
      rangeSuggestion
    );
  }

  if (parsed === 0 && allowZeroForAll) return 0;

  if (min !== undefined && parsed < min) {
    throwValidationError(
      invalidIntegerError('value', String(value), errorOptions),
      rangeSuggestion
    );
  }

  if (max !== undefined && parsed > max) {
    throwValidationError(
      invalidIntegerError('value', String(value), errorOptions),
      rangeSuggestion
    );
  }

  return parsed;
}

export function positiveIntRule(options: IntegerRuleOptions = {}): ValidationRule<number> {
  return {
    validate: (value: unknown): number => parseInteger(value, options),
  };
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function normalizeResourceType(type: string): Protocol.Network.ResourceType | undefined {
  return VALID_RESOURCE_TYPES.find((valid) => valid.toLowerCase() === type.toLowerCase());
}

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

function buildTypoSuggestion(invalid: string[]): string {
  const similar = invalid.flatMap((inv) => findSimilar(inv, VALID_RESOURCE_TYPES));
  const uniqueSimilar = [...new Set(similar)];
  return uniqueSimilar.length > 0
    ? `Did you mean: ${uniqueSimilar.join(', ')}?`
    : `Valid types: ${VALID_RESOURCE_TYPES.join(', ')}`;
}

export function resourceTypeRule(): ValidationRule<Protocol.Network.ResourceType[]> {
  return {
    validate: (value: unknown): Protocol.Network.ResourceType[] => {
      if (value === undefined || value === null || value === '') return [];

      if (typeof value !== 'string') {
        throwValidationError(
          'Resource type must be a string',
          `Valid types: ${VALID_RESOURCE_TYPES.join(', ')}`
        );
      }

      const types = parseCommaSeparated(value);
      const { normalized, invalid } = validateResourceTypes(types);

      if (invalid.length > 0) {
        throwValidationError(
          `Invalid resource type(s): ${invalid.join(', ')}`,
          buildTypoSuggestion(invalid)
        );
      }

      return normalized;
    },
  };
}
