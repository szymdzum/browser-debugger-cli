/**
 * DevTools-compatible Network Filter DSL parser and evaluator.
 *
 * Provides Chrome DevTools Network panel filter syntax for querying network requests.
 * Supports domain matching, status codes, HTTP methods, MIME types, size thresholds,
 * header inspection, and various state filters.
 */

import { matchesWildcard } from '@/telemetry/filters.js';
import type { NetworkRequest } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { extractHostname } from '@/utils/url.js';

const log = createLogger('network');

export type FilterType =
  | 'domain'
  | 'status-code'
  | 'method'
  | 'mime-type'
  | 'resource-type'
  | 'larger-than'
  | 'has-response-header'
  | 'is'
  | 'scheme';

export type ComparisonOperator = '=' | '>=' | '<=' | '>' | '<';

export interface ParsedFilter {
  type: FilterType;
  value: string;
  negated: boolean;
  operator: ComparisonOperator;
}

export type FilterValidationResult =
  | { valid: true; filters: ParsedFilter[] }
  | { valid: false; error: string; suggestion?: string };

type FilterTokenResult = ParsedFilter | { error: string; suggestion?: string };

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

const VALID_FILTER_TYPES: FilterType[] = [
  'domain',
  'status-code',
  'method',
  'mime-type',
  'resource-type',
  'larger-than',
  'has-response-header',
  'is',
  'scheme',
];

const VALID_IS_VALUES = ['from-cache', 'running'] as const;

const SIZE_PATTERN = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i;
const QUOTED_TOKEN_PATTERN = /(?:[^\s"]+|"[^"]*")+/g;

/**
 * Parse a size string with units into bytes.
 */
export function parseSize(value: string): number {
  const match = value.match(SIZE_PATTERN);
  if (!match) {
    throw new Error(`Invalid size format: "${value}". Use format like "100KB", "1MB", "1.5GB"`);
  }

  const [, numStr, unit = 'b'] = match;
  const num = parseFloat(numStr ?? '0');
  const multiplier = SIZE_UNITS[unit.toLowerCase()] ?? 1;

  return Math.floor(num * multiplier);
}

function extractOperator(value: string): [ComparisonOperator, string] {
  if (value.startsWith('>=')) return ['>=', value.slice(2)];
  if (value.startsWith('<=')) return ['<=', value.slice(2)];
  if (value.startsWith('>')) return ['>', value.slice(1)];
  if (value.startsWith('<')) return ['<', value.slice(1)];
  return ['=', value];
}

function findSimilarTypes(input: string): string[] {
  const lowerInput = input.toLowerCase();
  return VALID_FILTER_TYPES.filter((type) => {
    const prefix = type.split('-')[0] ?? '';
    const typeNoHyphens = type.replace('-', '');
    return (
      type.startsWith(lowerInput) ||
      lowerInput.startsWith(prefix) ||
      type.includes(lowerInput) ||
      lowerInput.includes(typeNoHyphens)
    );
  });
}

function createError(error: string, suggestion?: string): { error: string; suggestion?: string } {
  return suggestion ? { error, suggestion } : { error };
}

function isNegated(token: string): boolean {
  return token.startsWith('-') || token.startsWith('!');
}

function validateFilterType(type: string): FilterTokenResult | null {
  if (VALID_FILTER_TYPES.includes(type as FilterType)) return null;

  const similar = findSimilarTypes(type);
  const suggestion =
    similar.length > 0
      ? `Did you mean: ${similar.join(', ')}?`
      : `Valid types: ${VALID_FILTER_TYPES.join(', ')}`;

  return createError(`Unknown filter type: "${type}"`, suggestion);
}

function validateIsValue(value: string): FilterTokenResult | null {
  const lowerValue = value.toLowerCase();
  if (VALID_IS_VALUES.includes(lowerValue as (typeof VALID_IS_VALUES)[number])) return null;

  return createError(
    `Invalid "is" filter value: "${value}"`,
    `Valid values: ${VALID_IS_VALUES.join(', ')}`
  );
}

function validateSizeValue(value: string): FilterTokenResult | null {
  try {
    parseSize(value);
    return null;
  } catch (error) {
    log.debug(
      `Size parse failed for "${value}": ${error instanceof Error ? error.message : String(error)}`
    );
    return createError(
      `Invalid size format: "${value}"`,
      'Use format like "100KB", "1MB", "1.5GB"'
    );
  }
}

function validateStatusCode(value: string): FilterTokenResult | null {
  const numValue = parseInt(value, 10);
  if (!isNaN(numValue) && numValue >= 100 && numValue <= 599) return null;

  return createError(`Invalid status code: "${value}"`, 'Status codes must be between 100 and 599');
}

function parseFilterToken(token: string): FilterTokenResult {
  const trimmed = token.trim();
  if (!trimmed) return createError('Empty filter token');

  const negated = isNegated(trimmed);
  const withoutPrefix = negated ? trimmed.slice(1) : trimmed;

  const colonIndex = withoutPrefix.indexOf(':');
  if (colonIndex === -1) {
    return createError(
      `Invalid filter format: "${token}". Expected "type:value" format`,
      'Use format like "status-code:404" or "domain:api.*"'
    );
  }

  const type = withoutPrefix.slice(0, colonIndex).toLowerCase();
  const rawValue = withoutPrefix.slice(colonIndex + 1);

  if (!rawValue) {
    return createError(`Missing value for filter "${type}"`, `Provide a value after the colon`);
  }

  const typeError = validateFilterType(type);
  if (typeError) return typeError;

  let operator: ComparisonOperator = '=';
  let value = rawValue;

  if (type === 'status-code' || type === 'larger-than') {
    [operator, value] = extractOperator(rawValue);
  }

  if (type === 'is') {
    const isError = validateIsValue(value);
    if (isError) return isError;
    value = value.toLowerCase();
  }

  if (type === 'larger-than') {
    const sizeError = validateSizeValue(value);
    if (sizeError) return sizeError;
  }

  if (type === 'status-code') {
    const statusError = validateStatusCode(value);
    if (statusError) return statusError;
  }

  return { type: type as FilterType, value, negated, operator };
}

function tokenize(input: string): string[] {
  return input.match(QUOTED_TOKEN_PATTERN) ?? [];
}

function stripQuotes(token: string): string {
  return token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token;
}

/**
 * Parse a filter string into an array of ParsedFilter objects.
 */
export function parseFilterString(input: string): ParsedFilter[] {
  if (!input.trim()) return [];

  const tokens = tokenize(input);
  const filters: ParsedFilter[] = [];

  for (const token of tokens) {
    const result = parseFilterToken(stripQuotes(token));

    if ('error' in result) {
      const errorMsg = result.suggestion ? `${result.error}\n${result.suggestion}` : result.error;
      throw new Error(errorMsg);
    }

    filters.push(result);
  }

  return filters;
}

/**
 * Validate a filter string and return detailed results.
 */
export function validateFilterString(input: string): FilterValidationResult {
  try {
    const filters = parseFilterString(input);
    return { valid: true, filters };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const [errorLine, suggestionLine] = message.split('\n');
    const result: FilterValidationResult = { valid: false, error: errorLine ?? message };
    if (suggestionLine) result.suggestion = suggestionLine;
    return result;
  }
}

function compareNumeric(actual: number, target: number, operator: ComparisonOperator): boolean {
  switch (operator) {
    case '=':
      return actual === target;
    case '>=':
      return actual >= target;
    case '<=':
      return actual <= target;
    case '>':
      return actual > target;
    case '<':
      return actual < target;
  }
}

function extractScheme(url: string): string {
  try {
    return new URL(url).protocol.replace(':', '');
  } catch {
    return '';
  }
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
}

function matchesCacheHeaders(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false;
  const cacheHeader = headers['x-cache']?.toLowerCase() ?? '';
  const cfCacheStatus = headers['cf-cache-status']?.toLowerCase() ?? '';
  return cacheHeader.includes('hit') || cfCacheStatus === 'hit';
}

function matchesFilter(request: NetworkRequest, filter: ParsedFilter): boolean {
  switch (filter.type) {
    case 'domain':
      return matchesWildcard(extractHostname(request.url), filter.value);

    case 'status-code':
      if (request.status === undefined) return false;
      return compareNumeric(request.status, parseInt(filter.value, 10), filter.operator);

    case 'method':
      return request.method.toUpperCase() === filter.value.toUpperCase();

    case 'mime-type': {
      if (!request.mimeType) return false;
      const normalizedMime = normalizeMimeType(request.mimeType);
      const filterValue = filter.value.toLowerCase();
      return normalizedMime === filterValue || normalizedMime.startsWith(filterValue);
    }

    case 'resource-type': {
      if (!request.resourceType) return false;
      const types = filter.value.split(',').map((t) => t.trim().toLowerCase());
      return types.includes(request.resourceType.toLowerCase());
    }

    case 'larger-than': {
      const size = request.encodedDataLength ?? 0;
      const threshold = parseSize(filter.value);
      const effectiveOperator = filter.operator === '=' ? '>' : filter.operator;
      return compareNumeric(size, threshold, effectiveOperator);
    }

    case 'has-response-header': {
      if (!request.responseHeaders) return false;
      const headerName = filter.value.toLowerCase();
      return Object.keys(request.responseHeaders).some((h) => h.toLowerCase() === headerName);
    }

    case 'is':
      if (filter.value === 'from-cache') return matchesCacheHeaders(request.responseHeaders);
      if (filter.value === 'running') return request.status === undefined;
      return false;

    case 'scheme':
      return extractScheme(request.url).toLowerCase() === filter.value.toLowerCase();
  }
}

/**
 * Apply parsed filters to an array of network requests.
 */
export function applyFilters(
  requests: NetworkRequest[],
  filters: ParsedFilter[]
): NetworkRequest[] {
  if (filters.length === 0) return requests;

  return requests.filter((request) =>
    filters.every((filter) => {
      const matches = matchesFilter(request, filter);
      return filter.negated ? !matches : matches;
    })
  );
}

/**
 * Get help text for filter DSL syntax.
 */
export function getFilterHelpText(): string {
  return `
Filter syntax:
  status-code:>=400       HTTP status codes (supports =, >=, <=, >, <)
  domain:api.*            Domain with wildcards
  method:POST             HTTP method
  mime-type:application/json
  resource-type:XHR,Fetch CDP resource types (comma-separated)
  larger-than:100KB       Size threshold (B, KB, MB, GB)
  has-response-header:set-cookie
  is:from-cache           Cached responses
  is:running              In-progress requests
  scheme:https            URL scheme

Negation (use ! to avoid CLI conflicts with -):
  !domain:cdn.*           Exclude matching requests
  --filter="!method:POST" Alternative: use = syntax with -

Multiple filters:
  "domain:api.* status-code:>=400"  (AND logic)
`.trim();
}
