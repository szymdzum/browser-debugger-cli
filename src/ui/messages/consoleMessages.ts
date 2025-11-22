/**
 * Console command messages (bdg console)
 *
 * User-facing messages for the console command output and formatting.
 */

/**
 * Generate message for following console output.
 *
 * @returns Status message for stderr
 */
export function followingConsoleMessage(): string {
  return 'Streaming console messages... (Ctrl+C to stop)';
}

/**
 * Generate message when stopping console follow mode.
 *
 * @returns Status message for stderr
 */
export function stoppedFollowingConsoleMessage(): string {
  return 'Stopped streaming console messages';
}

/**
 * Generate message when no console data is available.
 *
 * @returns Error message with context
 */
export function noConsoleDataMessage(): string {
  return 'No console data available. Console messages are captured during browser session.';
}
