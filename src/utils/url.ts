import { safeParseUrl } from './url/safeParseUrl.js';

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
 * Truncate a URL for compact display.
 *
 * Removes www. prefix, shortens long paths with ellipsis, and truncates to maxLength.
 *
 * @param url - URL string to truncate
 * @param maxLength - Maximum length of output (default: 60)
 * @returns Truncated URL for display
 *
 * @example
 * ```typescript
 * truncateUrl('https://i.clarity.ms/collect')
 *   // → 'clarity.ms/collect'
 * truncateUrl('https://aswpapius.com/api/web-channels/47d7def8-d602-49ec-bfdb-c959b1346774')
 *   // → 'aswpapius.com/.../47d7def8'
 * ```
 */
export function truncateUrl(url: string, maxLength: number = 60): string {
  const parsed = safeParseUrl(url);
  if (!parsed) {
    // Fallback: simple string truncation if URL parsing fails
    return url.length > maxLength ? url.substring(0, maxLength - 3) + '...' : url;
  }

  // Remove www. prefix
  const domain = parsed.hostname.replace(/^www\./, '');

  // Get path without leading slash
  const path = parsed.pathname.substring(1);

  // Start with domain + path
  let result = domain + (path ? `/${path}` : '');

  // If still too long, truncate the path
  if (result.length > maxLength) {
    const pathParts = path.split('/');
    if (pathParts.length > 2) {
      // Show first part, ellipsis, and last part
      const first = pathParts[0];
      const last = pathParts[pathParts.length - 1];
      if (first && last) {
        result = `${domain}/${first}/.../${last}`;

        // If still too long, truncate the last part
        if (result.length > maxLength) {
          const truncatedLast = last.substring(0, 8);
          result = `${domain}/${first}/.../${truncatedLast}`;
        }
      }
    } else {
      // Simple truncation
      result = result.substring(0, maxLength - 3) + '...';
    }
  }

  return result;
}

/**
 * Truncate console message text (especially stack traces)
 * @param text - The console message text
 * @param maxLines - Maximum number of lines to show (default: 3)
 */
export function truncateText(text: string, maxLines: number = 3): string {
  const lines = text.split('\n');

  if (lines.length <= maxLines) {
    return text;
  }

  const truncated = lines.slice(0, maxLines).join('\n');
  const hiddenCount = lines.length - maxLines;

  return `${truncated}\n  ... (${hiddenCount} more lines)`;
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
