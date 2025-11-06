/**
 * Cookie formatter for human-readable output.
 */

import { OutputFormatter, pluralize } from '@/ui/formatting.js';

/**
 * CDP Cookie type
 */
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Format cookies for human-readable output.
 *
 * @param cookies - Array of CDP cookies
 * @returns Formatted cookie list
 *
 * @example
 * ```typescript
 * const output = formatCookies([
 *   { name: 'session', value: 'abc123', domain: '.example.com', ... }
 * ]);
 * console.log(output);
 * ```
 */
export function formatCookies(cookies: Cookie[]): string {
  if (cookies.length === 0) {
    return 'No cookies found';
  }

  const fmt = new OutputFormatter();
  fmt.text(`${pluralize(cookies.length, 'Cookie', 'Cookies')}:`).blank();

  cookies.forEach((cookie, index) => {
    fmt.text(`[${index + 1}] ${cookie.name}`);

    const expires =
      cookie.expires && cookie.expires !== -1
        ? new Date(cookie.expires * 1000).toISOString()
        : 'Session';

    fmt.list(
      [
        `Value: ${cookie.value}`,
        `Domain: ${cookie.domain}`,
        `Path: ${cookie.path}`,
        `Expires: ${expires}`,
        `HttpOnly: ${cookie.httpOnly ? 'Yes' : 'No'}`,
        `Secure: ${cookie.secure ? 'Yes' : 'No'}`,
        `SameSite: ${cookie.sameSite ?? 'None'}`,
      ],
      2
    );

    if (index < cookies.length - 1) {
      fmt.blank();
    }
  });

  return fmt.build();
}
