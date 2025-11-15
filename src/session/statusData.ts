/**
 * Business logic for building session status data.
 *
 * Extracts status calculation logic from formatters to maintain separation of concerns.
 * Formatters should only handle presentation, not business logic.
 */

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
