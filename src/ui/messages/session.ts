/**
 * Session-related user-facing messages.
 *
 * Centralized location for all session UI text including landing pages,
 * status displays, and session management messages.
 */

import { section, joinLines } from '@/ui/formatting.js';

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

  return joinLines(
    '',
    '◆ Session Started',
    '',
    `Target: ${url}`,
    '',
    section('Raw CDP Access (53 domains, 300+ methods):', [
      'bdg cdp --list             List all domains',
      'bdg cdp Network --list     List Network methods',
      'bdg cdp --search cookie    Search methods',
      'bdg cdp runtime.evaluate --params \'{"expression":"document.title"}\'',
    ]),
    '',
    section('Live Monitoring:', [
      'bdg peek        Preview collected data (last 10 items)',
      'bdg tail        Continuous monitoring (live updates)',
      'bdg details <type> <id>    Full request/console details',
    ]),
    '',
    section('Domain Wrappers:', [
      'bdg dom query <selector>   Query DOM elements',
      'bdg dom eval <js>          Execute JavaScript',
    ]),
    '',
    section('Session:', [
      'bdg status      Check session state',
      'bdg stop        End session & save output',
    ]),
    '',
    section('Discovery (for AI agents):', [
      'bdg --help --json          Machine-readable schema (commands, options, exit codes)',
      '.claude/skills/bdg/        Claude skill with 15+ recipes & patterns',
    ]),
    ''
  );
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
