/**
 * Network data formatters for human-readable output
 */

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
 * Format cookies for human-readable output
 *
 * @param cookies - Array of CDP cookies
 */
export function formatCookies(cookies: Cookie[]): void {
  if (cookies.length === 0) {
    console.log('No cookies found');
    return;
  }

  console.log(`Cookies (${cookies.length}):\n`);

  cookies.forEach((cookie, index) => {
    console.log(`[${index + 1}] ${cookie.name}`);
    console.log(`  Value: ${cookie.value}`);
    console.log(`  Domain: ${cookie.domain}`);
    console.log(`  Path: ${cookie.path}`);

    if (cookie.expires && cookie.expires !== -1) {
      const expiresDate = new Date(cookie.expires * 1000);
      console.log(`  Expires: ${expiresDate.toISOString()}`);
    } else {
      console.log(`  Expires: Session`);
    }

    console.log(`  HttpOnly: ${cookie.httpOnly ? 'Yes' : 'No'}`);
    console.log(`  Secure: ${cookie.secure ? 'Yes' : 'No'}`);
    console.log(`  SameSite: ${cookie.sameSite ?? 'None'}`);

    if (index < cookies.length - 1) {
      console.log('');
    }
  });
}
