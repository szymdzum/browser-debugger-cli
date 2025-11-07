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
  lines.push('◆ Session Started');
  lines.push('');
  lines.push(`Target: ${url}`);
  lines.push('');
  lines.push(
    section('Live Monitoring:', [
      'bdg peek        Preview collected data (snapshot)',
      'bdg tail        Continuous monitoring (live updates)',
      'bdg details <type> <id>    Full request/console details',
    ])
  );
  lines.push('');
  lines.push(
    section('Inspect by domain:', [
      'bdg dom         DOM inspection & manipulation',
      'bdg network     Network requests & cookies',
      'bdg console     Console logs & messages',
    ])
  );
  lines.push('');
  lines.push(
    section('Session:', [
      'bdg status      Check session state',
      'bdg stop        End session & save output',
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
 * Generate "session stopped" success message.
 *
 * @param outputPath - Path to session output file
 * @returns Formatted success message
 */
export function sessionStopped(outputPath: string): string {
  return `Session stopped. Output saved to: ${outputPath}`;
}

// ============================================================================
// Stop Command Messages
// ============================================================================

/**
 * Standard messages for stop command operations.
 */
export const STOP_MESSAGES = {
  SUCCESS: 'Session stopped successfully',
  NO_SESSION: 'No active session found',
  FAILED: 'Failed to stop session',
  DAEMON_NOT_RUNNING: 'Daemon not running',
} as const;

/**
 * Generate stop session failed error message.
 *
 * @param reason - Reason for failure
 * @returns Formatted error message
 */
export function stopFailedError(reason: string): string {
  return `Stop session failed: ${reason}`;
}
