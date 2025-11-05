/**
 * Command operation messages (stop, cleanup, etc.)
 *
 * User-facing messages for command-specific operations like stopping sessions,
 * cleaning up stale files, and validating command arguments.
 */

// ============================================================================
// Stop Command Messages
// ============================================================================

/**
 * Generate session stopped successfully message.
 *
 * @returns Formatted success message
 */
export function sessionStoppedMessage(): string {
  return 'Session stopped successfully';
}

/**
 * Generate Chrome killed message.
 *
 * @param pid - Chrome process ID that was killed
 * @returns Formatted success message
 */
export function chromeKilledMessage(pid?: number): string {
  return pid ? `Killed Chrome (PID ${pid})` : 'Killed Chrome';
}

/**
 * Generate warning message.
 *
 * @param message - Warning text
 * @returns Formatted warning message
 */
export function warningMessage(message: string): string {
  return `Warning: ${message}`;
}

/**
 * Generate no active session message.
 *
 * @returns Formatted message
 */
export function noActiveSessionMessage(): string {
  return 'No active session found';
}

// ============================================================================
// Cleanup Command Messages
// ============================================================================

/**
 * Generate session files cleaned up message.
 *
 * @returns Formatted success message
 */
export function sessionFilesCleanedMessage(): string {
  return 'Session files cleaned up';
}

/**
 * Generate session output file removed message.
 *
 * @returns Formatted success message
 */
export function sessionOutputRemovedMessage(): string {
  return 'Session output file removed';
}

/**
 * Generate session directory clean message.
 *
 * @returns Formatted success message
 */
export function sessionDirectoryCleanMessage(): string {
  return 'Session directory is now clean';
}

/**
 * Generate no session files found message.
 *
 * @returns Formatted success message
 */
export function noSessionFilesMessage(): string {
  return 'No session files found. Session directory is already clean';
}

/**
 * Generate stale session found message.
 *
 * @param pid - Process ID that is not running
 * @returns Formatted message
 */
export function staleSessionFoundMessage(pid: number): string {
  return `Found stale session (PID ${pid} not running)`;
}

/**
 * Generate force cleanup warning message.
 *
 * @param pid - Process ID that is still running
 * @returns Multi-line warning message
 */
export function forceCleanupWarningMessage(pid: number): string {
  const lines: string[] = [];
  lines.push(`Warning: Process ${pid} is still running!`);
  lines.push('Forcing cleanup anyway...');
  lines.push('(The process will continue running but lose session tracking)');
  return lines.join('\n');
}

/**
 * Generate session still active error.
 *
 * @param pid - Active process ID
 * @returns Formatted error message
 */
export function sessionStillActiveError(pid: number): string {
  return `Session is still active (PID ${pid})`;
}

// ============================================================================
// Validation Messages
// ============================================================================

/**
 * Generate invalid --last argument error.
 *
 * @param value - The invalid value provided
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Multi-line error message
 */
export function invalidLastArgumentError(
  value: string | undefined,
  min: number = 1,
  max: number = 1000
): string {
  const lines: string[] = [];
  lines.push(`Error: --last must be between ${min} and ${max}`);
  if (value !== undefined) {
    lines.push(`Provided value: ${value}`);
  }
  return lines.join('\n');
}

/**
 * Generate daemon not running with cleanup suggestion.
 *
 * @param staleCleaned - Whether stale PID was cleaned up
 * @returns Formatted error message
 */
export function daemonNotRunningWithCleanup(staleCleaned: boolean): string {
  if (staleCleaned) {
    return 'Daemon not running (stale PID cleaned up). Start it with: bdg <url>';
  }
  return 'Daemon not running. Start it with: bdg <url>';
}
