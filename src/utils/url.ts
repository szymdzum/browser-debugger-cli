/**
 * URL normalization, validation, and parsing utilities.
 */

// ============================================================================
// URL Normalization
// ============================================================================

/**
 * Normalize a URL by adding http:// protocol if missing.
 *
 * Supports: localhost:3000, example.com, http://localhost, file:// URLs
 * Preserves special browser protocols: about:, chrome:, data:, javascript:, blob:
 *
 * @param url - URL string to normalize
 * @returns Normalized URL with protocol
 *
 * @example
 * ```typescript
 * normalizeUrl('localhost:3000')      // → 'http://localhost:3000'
 * normalizeUrl('https://example.com') // → 'https://example.com'
 * normalizeUrl('example.com/path')    // → 'http://example.com/path'
 * normalizeUrl('about:blank')         // → 'about:blank' (unchanged)
 * normalizeUrl('chrome://settings')   // → 'chrome://settings' (unchanged)
 * ```
 */
export function normalizeUrl(url: string): string {
  // Check for protocols that should not be modified
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('file://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome:') ||
    url.startsWith('data:') ||
    url.startsWith('javascript:') ||
    url.startsWith('vbscript:') ||
    url.startsWith('blob:')
  ) {
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

  // Check for invalid characters before normalization
  // URLs with spaces or invalid characters in protocol/hostname should be rejected
  if (url.includes(' ')) {
    return {
      valid: false,
      error: `Invalid URL format: '${url}' (contains spaces)`,
      suggestion: 'URLs cannot contain spaces',
    };
  }

  // Check for invalid characters in protocol-like patterns (e.g., ht!tp://)
  const protocolPattern = /^[a-z0-9!@#$%^&*()]+:\/\//i;
  if (protocolPattern.test(url)) {
    // Has something that looks like a protocol - validate it
    const match = url.match(/^([a-z0-9!@#$%^&*()]+):\/\//i);
    if (match && match[1]) {
      const protocol = match[1].toLowerCase();
      const validProtocols = ['http', 'https', 'file', 'about', 'chrome', 'data', 'javascript', 'vbscript', 'blob'];
      if (!validProtocols.includes(protocol)) {
        return {
          valid: false,
          error: `Invalid protocol: '${protocol}://'`,
          suggestion: 'Use http://, https://, or another valid protocol',
        };
      }
    }
  }

  const normalized = normalizeUrl(url);

  try {
    const parsed = new URL(normalized);

    const validProtocols = ['http:', 'https:', 'file:', 'about:', 'chrome:', 'data:'];
    if (!validProtocols.includes(parsed.protocol)) {
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
 *
 * @param input - URL string to extract hostname+pathname from
 * @returns Hostname with pathname (e.g., 'example.com/api/users'), or original input if parsing fails
 *
 * @example
 * ```typescript
 * extractHostnameWithPath('https://api.example.com/v1/users?id=123')
 *   // → 'api.example.com/v1/users'
 * extractHostnameWithPath('localhost:3000/dashboard')
 *   // → 'localhost/dashboard'
 * ```
 */
export function extractHostnameWithPath(input: string): string {
  const parsed = safeParseUrl(input);
  return parsed ? parsed.hostname + parsed.pathname : input;
}
