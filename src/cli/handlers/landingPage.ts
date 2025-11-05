/**
 * Landing page display for session start.
 */

/**
 * Options for the landing page display.
 */
export interface LandingPageOptions {
  /** Target URL being monitored */
  url: string;
  /** Worker process ID */
  workerPid: number;
  /** Chrome process ID */
  chromePid: number;
  /** Collectors enabled */
  collectors: string[];
}

/**
 * Generate the landing page display for session start.
 *
 * @param options - Landing page options
 * @returns Formatted landing page string
 *
 * @example
 * ```typescript
 * landingPage({
 *   url: 'http://localhost:3000',
 *   workerPid: 12345,
 *   chromePid: 12346,
 *   collectors: ['network', 'console', 'dom']
 * });
 * ```
 */
export function landingPage(options: LandingPageOptions): string {
  const { url } = options;

  const lines: string[] = [];

  lines.push('');
  lines.push('▲  Session Started');
  lines.push('');
  lines.push(`Target: ${url}`);
  lines.push('');
  lines.push('Explore by domain:');
  lines.push('  bdg dom         DOM inspection & manipulation');
  lines.push('  bdg network     Network requests & cookies');
  lines.push('  bdg console     Console logs & messages');
  lines.push('');
  lines.push('Session:');
  lines.push('  bdg status      Check session state');
  lines.push('  bdg stop        End session & save');
  lines.push('');
  lines.push('Advanced:');
  lines.push('  bdg cdp <method> [params]    Direct CDP access (300+ methods)');
  lines.push('');

  return lines.join('\n');
}
