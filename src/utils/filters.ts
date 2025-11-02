/**
 * Default filters for reducing noise in collected data
 */

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
 * Console message patterns to exclude by default (dev server noise)
 */
export const DEFAULT_EXCLUDED_CONSOLE_PATTERNS = [
  'webpack-dev-server',
  '[HMR]',
  '[WDS]',
  'Download the React DevTools',
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
 * Check if a URL should be excluded based on domain filtering
 */
export function shouldExcludeDomain(url: string, includeAll: boolean = false): boolean {
  if (includeAll) {
    return false; // Don't filter anything if --include-all flag is set
  }

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    return DEFAULT_EXCLUDED_DOMAINS.some((domain) => hostname.includes(domain.toLowerCase()));
  } catch {
    // If URL parsing fails, don't filter
    return false;
  }
}

/**
 * Check if a console message should be excluded based on pattern filtering
 */
export function shouldExcludeConsoleMessage(text: string, includeAll: boolean = false): boolean {
  if (includeAll) {
    return false; // Don't filter anything if --include-all flag is set
  }

  const lowerText = text.toLowerCase();

  return DEFAULT_EXCLUDED_CONSOLE_PATTERNS.some((pattern) =>
    lowerText.includes(pattern.toLowerCase())
  );
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
function matchesAnyPattern(url: string, patterns: string[]): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const hostnameWithPath = hostname + parsed.pathname;

    // Test patterns against both bare hostname and hostname+pathname
    // This allows "api.example.com" to match without requiring "/*"
    return patterns.some(
      (pattern) => matchesWildcard(hostname, pattern) || matchesWildcard(hostnameWithPath, pattern)
    );
  } catch {
    // If not a valid URL, test against the whole string
    return patterns.some((pattern) => matchesWildcard(url, pattern));
  }
}

/**
 * Determine if a response body should be fetched based on URL and patterns.
 *
 * Pattern precedence (follows include-trumps-exclude rule):
 * 1. If URL matches includePatterns → FETCH (even if it also matches excludePatterns)
 * 2. If URL matches excludePatterns → SKIP
 * 3. If fetchAllBodies flag is true → FETCH
 * 4. If URL matches DEFAULT_SKIP_BODY_PATTERNS → SKIP
 * 5. Otherwise → FETCH (default behavior)
 *
 * @param url - The request URL
 * @param mimeType - The response MIME type (optional, for additional checks)
 * @param options - Configuration options
 * @returns True if the body should be fetched
 */
export function shouldFetchBody(
  url: string,
  _mimeType: string | undefined,
  options: {
    fetchAllBodies?: boolean;
    includePatterns?: string[];
    excludePatterns?: string[];
  } = {}
): boolean {
  const { fetchAllBodies = false, includePatterns = [], excludePatterns = [] } = options;

  // If includePatterns specified and URL matches → always fetch (include trumps exclude)
  if (includePatterns.length > 0 && matchesAnyPattern(url, includePatterns)) {
    return true;
  }

  // If excludePatterns specified and URL matches → skip
  if (excludePatterns.length > 0 && matchesAnyPattern(url, excludePatterns)) {
    return false;
  }

  // If fetchAllBodies flag is set → fetch everything
  if (fetchAllBodies) {
    return true;
  }

  // Apply default auto-skip patterns
  if (matchesAnyPattern(url, DEFAULT_SKIP_BODY_PATTERNS)) {
    return false;
  }

  // Default: fetch the body
  return true;
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

  // If includePatterns specified, act as whitelist
  if (includePatterns.length > 0) {
    // URL matches include pattern → don't exclude (include trumps exclude)
    if (matchesAnyPattern(url, includePatterns)) {
      return false;
    }
    // URL doesn't match include pattern → exclude (whitelist mode)
    return true;
  }

  // If excludePatterns specified and URL matches → exclude
  if (excludePatterns.length > 0 && matchesAnyPattern(url, excludePatterns)) {
    return true;
  }

  // Default: don't exclude
  return false;
}
