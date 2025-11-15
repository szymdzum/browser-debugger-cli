/**
 * Business logic for building session status data.
 *
 * Extracts status calculation logic from formatters to maintain separation of concerns.
 * Formatters should only handle presentation, not business logic.
 */

import type { SessionActivity, PageState } from '@/ipc/index.js';
import type { SessionMetadata } from '@/session/metadata.js';
import { isProcessAlive } from '@/session/process.js';
import type { StatusData } from '@/ui/formatters/status.js';
import { VERSION } from '@/utils/version.js';

/**
 * Duration information for a session
 */
export interface DurationInfo {
  /** Total duration in milliseconds */
  durationMs: number;
  /** Duration in seconds */
  durationSec: number;
  /** Minutes component */
  minutes: number;
  /** Seconds component */
  seconds: number;
  /** Formatted duration string (e.g., "5m 23s" or "42s") */
  formatted: string;
}

/**
 * Calculate session duration from start time
 *
 * @param startTime - Session start timestamp in milliseconds
 * @param now - Current timestamp (defaults to Date.now())
 * @returns Duration breakdown with formatted string
 *
 * @example
 * ```typescript
 * const duration = calculateDuration(Date.now() - 323000);
 * // { durationMs: 323000, durationSec: 323, minutes: 5, seconds: 23, formatted: "5m 23s" }
 * ```
 */
export function calculateDuration(startTime: number, now = Date.now()): DurationInfo {
  const durationMs = now - startTime;
  const durationSec = Math.floor(durationMs / 1000);
  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  const formatted = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return { durationMs, durationSec, minutes, seconds, formatted };
}

/**
 * Format "time ago" string from timestamp
 *
 * @param timestamp - Timestamp in milliseconds
 * @param now - Current timestamp (defaults to Date.now())
 * @returns Human-readable time ago string (e.g., "5m ago", "2h ago")
 *
 * @example
 * ```typescript
 * formatTimeAgo(Date.now() - 75000); // "1m ago"
 * formatTimeAgo(Date.now() - 7200000); // "2h ago"
 * ```
 */
export function formatTimeAgo(timestamp: number, now = Date.now()): string {
  const secondsAgo = Math.floor((now - timestamp) / 1000);
  if (secondsAgo < 60) return `${secondsAgo}s ago`;
  const minutesAgo = Math.floor(secondsAgo / 60);
  if (minutesAgo < 60) return `${minutesAgo}m ago`;
  const hoursAgo = Math.floor(minutesAgo / 60);
  return `${hoursAgo}h ago`;
}

/**
 * Build status data for active session
 *
 * Encapsulates all business logic for calculating session status:
 * - Duration calculations
 * - Process health checks
 * - Activity metrics
 * - Telemetry state
 *
 * @param metadata - Session metadata
 * @param pid - BDG daemon process ID
 * @param activity - Optional live activity metrics from worker
 * @param pageState - Optional current page state from worker
 * @returns Complete status data object
 *
 * @example
 * ```typescript
 * const status = buildActiveSessionStatus(metadata, daemonPid);
 * console.log(status.active); // true
 * console.log(status.durationFormatted); // "5m 23s"
 * ```
 */
export function buildActiveSessionStatus(
  metadata: SessionMetadata,
  pid: number,
  activity?: SessionActivity,
  pageState?: PageState
): StatusData {
  const duration = calculateDuration(metadata.startTime);
  const chromeAlive = metadata.chromePid ? isProcessAlive(metadata.chromePid) : false;

  // Build status object conditionally to satisfy exactOptionalPropertyTypes
  const status: StatusData = {
    version: VERSION,
    active: true,
    bdgPid: pid,
    chromePid: metadata.chromePid,
    chromeAlive,
    startTime: metadata.startTime,
    duration: duration.durationMs,
    durationFormatted: duration.formatted,
    port: metadata.port,
    targetId: metadata.targetId,
    webSocketDebuggerUrl: metadata.webSocketDebuggerUrl,
    telemetry: metadata.activeTelemetry ?? ['network', 'console', 'dom'],
  };

  // Only add optional properties if defined
  if (activity !== undefined) status.activity = activity;
  if (pageState !== undefined) status.pageState = pageState;

  return status;
}

/**
 * Build status data for inactive session
 *
 * @returns Status data indicating no active session
 */
export function buildInactiveSessionStatus(): StatusData {
  return { version: VERSION, active: false };
}

/**
 * Build status data for stale session
 *
 * A stale session has a PID file but the process is not running.
 *
 * @param stalePid - PID of the dead process
 * @returns Status data indicating stale session
 */
export function buildStaleSessionStatus(stalePid: number): StatusData {
  return { version: VERSION, active: false, stale: true, stalePid };
}

/**
 * Build status data when metadata is missing
 *
 * This can occur when:
 * - Session was created by older version
 * - Metadata file was corrupted or deleted
 * - Race condition during session startup
 *
 * @param pid - BDG daemon process ID
 * @returns Status data with warning about missing metadata
 */
export function buildMissingMetadataStatus(pid: number): StatusData {
  return {
    version: VERSION,
    active: true,
    bdgPid: pid,
    warning: 'Metadata not found (session may be from older version)',
  };
}
