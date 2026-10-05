/**
 * URL normalization, validation, and parsing utilities.
 */

import { invalid, valid, type ValidationResult } from '@/utils/validation.js';

/**
 * Dangerous URL protocols that must be explicitly blocked.
 *
 * These protocols can execute arbitrary code and are security risks.
 */
const DANGEROUS_PROTOCOLS = ['vbscript:', 'jscript:'] as const;

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

  const hasPreservedPrefix = PRESERVED_PROTOCOL_PREFIXES.some((prefix) =>
    urlLower.startsWith(prefix)
  );

  if (hasPreservedPrefix) {
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
export function validateUrl(url: string): ValidationResult {
  if (!url || url.trim().length === 0) {
    return invalid('URL cannot be empty', 'Provide a valid URL, e.g.: http://localhost:3000');
  }

  if (url.includes(' ')) {
    return invalid(
      `Invalid URL format: '${url}' (contains spaces)`,
      'Encode spaces as %20, e.g. bdg "https://example.com/search?q=a%20b"'
    );
  }

  // Detect if URL looks truncated (common when shell expands ? as glob)
  if (url.endsWith('?') || url.endsWith('&')) {
    return invalid(
      `URL appears truncated: '${url}'`,
      'URLs with query parameters (? or &) must be quoted: bdg "https://example.com/search?q=test"'
    );
  }

  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)?.[1]?.toLowerCase();
  if (scheme && !VALID_PROTOCOLS.includes(`${scheme}:` as (typeof VALID_PROTOCOLS)[number])) {
    return invalid(
      `Unsupported protocol: '${scheme}:'`,
      'bdg opens http://, https://, file://, about:, chrome:, and data: URLs'
    );
  }

  const normalized = normalizeUrl(url);

  const urlLower = url.toLowerCase();
  if (urlLower.startsWith('javascript:')) {
    return invalid(
      `Cannot start a session on a javascript: URL`,
      `Open a page first, then run the script: bdg about:blank && bdg dom eval '...'`
    );
  }
  if (urlLower.startsWith('vbscript:')) {
    return invalid(
      `Dangerous protocol: 'vbscript:' is not allowed`,
      'Use http://, https://, or other safe protocols'
    );
  }

  const isSpecialProtocol =
    urlLower.startsWith('javascript:') ||
    urlLower.startsWith('data:') ||
    urlLower.startsWith('blob:');

  if (!isSpecialProtocol) {
    const beforePath = url.split('/')[0] ?? '';
    if (/[!@#$%^&*()=+[\]{}\\|;'",<>?]/.test(beforePath)) {
      return invalid(
        `Invalid URL format: '${url}' (contains invalid characters)`,
        'URLs cannot contain special characters like !, @, #, etc. in hostname or protocol'
      );
    }
  }

  try {
    const parsed = new URL(normalized);

    // Explicitly block dangerous protocols (CodeQL js/incomplete-url-scheme-check)
    if (DANGEROUS_PROTOCOLS.includes(parsed.protocol as (typeof DANGEROUS_PROTOCOLS)[number])) {
      return invalid(
        `Blocked dangerous protocol: '${parsed.protocol}'`,
        'This protocol is not allowed for security reasons'
      );
    }

    if (!VALID_PROTOCOLS.includes(parsed.protocol as (typeof VALID_PROTOCOLS)[number])) {
      return invalid(
        `Invalid protocol: '${parsed.protocol}'`,
        'URLs must use http://, https://, or other valid protocols'
      );
    }

    const isWeb = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    if (isWeb && !/[a-z0-9]/i.test(parsed.hostname)) {
      return invalid(
        `Invalid URL format: '${url}' (missing hostname)`,
        'URLs must include a valid hostname, e.g.: http://example.com'
      );
    }

    return valid();
  } catch {
    return invalid(
      `Invalid URL format: '${url}'`,
      'URLs must include a valid protocol (http:// or https://). If URL has query parameters, quote it: bdg "https://example.com?q=test"'
    );
  }
}

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
    try {
      return new URL(`http://${input}`);
    } catch {
      return null;
    }
  }
}

/**
 * The HTTP DevTools endpoint a `--chrome-ws-url` value names instead of a
 * WebSocket URL: a port (`9222`), `host:port` (nothing after it), or an
 * `http(s)://` URL of the endpoint (any path is ignored).
 *
 * @param value - Option value
 * @returns Endpoint origin, e.g. `http://127.0.0.1:9222`, or null for anything else
 */
export function devToolsHttpEndpoint(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{1,5}$/.test(trimmed)) return `http://127.0.0.1:${trimmed}`;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^[^/\s]+:\d{1,5}\/?$/.test(trimmed)
      ? `http://${trimmed}`
      : null;
  if (candidate === null) return null;
  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

/**
 * Validate a `--chrome-ws-url` value.
 *
 * Accepted: `ws://` and `wss://` DevTools URLs, or the HTTP endpoint they come
 * from ({@link devToolsHttpEndpoint}). Rejects other schemes, malformed URLs,
 * and empty input so users hear about the problem at the CLI boundary
 * instead of after a daemon round-trip.
 *
 * @param url - ws URL to validate
 * @returns Validation result with error/suggestion when invalid
 */
export function validateChromeWsUrl(url: string): ValidationResult {
  const trimmed = url.trim();
  if (!trimmed) {
    return invalid(
      '--chrome-ws-url cannot be empty',
      'Expected: the DevTools port (9222), host:port, or ws://host:port/devtools/browser/<uuid>'
    );
  }

  if (devToolsHttpEndpoint(trimmed) !== null) return valid();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return invalid(
      `--chrome-ws-url is not a valid URL: '${url}'`,
      'Expected: the DevTools port (9222), host:port, or ws://host:port/devtools/browser/<uuid>'
    );
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return invalid(
      `--chrome-ws-url must use ws:// or wss://, got '${parsed.protocol}'`,
      `Give the DevTools port instead, e.g. --chrome-ws-url ${parsed.hostname || '127.0.0.1'}:9222`
    );
  }

  if (!parsed.hostname) {
    return invalid(
      `--chrome-ws-url is missing a hostname: '${url}'`,
      'Expected: the DevTools port (9222), host:port, or ws://host:port/devtools/browser/<uuid>'
    );
  }

  if (!/^\/devtools\/(browser|page)\/[^/]+$/.test(parsed.pathname)) {
    return invalid(
      `--chrome-ws-url must point to /devtools/browser/<id> or /devtools/page/<id>, got '${parsed.pathname}'`,
      `Find it with: curl -s http://${parsed.host}/json/version | jq -r .webSocketDebuggerUrl`
    );
  }

  return valid();
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
