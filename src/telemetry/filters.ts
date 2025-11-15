/**
 * Default filters for reducing noise in collected data
 */

import { extractHostname, extractHostnameWithPath } from '@/utils/url.js';

/**
 * Decision object for whether to fetch a response body.
 */
export interface BodyFetchDecision {
  /** Whether the body should be fetched */
  should: boolean;
  /** Reason why the body was skipped (if should is false) */
  reason?: string;
}

/**
 * Domains to exclude by default (common tracking/analytics)
 * These generate high volume but are rarely useful for debugging
 */
export const DEFAULT_EXCLUDED_DOMAINS = [
  'analytics.google.com',
  'googletagmanager.com',
  'googleadservices.com',
  'doubleclick.net',
  'google-analytics.com',
  'clarity.ms',
  'bat.bing.com',
  'facebook.com',
  'connect.facebook.net',
  'tiktok.com',
  'linkedin.com',
  'twitter.com',
  'snapchat.com',
  'mixpanel.com',
  'segment.com',
  'segment.io',
  'amplitude.com',
  'heap.io',
  'fullstory.com',
  'hotjar.com',
  'logrocket.com',
  'smartlook.com',
  'exactag.com',
  'criteo.com',
  'adroll.com',
  'outbrain.com',
  'taboola.com',
  'confirmit.com',
  'newrelic.com',
  'datadoghq.com',
  'sentry.io',
] as const;

/**
 * Console message types to exclude by default (Redux/React DevTools noise)
 */
export const DEFAULT_EXCLUDED_CONSOLE_TYPES = [
  'startGroup',
  'startGroupCollapsed',
  'endGroup',
] as const;

/**
 * Console message patterns to exclude by default (dev server noise)
 */
export const DEFAULT_EXCLUDED_CONSOLE_PATTERNS = [
  'webpack-dev-server',
  '[HMR]',
  '[WDS]',
  'Download the React DevTools',
  '@@redux',
  '%c prev state',
  '%c action',
  '%c next state',
] as const;

/**
 * File patterns to skip body fetching by default (assets unlikely to be useful for debugging)
 * These reduce data volume significantly without losing critical debugging information.
 */
export const DEFAULT_SKIP_BODY_PATTERNS = [
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.svg',
  '*.ico',
  '*.webp',
  '*.bmp',
  '*.tiff',
  '*.woff',
  '*.woff2',
  '*.ttf',
  '*.eot',
  '*.otf',
  '*.css',
  '*.map',
  '*.js.map',
  '*.css.map',
  '*.mp4',
  '*.webm',
  '*.ogg',
  '*.avi',
  '*.mov',
  '*.mp3',
  '*.wav',
  '*.flac',
  '*.aac',
] as const;

/**
 * MIME types to skip body fetching by default
 * This catches resources that may not have obvious file extensions (e.g., CSS with query params)
 */
export const DEFAULT_SKIP_BODY_MIME_TYPES = [
  'text/css',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'font/woff',
  'font/woff2',
  'font/ttf',
  'font/eot',
  'font/otf',
  'application/font-woff',
  'application/font-woff2',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
] as const;

/**
 * Check if a URL should be excluded based on domain filtering.
 *
 * @param url - URL to check against exclusion list
 * @param includeAll - If true, disables all filtering
 * @returns True if the URL's domain matches an excluded domain
 */
export function shouldExcludeDomain(url: string, includeAll: boolean = false): boolean {
  if (includeAll) {
    return false;
  }

  const hostname = extractHostname(url).toLowerCase();
  return DEFAULT_EXCLUDED_DOMAINS.some((domain) => hostname.includes(domain.toLowerCase()));
}

/**
 * Check if a console message should be excluded based on type and pattern filtering
 */
export function shouldExcludeConsoleMessage(
  text: string,
  type: string,
  includeAll: boolean = false
): boolean {
  if (includeAll) {
    return false;
  }

  if ((DEFAULT_EXCLUDED_CONSOLE_TYPES as readonly string[]).includes(type)) {
    return true;
  }

  const lowerText = text.toLowerCase();

  return DEFAULT_EXCLUDED_CONSOLE_PATTERNS.some((pattern) =>
    lowerText.includes(pattern.toLowerCase())
  );
}

/**
 * Pattern matching configuration for URL filtering
 */
interface PatternMatchConfig {
  /** URL patterns to explicitly include (trumps all other rules) */
  includePatterns?: string[];
  /** URL patterns to explicitly exclude */
  excludePatterns?: string[];
  /** Behavior when URL doesn't match any patterns ('include' or 'exclude') */
  defaultBehavior?: 'include' | 'exclude';
}

/**
 * Evaluate whether a URL matches pattern rules using include-trumps-exclude logic.
 *
 * Provides centralized pattern matching with consistent precedence rules:
 * 1. If URL matches includePatterns → true (even if it also matches excludePatterns)
 * 2. If includePatterns specified but URL doesn't match → false (whitelist mode)
 * 3. If URL matches excludePatterns → false
 * 4. Otherwise → use defaultBehavior
 *
 * This function consolidates the URL parsing and wildcard matching logic that was
 * previously duplicated across multiple filter functions.
 *
 * @param url - The URL to check against patterns
 * @param config - Pattern matching configuration with include/exclude patterns
 * @returns True if the URL should be included based on pattern rules
 */
function evaluatePatternMatch(url: string, config: PatternMatchConfig): boolean {
  const { includePatterns = [], excludePatterns = [], defaultBehavior = 'include' } = config;

  const hostname = extractHostname(url);
  const hostnameWithPath = extractHostnameWithPath(url);

  const matchesAny = (patterns: string[]): boolean =>
    patterns.some(
      (pattern) => matchesWildcard(hostname, pattern) || matchesWildcard(hostnameWithPath, pattern)
    );

  const includeSpecified = includePatterns.length > 0;
  const includeMatch = includeSpecified && matchesAny(includePatterns);
  const excludeMatch = excludePatterns.length > 0 && matchesAny(excludePatterns);

  if (includeMatch) {
    return true;
  }

  if (includeSpecified) {
    return false;
  }

  if (excludeMatch) {
    return false;
  }

  return defaultBehavior === 'include';
}

/**
 * Simple wildcard pattern matcher.
 * Supports only the * wildcard character.
 *
 * Examples:
 *   matchesWildcard("api.json", "*.json") → true
 *   matchesWildcard("api/users", "*api*") → true
 *   matchesWildcard("index.html", "*.js") → false
 *
 * @param str - The string to test
 * @param pattern - The pattern with * wildcards
 * @returns True if the string matches the pattern
 */
export function matchesWildcard(str: string, pattern: string): boolean {
  const regexPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(str);
}

/**
 * Determine if a response body should be fetched based on URL, MIME type, and patterns.
 *
 * Pattern precedence (follows include-trumps-exclude rule):
 * 1. If URL matches includePatterns → FETCH (even if it also matches excludePatterns)
 * 2. If includePatterns specified but URL doesn't match → SKIP (whitelist mode)
 * 3. If URL matches excludePatterns → SKIP
 * 4. If fetchAllBodies flag is true → FETCH
 * 5. If MIME type matches DEFAULT_SKIP_BODY_MIME_TYPES → SKIP
 * 6. If URL matches DEFAULT_SKIP_BODY_PATTERNS → SKIP
 * 7. Otherwise → FETCH (default behavior)
 *
 * @param url - The request URL
 * @param mimeType - The response MIME type (for MIME-based skipping)
 * @param options - Configuration options
 * @returns True if the body should be fetched
 */
export function shouldFetchBody(
  url: string,
  mimeType: string | undefined,
  options: {
    fetchAllBodies?: boolean;
    includePatterns?: string[];
    excludePatterns?: string[];
  } = {}
): boolean {
  const { fetchAllBodies = false, includePatterns = [], excludePatterns = [] } = options;

  if (includePatterns.length > 0) {
    return evaluatePatternMatch(url, {
      includePatterns,
      defaultBehavior: 'exclude',
    });
  }

  if (excludePatterns.length > 0) {
    const matchesExclude = evaluatePatternMatch(url, {
      includePatterns: excludePatterns,
      defaultBehavior: 'exclude',
    });
    if (matchesExclude) {
      return false;
    }
  }

  if (fetchAllBodies) {
    return true;
  }

  if (mimeType) {
    const normalizedMimeType = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
    if (
      normalizedMimeType &&
      DEFAULT_SKIP_BODY_MIME_TYPES.some((skipType) => normalizedMimeType === skipType.toLowerCase())
    ) {
      return false;
    }
  }

  const matchesDefaultSkip = evaluatePatternMatch(url, {
    includePatterns: [...DEFAULT_SKIP_BODY_PATTERNS],
    defaultBehavior: 'exclude',
  });

  return !matchesDefaultSkip;
}

/**
 * Determine if a response body should be fetched with detailed reason.
 *
 * Combines all decision logic: MIME type, size limits, smart defaults, and fetch flags.
 * Returns a decision object with reason string for logging/debugging.
 *
 * @param url - Request URL
 * @param mimeType - Response MIME type
 * @param encodedDataLength - Response size in bytes
 * @param options - Configuration options
 * @returns Decision object with should boolean and optional reason
 *
 * @example
 * ```typescript
 * const decision = shouldFetchBodyWithReason(
 *   'https://api.example.com/data',
 *   'application/json',
 *   1024,
 *   { maxBodySize: 5 * 1024 * 1024 }
 * );
 * if (!decision.should) {
 *   console.log(`Skipped: ${decision.reason}`);
 * }
 * ```
 */
export function shouldFetchBodyWithReason(
  url: string,
  mimeType: string | undefined,
  encodedDataLength: number,
  options: {
    fetchAllBodies?: boolean;
    includePatterns?: string[];
    excludePatterns?: string[];
    maxBodySize?: number;
  } = {}
): BodyFetchDecision {
  const { maxBodySize = 5 * 1024 * 1024 } = options;

  const isTextResponse =
    (mimeType?.includes('json') ?? false) ||
    (mimeType?.includes('javascript') ?? false) ||
    (mimeType?.includes('text') ?? false) ||
    (mimeType?.includes('html') ?? false);

  if (!isTextResponse) {
    return { should: false, reason: 'Non-text response type' };
  }

  if (encodedDataLength > maxBodySize) {
    const sizeStr = `${(encodedDataLength / 1024 / 1024).toFixed(2)}MB`;
    const limitStr = `${(maxBodySize / 1024 / 1024).toFixed(2)}MB`;
    return {
      should: false,
      reason: `Response too large (${sizeStr} > ${limitStr})`,
    };
  }

  const shouldFetch = shouldFetchBody(url, mimeType, options);

  if (!shouldFetch) {
    return {
      should: false,
      reason: 'Auto-optimization (see DEFAULT_SKIP_BODY_PATTERNS)',
    };
  }

  return { should: true };
}

/**
 * Determine if a network request should be excluded based on URL patterns.
 *
 * Pattern precedence (follows include-trumps-exclude rule):
 * 1. If URL matches includePatterns → CAPTURE (even if it also matches excludePatterns)
 * 2. If includePatterns specified but URL doesn't match → EXCLUDE (whitelist mode)
 * 3. If URL matches excludePatterns → EXCLUDE
 * 4. Otherwise → CAPTURE (default behavior)
 *
 * Note: This function is separate from domain filtering (shouldExcludeDomain).
 * Both filters can be applied: domain filtering happens first, then URL pattern filtering.
 *
 * @param url - The request URL
 * @param options - Configuration options
 * @returns True if the request should be excluded
 */
export function shouldExcludeUrl(
  url: string,
  options: {
    includePatterns?: string[];
    excludePatterns?: string[];
  } = {}
): boolean {
  const { includePatterns = [], excludePatterns = [] } = options;

  return !evaluatePatternMatch(url, {
    includePatterns,
    excludePatterns,
    defaultBehavior: 'include',
  });
}
