/**
 * Command operation messages (stop, cleanup, etc.)
 *
 * User-facing messages for command-specific operations like stopping sessions,
 * cleaning up stale files, and validating command arguments.
 */

import { joinLines } from '@/ui/formatting.js';

// ============================================================================
// Stop Command Messages
// ============================================================================

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
 * */
export function forceCleanupWarningMessage(pid: number): string {
  return joinLines(
    `Warning: Process ${pid} is still running!`,
    'Forcing cleanup anyway...',
    '(The process will continue running but lose session tracking)'
  );
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

// ============================================================================
// Start Command Messages
// ============================================================================
/**
 * Generate help message when no URL is provided to start command.
 *
 * @returns Multi-line help message with examples
 * */
export function startCommandHelpMessage(): string {
  return joinLines(
    '',
    'Start a new session by providing a URL:',
    '',
    '  bdg example.com',
    '  bdg localhost:3000',
    '  bdg https://github.com',
    '',
    'Or manage existing session:',
    '',
    '  bdg status      Check session state',
    '  bdg stop        End session',
    '  bdg --help      Show all commands',
    ''
  );
}
