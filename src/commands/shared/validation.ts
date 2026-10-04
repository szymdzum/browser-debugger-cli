/**
 * Validation layer for command options.
 */

import { InvalidArgumentError } from 'commander';

import type { Protocol } from '@/connection/typed-cdp.js';
import { resourceTypeFromName } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
import type { ConsoleLevel } from '@/types.js';
import { integerOutOfRangeError, invalidIntegerError } from '@/ui/messages/validation.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { findSimilar } from '@/utils/suggestions.js';

export interface ValidationRule<T> {
  validate: (value: unknown) => T;
  errorMessage?: (value: unknown) => string;
}

export interface IntegerRuleOptions {
  /** Option name shown in error messages (e.g. "--port") */
  name?: string;
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

function parseInteger(value: unknown, options: IntegerRuleOptions): number {
  const {
    name,
    min,
    max,
    default: defaultValue,
    required = true,
    allowZeroForAll = false,
  } = options;

  if (value === undefined || value === null) {
    if (defaultValue !== undefined) return defaultValue;
    if (!required) return 0;
    throwValidationError('Value is required', 'Provide a numeric value for this option');
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throwValidationError(`Value must be a number, got ${typeof value}`, 'Provide a numeric value');
  }

  const text = String(value).trim();
  const rangeSuggestion = allowZeroForAll
    ? `Use 0 for all, or a value between ${min ?? 1} and ${max ?? 'any'}`
    : buildRangeSuggestion(min, max);

  if (!/^[+-]?\d+$/.test(text)) {
    throwValidationError(invalidIntegerError(text, {}, name), rangeSuggestion);
  }

  const parsed = Number(text);
  if (parsed === 0 && allowZeroForAll) return 0;

  if ((min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
    throwValidationError(integerOutOfRangeError(text, {}, name), rangeSuggestion);
  }

  return parsed;
}

export function positiveIntRule(options: IntegerRuleOptions = {}): ValidationRule<number> {
  return {
    validate: (value: unknown): number => parseInteger(value, options),
  };
}

/**
 * Build a Commander option parser for strict integers.
 *
 * Replaces bare `parseInt` (which yields NaN for "abc", accepts "5px", and
 * receives the previous value as radix). Invalid input becomes a Commander
 * usage error, reported with exit code 81.
 *
 * @param min - Inclusive lower bound
 * @param max - Inclusive upper bound
 * @returns Parser for `.option(flags, description, parser)`
 */
export function integerOption(min?: number, max?: number): (value: string) => number {
  return (value: string): number => {
    const text = value.trim();
    const parsed = Number(text);
    const outOfRange = (min !== undefined && parsed < min) || (max !== undefined && parsed > max);
    if (!/^[+-]?\d+$/.test(text)) {
      throw new InvalidArgumentError(`Expected an integer. ${buildRangeSuggestion(min, max)}`);
    }
    if (outOfRange) {
      throw new InvalidArgumentError(`${text} is out of range. ${buildRangeSuggestion(min, max)}`);
    }
    return parsed;
  };
}

/** Largest `--last` window (the daemon returns at most this many items) */
export const MAX_LAST_ITEMS = 10000;

/** Image formats Chrome can capture, by the names users write */
const SCREENSHOT_FORMATS: Record<string, 'png' | 'jpeg'> = {
  png: 'png',
  jpeg: 'jpeg',
  jpg: 'jpeg',
};

/**
 * Commander parser for `--format`: case-insensitive, `jpg` means `jpeg`.
 *
 * @param value - Raw option value
 * @returns Normalized format
 * @throws InvalidArgumentError (exit 81) for other formats
 */
export function screenshotFormatOption(value: string): 'png' | 'jpeg' {
  const format = SCREENSHOT_FORMATS[value.trim().toLowerCase()];
  if (format) return format;
  const similar = findSimilar(value.toLowerCase(), Object.keys(SCREENSHOT_FORMATS));
  throw new InvalidArgumentError(
    `Use png or jpeg${similar.length ? ` (did you mean ${similar[0]}?)` : ''}.`
  );
}

/** Console levels by the names users write (`log` is shown under info) */
const CONSOLE_LEVELS: Record<string, ConsoleLevel> = {
  error: 'error',
  warning: 'warning',
  warn: 'warning',
  info: 'info',
  log: 'info',
  debug: 'debug',
  verbose: 'debug',
};

/**
 * Commander parser for `console --level`: case-insensitive, with aliases.
 *
 * @param value - Raw option value
 * @returns Console level
 * @throws InvalidArgumentError (exit 81) with a did-you-mean
 */
export function consoleLevelOption(value: string): ConsoleLevel {
  const level = CONSOLE_LEVELS[value.trim().toLowerCase()];
  if (level) return level;
  const similar = findSimilar(value.toLowerCase(), Object.keys(CONSOLE_LEVELS));
  throw new InvalidArgumentError(
    `Use error, warning, info (or log) or debug${similar.length ? ` (did you mean ${similar[0]}?)` : ''}.`
  );
}

/**
 * Commander parser for `dom listeners --type`: comma-separated event types
 * (case-sensitive, like `addEventListener`).
 *
 * @param value - Raw option value, e.g. "click,keydown"
 * @returns Event types
 * @throws InvalidArgumentError (exit 81) when no type is given
 */
export function eventTypesOption(value: string): string[] {
  const types = parseCommaSeparated(value);
  if (types.length > 0) return types;
  throw new InvalidArgumentError('Give at least one event type, e.g. click or click,keydown.');
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function normalizeResourceType(type: string): Protocol.Network.ResourceType | undefined {
  const name = resourceTypeFromName(type) ?? type;
  return VALID_RESOURCE_TYPES.find((valid) => valid.toLowerCase() === name.toLowerCase());
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
