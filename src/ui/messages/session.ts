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

  return joinLines(
    '',
    'Session Started',
    '',
    `Target: ${url}`,
    '',
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
