/**
 * Session-related user-facing messages.
 *
 * Centralized location for all session UI text including landing pages,
 * status displays, and session management messages.
 */

import {
  buildCommonTasksSection,
  buildDomainCommandsSection,
  buildLiveMonitoringSection,
  buildSessionManagementSection,
  buildCdpSection,
  buildDiscoverySection,
} from '@/ui/formatters/sessionFormatters.js';
import { joinLines } from '@/ui/formatting.js';

/**
 * Options for the landing page display.
 */
export interface LandingPageOptions {
  /** Target URL being monitored */
  url: string;
  /** HTTP status of the main document (a warning is shown for 4xx/5xx) */
  documentStatus?: number;
  /** When `--timeout` will stop the session */
  autoStopAt?: Date;
}

/**
 * Lines shown under the target in both the full and the quiet start output:
 * an HTTP error of the page, and when the session stops by itself.
 *
 * @param options - Landing page options
 * @returns Lines (empty when there is nothing to say)
 */
export function startNotices(options: LandingPageOptions): string[] {
  const { documentStatus, autoStopAt } = options;
  return [
    ...(documentStatus !== undefined && documentStatus >= 400
      ? [`⚠ The page responded with HTTP ${documentStatus}`]
      : []),
    ...(autoStopAt ? [`Auto-stop: at ${autoStopAt.toLocaleTimeString()} (--timeout)`] : []),
  ];
}

/**
 * Generate the landing page display for session start.
 *
 * Shows a clean, organized overview of available commands grouped by priority.
 * High-level commands are presented first to guide agents toward token-efficient
 * wrappers before falling back to verbose CDP commands.
 *
 * Section order optimized for agent discoverability:
 * 1. Common tasks with token savings estimates
 * 2. Comprehensive domain command coverage (12+ commands)
 * 3. Live monitoring capabilities
 * 4. Session management
 * 5. Advanced CDP access (positioned as fallback)
 * 6. Discovery resources for agents
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
  const notices = startNotices(options);

  return joinLines(
    '',
    'Session Started',
    '',
    `Target: ${url}`,
    '',
    ...(notices.length > 0 ? [...notices, ''] : []),
    buildCommonTasksSection(),
    '',
    buildDomainCommandsSection(),
    '',
    buildLiveMonitoringSection(),
    '',
    buildSessionManagementSection(),
    '',
    buildCdpSection(),
    '',
    buildDiscoverySection(),
    ''
  );
}

/**
 * Generate "session stopped" success message.
 *
 * @returns Formatted success message
 */
export function sessionStopped(): string {
  return 'Session stopped';
}

/**
 * Standard messages for stop command operations.
 */
export const STOP_MESSAGES = {
  SUCCESS: 'Session stopped successfully',
  NO_SESSION: 'No active session found',
  FAILED: 'Failed to stop session',
  DAEMON_NOT_RUNNING: 'No active session',
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

/**
 * Why the last session is gone, for `bdg status`.
 *
 * @param end - How and when it ended
 * @returns One line
 */
export function lastSessionEndText(end: { reason: string; endedAt: number }): string {
  const why: Record<string, string> = {
    crash: 'Chrome crashed or was closed',
    closed: 'its page was closed',
    timeout: 'the --timeout was reached',
  };
  const at = new Date(end.endedAt).toLocaleTimeString();
  return `The last session ended at ${at}: ${why[end.reason] ?? end.reason}`;
}
