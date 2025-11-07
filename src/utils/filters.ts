/**
 * Default filters for reducing noise in collected data
 */

import { extractHostname, extractHostnameWithPath } from './url.js';

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
  // Google Analytics & Ads
  'analytics.google.com',
  'googletagmanager.com',
  'googleadservices.com',
  'doubleclick.net',
  'google-analytics.com',

  // Microsoft/Bing
  'clarity.ms',
  'bat.bing.com',

  // Social Media Tracking
  'facebook.com',
  'connect.facebook.net',
  'tiktok.com',
  'linkedin.com',
  'twitter.com',
  'snapchat.com',

  // Product Analytics
  'mixpanel.com',
  'segment.com',
  'segment.io',
  'amplitude.com',
  'heap.io',

  // Session Recording & Heatmaps
  'fullstory.com',
  'hotjar.com',
  'logrocket.com',
  'smartlook.com',

  // Ad Networks & Attribution
  'exactag.com',
  'criteo.com',
  'adroll.com',
  'outbrain.com',
  'taboola.com',

  // Other Analytics
  'confirmit.com',
  'newrelic.com',
  'datadoghq.com',
  'sentry.io',
];

/**
 * Console message types to exclude by default (Redux/React DevTools noise)
 */
export const DEFAULT_EXCLUDED_CONSOLE_TYPES = ['startGroup', 'startGroupCollapsed', 'endGroup'];

/**
 * Console message patterns to exclude by default (dev server noise)
 */
export const DEFAULT_EXCLUDED_CONSOLE_PATTERNS = [
  'webpack-dev-server',
  '[HMR]',
  '[WDS]',
  'Download the React DevTools',
  '@@redux', // Redux actions
  '%c prev state', // Redux logger
  '%c action', // Redux logger
  '%c next state', // Redux logger
];

/**
 * File patterns to skip body fetching by default (assets unlikely to be useful for debugging)
 * These reduce data volume significantly without losing critical debugging information.
 */
export const DEFAULT_SKIP_BODY_PATTERNS = [
  // Images
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.svg',
  '*.ico',
  '*.webp',
  '*.bmp',
  '*.tiff',

  // Fonts
  '*.woff',
  '*.woff2',
  '*.ttf',
  '*.eot',
  '*.otf',

  // Stylesheets
  '*.css',

  // Source maps (can be large and rarely needed)
  '*.map',
  '*.js.map',
  '*.css.map',

  // Videos
  '*.mp4',
  '*.webm',
  '*.ogg',
  '*.avi',
  '*.mov',

  // Audio
  '*.mp3',
  '*.wav',
  '*.flac',
  '*.aac',
];

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
];

/**
 * Check if a URL should be excluded based on domain filtering.
 *
 * @param url - URL to check against exclusion list
 * @param includeAll - If true, disables all filtering
 * @returns True if the URL's domain matches an excluded domain
 */
export function shouldExcludeDomain(url: string, includeAll: boolean = false): boolean {
  if (includeAll) {
    return false; // Don't filter anything if --include-all flag is set
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
    return false; // Don't filter anything if --include-all flag is set
  }

  // Check if message type should be excluded (e.g., group messages)
  if (DEFAULT_EXCLUDED_CONSOLE_TYPES.includes(type)) {
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

  // Parse URL once for all pattern checks
  const hostname = extractHostname(url);
  const hostnameWithPath = extractHostnameWithPath(url);

  // Helper: check if any pattern matches hostname or hostname+path
  const matchesAny = (patterns: string[]): boolean =>
    patterns.some(
      (pattern) => matchesWildcard(hostname, pattern) || matchesWildcard(hostnameWithPath, pattern)
    );

  // Compute match states
  const includeSpecified = includePatterns.length > 0;
  const includeMatch = includeSpecified && matchesAny(includePatterns);
  const excludeMatch = excludePatterns.length > 0 && matchesAny(excludePatterns);

  // Decision logic: include trumps exclude, then whitelist mode, then exclude, then default
  return includeMatch || (!includeSpecified && !excludeMatch && defaultBehavior === 'include');
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
  // Escape special regex characters except *
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
    .replace(/\*/g, '.*'); // Replace * with .*

  const regex = new RegExp(`^${regexPattern}$`, 'i'); // Case-insensitive
  return regex.test(str);
}

/**
 * Check if a URL matches any pattern in a list.
 *
 * Matches against both bare hostname and hostname+pathname to support:
 * - Bare hostname patterns: `api.example.com` matches all requests to that host
 * - Hostname wildcard patterns: `*analytics*` matches "analytics.google.com/collect"
 * - Path patterns: `*\/api\/*` matches "example.com/api/users"
 * - Combined patterns: `api.example.com\/users` matches specific endpoint
 *
 * @param url - The URL to check
 * @param patterns - Array of wildcard patterns
 * @returns True if URL matches any pattern
 */

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

  // If includePatterns specified, act as whitelist (trumps everything else)
  if (includePatterns.length > 0) {
    return evaluatePatternMatch(url, {
      includePatterns,
      defaultBehavior: 'exclude',
    });
  }

  // If excludePatterns specified and URL matches → skip (trumps fetchAllBodies)
  if (excludePatterns.length > 0) {
    const matchesExclude = evaluatePatternMatch(url, {
      includePatterns: excludePatterns,
      defaultBehavior: 'exclude',
    });
    if (matchesExclude) {
      return false;
    }
  }

  // If fetchAllBodies flag is set → fetch everything
  if (fetchAllBodies) {
    return true;
  }

  // Check MIME type against default skip list (case-insensitive)
  if (mimeType) {
    const normalizedMimeType = mimeType.toLowerCase().split(';')[0]?.trim() ?? ''; // Remove charset etc.
    if (
      normalizedMimeType &&
      DEFAULT_SKIP_BODY_MIME_TYPES.some((skipType) => normalizedMimeType === skipType.toLowerCase())
    ) {
      return false;
    }
  }

  // Apply default auto-skip URL patterns
  const matchesDefaultSkip = evaluatePatternMatch(url, {
    includePatterns: DEFAULT_SKIP_BODY_PATTERNS,
    defaultBehavior: 'exclude',
  });

  // Default: fetch the body unless it matches default skip patterns
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

  // Check if response is text-based
  const isTextResponse =
    (mimeType?.includes('json') ?? false) ||
    (mimeType?.includes('javascript') ?? false) ||
    (mimeType?.includes('text') ?? false) ||
    (mimeType?.includes('html') ?? false);

  if (!isTextResponse) {
    return { should: false, reason: 'Non-text response type' };
  }

  // Check size limits
  if (encodedDataLength > maxBodySize) {
    const sizeStr = `${(encodedDataLength / 1024 / 1024).toFixed(2)}MB`;
    const limitStr = `${(maxBodySize / 1024 / 1024).toFixed(2)}MB`;
    return {
      should: false,
      reason: `Response too large (${sizeStr} > ${limitStr})`,
    };
  }

  // Use existing shouldFetchBody for pattern matching
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

  // Use unified pattern matching - invert result since we want exclusion logic
  return !evaluatePatternMatch(url, {
    includePatterns,
    excludePatterns,
    defaultBehavior: 'include',
  });
}
