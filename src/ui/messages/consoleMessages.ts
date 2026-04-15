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
