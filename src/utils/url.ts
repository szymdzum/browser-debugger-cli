/**
 * URL normalization and validation utilities.
 *
 * Note: Display formatting functions (truncateUrl, truncateText) have been
 * moved to \@/ui/formatting.js as part of UI centralization.
 */

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

/**
 * Validate that a URL is valid and usable for Chrome navigation.
 *
 * WHY: Provides clear error messages before attempting to launch Chrome.
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

  // Normalize first (adds http:// if missing)
  const normalized = normalizeUrl(url);

  // Try to parse as URL
  try {
    const parsed = new URL(normalized);

    // Check for valid protocol
    const validProtocols = ['http:', 'https:', 'file:', 'about:', 'chrome:', 'data:'];
    if (!validProtocols.includes(parsed.protocol)) {
      return {
        valid: false,
        error: `Invalid protocol: '${parsed.protocol}'`,
        suggestion: 'URLs must use http://, https://, or other valid protocols',
      };
    }

    // Check for valid hostname (for http/https)
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
