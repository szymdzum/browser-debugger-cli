/**
 * Safe URL parsing utilities with automatic protocol detection.
 *
 * Provides centralized URL parsing that gracefully handles:
 * - Missing protocols (adds http://)
 * - Malformed URLs (returns null)
 * - Localhost and bare hostnames
 *
 * WHY: Eliminates duplicated try/catch blocks across 4+ files
 * (filters.ts, url.ts, collectors, connection layer).
 */

/**
 * Safely parse a URL string with automatic protocol detection.
 *
 * Attempts to parse the URL in two passes:
 * 1. As-is (supports full URLs with protocols)
 * 2. With 'http://' prefix (supports localhost:3000, example.com, etc.)
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
  // First attempt: parse as-is (handles full URLs with protocols)
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
