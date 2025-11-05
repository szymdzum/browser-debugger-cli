/**
 * Session-related user-facing messages.
 *
 * Centralized location for all session UI text including landing pages,
 * status displays, and session management messages.
 */

import { section } from '@/ui/formatting.js';

/**
 * Options for the landing page display.
 */
export interface LandingPageOptions {
  /** Target URL being monitored */
  url: string;
}

/**
 * Generate the landing page display for session start.
 *
 * Shows a clean, organized overview of available commands grouped by domain.
 *
 * @param options - Landing page options
 * @returns Formatted landing page string
 *
 * @example
 * ```typescript
 * const message = landingPage({
 *   url: 'http://localhost:3000'
 * });
 * console.log(message);
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
  lines.push(
    section('Explore by domain:', [
      'bdg dom         DOM inspection & manipulation',
      'bdg network     Network requests & cookies',
      'bdg console     Console logs & messages',
    ])
  );
  lines.push('');
  lines.push(
    section('Session:', [
      'bdg status      Check session state',
      'bdg stop        End session & save',
    ])
  );
  lines.push('');
  lines.push(
    section('Advanced:', ['bdg cdp <method> [params]    Direct CDP access (300+ methods)'])
  );
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate "session already running" error message with helpful context.
 *
 * @param pid - Process ID of running daemon
 * @param duration - Session duration in human-readable format
 * @returns Formatted error message
 */
export function sessionAlreadyRunning(pid: number, duration: string): string {
  const lines: string[] = [];

  lines.push('Session already running');
  lines.push('');
  lines.push(`  PID: ${pid}`);
  lines.push(`  Duration: ${duration}`);
  lines.push('');
  lines.push('Suggestions:');
  lines.push('  View session:     bdg status');
  lines.push('  Stop and restart: bdg stop && bdg <url>');

  return lines.join('\n');
}

/**
 * Generate "session stopped" success message.
 *
 * @param outputPath - Path to session output file
 * @returns Formatted success message
 */
export function sessionStopped(outputPath: string): string {
  return `Session stopped. Output saved to: ${outputPath}`;
}

/**
 * Generate "no active session" error message.
 *
 * @returns Formatted error message
 */
export function noActiveSession(): string {
  return 'No active session. Start a session with: bdg <url>';
}
