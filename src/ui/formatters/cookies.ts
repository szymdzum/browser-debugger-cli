/**
 * Cookie formatter for human-readable output.
 */

import { pluralize } from '@/ui/formatting.js';

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

  const lines: string[] = [];
  lines.push(`${pluralize(cookies.length, 'Cookie', 'Cookies')}:\n`);

  cookies.forEach((cookie, index) => {
    const cookieLines: string[] = [];
    cookieLines.push(`[${index + 1}] ${cookie.name}`);
    cookieLines.push(`  Value: ${cookie.value}`);
    cookieLines.push(`  Domain: ${cookie.domain}`);
    cookieLines.push(`  Path: ${cookie.path}`);

    if (cookie.expires && cookie.expires !== -1) {
      const expiresDate = new Date(cookie.expires * 1000);
      cookieLines.push(`  Expires: ${expiresDate.toISOString()}`);
    } else {
      cookieLines.push(`  Expires: Session`);
    }

    cookieLines.push(`  HttpOnly: ${cookie.httpOnly ? 'Yes' : 'No'}`);
    cookieLines.push(`  Secure: ${cookie.secure ? 'Yes' : 'No'}`);
    cookieLines.push(`  SameSite: ${cookie.sameSite ?? 'None'}`);

    lines.push(cookieLines.join('\n'));

    if (index < cookies.length - 1) {
      lines.push('');
    }
  });

  return lines.join('\n');
}
