/**
 * URL normalization, validation, and parsing utilities.
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Valid URL protocols for Chrome navigation.
 *
 * Excludes legacy protocols (vbscript) and limits to protocols
 * actually useful for modern web debugging scenarios.
 *
 * Includes javascript: for browser automation compatibility, though
 * it's generally not recommended for direct navigation.
 */
const VALID_PROTOCOLS = [
  'http:',
  'https:',
  'file:',
  'about:',
  'chrome:',
  'data:',
  'javascript:',
  'blob:',
] as const;

/**
 * Protocol prefixes that should be preserved as-is during normalization.
 */
const PRESERVED_PROTOCOL_PREFIXES = [
  'http://',
  'https://',
  'file://',
  'about:',
  'chrome:',
  'data:',
  'javascript:',
  'blob:',
] as const;

// ============================================================================
// URL Normalization
// ============================================================================

/**
 * Normalize a URL by adding http:// protocol if missing.
 *
 * Supports: localhost:3000, example.com, http://localhost, file:// URLs
 * Preserves special browser protocols: about:, chrome:, data:, javascript:, blob:
 *
 * Case-insensitive protocol detection supports HTTPS://, HTTP://, etc.
 *
 * @param url - URL string to normalize
 * @returns Normalized URL with lowercase protocol
 *
 * @example
 * ```typescript
 * normalizeUrl('localhost:3000')      // → 'http://localhost:3000'
 * normalizeUrl('https://example.com') // → 'https://example.com'
 * normalizeUrl('HTTPS://example.com') // → 'https://example.com'
 * normalizeUrl('example.com/path')    // → 'http://example.com/path'
 * normalizeUrl('about:blank')         // → 'about:blank' (unchanged)
 * normalizeUrl('chrome://settings')   // → 'chrome://settings' (unchanged)
 * ```
 *
 * @remarks
 * javascript: protocol is preserved for compatibility with browser automation,
 * though it's generally not recommended for direct navigation.
 */
export function normalizeUrl(url: string): string {
  const urlLower = url.toLowerCase();

  // Check for protocols that should not be modified (case-insensitive)
  const hasPreservedPrefix = PRESERVED_PROTOCOL_PREFIXES.some((prefix) =>
    urlLower.startsWith(prefix)
  );

  if (hasPreservedPrefix) {
    // Normalize protocol to lowercase while preserving rest of URL
    // Find where the protocol ends
    const protocolMatch = url.match(/^([a-z]+:\/?\/?)/i);
    if (protocolMatch?.[1]) {
      const protocol = protocolMatch[1].toLowerCase();
      const rest = url.slice(protocolMatch[1].length);
      return protocol + rest;
    }
    return url;
  }

  return `http://${url}`;
}

// ============================================================================
// URL Validation
// ============================================================================

/**
 * Validate that a URL is valid and usable for Chrome navigation.
 *
 * @param url - URL string to validate
 * @returns Object with valid flag and error message if invalid
 *
 * @example
 * ```typescript
 * const result = validateUrl('not-a-url');
 * if (!result.valid) {
 *   console.error(result.error);
 *   // → "Invalid URL format: 'not-a-url'"
 *   console.error(result.suggestion);
 *   // → "URLs must include a valid protocol (http:// or https://)"
 * }
 * ```
 *
 * @remarks
 * Validation is strict to prevent common errors like spaces or invalid protocols.
 * All URLs are normalized before validation to support convenient formats like
 * 'localhost:3000' or 'example.com'.
 */
export function validateUrl(url: string): {
  valid: boolean;
  error?: string;
  suggestion?: string;
} {
  // Empty URL
  if (!url || url.trim().length === 0) {
    return {
      valid: false,
      error: 'URL cannot be empty',
      suggestion: 'Provide a valid URL, e.g.: http://localhost:3000',
    };
  }

  // Check for spaces (common error)
  if (url.includes(' ')) {
    return {
      valid: false,
      error: `Invalid URL format: '${url}' (contains spaces)`,
      suggestion: 'URLs cannot contain spaces',
    };
  }

  const normalized = normalizeUrl(url);

  // Check for invalid characters in hostname/protocol (before normalization)
  // Skip this check for special protocols (javascript:, data:) which have different syntax
  const urlLower = url.toLowerCase();
  const isSpecialProtocol =
    urlLower.startsWith('javascript:') ||
    urlLower.startsWith('data:') ||
    urlLower.startsWith('blob:');

  if (!isSpecialProtocol) {
    // This prevents malformed URLs like "ht!tp://example" from being normalized to "http://ht!tp://example"
    const beforePath = url.split('/')[0] ?? '';
    if (/[!@#$%^&*()=+[\]{}\\|;'",<>?]/.test(beforePath)) {
      return {
        valid: false,
        error: `Invalid URL format: '${url}' (contains invalid characters)`,
        suggestion:
          'URLs cannot contain special characters like !, @, #, etc. in hostname or protocol',
      };
    }
  }

  try {
    const parsed = new URL(normalized);

    if (!VALID_PROTOCOLS.includes(parsed.protocol as (typeof VALID_PROTOCOLS)[number])) {
      return {
        valid: false,
        error: `Invalid protocol: '${parsed.protocol}'`,
        suggestion: 'URLs must use http://, https://, or other valid protocols',
      };
    }

    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) {
      return {
        valid: false,
        error: `Invalid URL format: '${url}' (missing hostname)`,
        suggestion: 'URLs must include a valid hostname, e.g.: http://example.com',
      };
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      error: `Invalid URL format: '${url}'`,
      suggestion: 'URLs must include a valid protocol (http:// or https://)',
    };
  }
}

// ============================================================================
// Safe URL Parsing
// ============================================================================

/**
 * Safely parse a URL string with automatic protocol detection.
 *
 *
 * @param input - URL string to parse (may lack protocol)
 * @returns Parsed URL object, or null if parsing fails both attempts
 *
 * @example
 * ```typescript
 * safeParseUrl('https://example.com')       // → URL { ... }
 * safeParseUrl('localhost:3000')            // → URL { protocol: 'http:', ... }
 * safeParseUrl('example.com/path')          // → URL { protocol: 'http:', ... }
 * safeParseUrl('not a url')                 // → null
 * safeParseUrl('file:///path/to/file.html') // → URL { protocol: 'file:', ... }
 * ```
 */
export function safeParseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    // Second attempt: add http:// prefix for protocol-less URLs
    try {
      return new URL(`http://${input}`);
    } catch {
      // Both attempts failed - invalid URL
      return null;
    }
  }
}

/**
 * Extract hostname from a URL string safely.
 *
 * @param input - URL string to extract hostname from
 * @returns Hostname (e.g., 'example.com'), or original input if parsing fails
 *
 * @example
 * ```typescript
 * extractHostname('https://example.com/path') // → 'example.com'
 * extractHostname('localhost:3000')           // → 'localhost'
 * extractHostname('invalid')                  // → 'invalid'
 * ```
 */
export function extractHostname(input: string): string {
  const parsed = safeParseUrl(input);
  return parsed?.hostname ?? input;
}

/**
 * Extract hostname with pathname from a URL string safely.
 *
 * Useful for pattern matching that needs both hostname and path segments.
 * Includes port number when present to enable differentiation between
 * localhost:9222/api and localhost:3000/api.
 *
 * @param input - URL string to extract hostname+pathname from
 * @returns Hostname (with port if present) and pathname (e.g., 'example.com/api/users'), or original input if parsing fails
 *
 * @example
 * ```typescript
 * extractHostnameWithPath('https://api.example.com/v1/users?id=123')
 *   // → 'api.example.com/v1/users'
 * extractHostnameWithPath('localhost:3000/dashboard')
 *   // → 'localhost:3000/dashboard'
 * extractHostnameWithPath('http://localhost:9222/api/test')
 *   // → 'localhost:9222/api/test'
 * ```
 */
export function extractHostnameWithPath(input: string): string {
  const parsed = safeParseUrl(input);
  return parsed ? parsed.host + parsed.pathname : input;
}
