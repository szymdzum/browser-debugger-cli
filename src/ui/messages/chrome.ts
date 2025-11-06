/**
 * Chrome-related user-facing messages.
 *
 * Centralized location for Chrome diagnostics, launch errors, and troubleshooting messages.
 */

import { pluralize } from '@/ui/formatting.js';
import type { ChromeDiagnostics } from '@/utils/chromeDiagnostics.js';

/**
 * Format Chrome diagnostics for error reporting when Chrome launch fails.
 *
 * @param diagnostics - Chrome diagnostics information
 * @returns Formatted error message lines with troubleshooting steps
 *
 * @example
 * ```typescript
 * const diagnostics = getChromeDiagnostics();
 * const errorLines = formatDiagnosticsForError(diagnostics);
 * console.error(errorLines.join('\n'));
 * ```
 */
export function formatDiagnosticsForError(diagnostics: ChromeDiagnostics): string[] {
  const lines: string[] = [];

  if (diagnostics.installationCount === 0) {
    lines.push('Error: No Chrome installations detected\n');
    lines.push('Install Chrome from:');
    lines.push('   https://www.google.com/chrome/\n');
  } else {
    lines.push(`Found ${pluralize(diagnostics.installationCount, 'Chrome installation')}:\n`);
    diagnostics.installations.forEach((path, index) => {
      lines.push(`  ${index + 1}. ${path}`);
    });
    lines.push('');

    if (diagnostics.defaultPath) {
      lines.push(`Default binary: ${diagnostics.defaultPath}\n`);
    } else {
      lines.push('Default binary: Could not determine\n');
    }
  }

  return lines;
}

/**
 * Format Chrome diagnostics for verbose status output (bdg status --verbose).
 *
 * @param diagnostics - Chrome diagnostics information
 * @returns Array of formatted status lines
 *
 * @example
 * ```typescript
 * const diagnostics = getChromeDiagnostics();
 * const statusLines = formatDiagnosticsForStatus(diagnostics);
 * console.log(statusLines.join('\n'));
 * ```
 */
export function formatDiagnosticsForStatus(diagnostics: ChromeDiagnostics): string[] {
  const lines: string[] = [];

  if (diagnostics.defaultPath) {
    lines.push(`Binary:           ${diagnostics.defaultPath}`);
  } else {
    lines.push('Binary:           Could not determine');
  }

  lines.push(`Installations:    ${diagnostics.installationCount} found`);
  if (diagnostics.installationCount > 0 && diagnostics.installationCount <= 3) {
    diagnostics.installations.forEach((path, index) => {
      lines.push(`  ${index + 1}. ${path}`);
    });
  } else if (diagnostics.installationCount > 3) {
    lines.push(`  (Use 'bdg cleanup --aggressive' to see all)`);
  }

  return lines;
}

/**
 * Generate invalid port error message.
 *
 * @param port - Invalid port number
 * @returns Formatted error message
 */
export function invalidPortError(port: number): string {
  return `Invalid port number: ${port}. Port must be between 1 and 65535.`;
}

/**
 * Generate user data directory creation error.
 *
 * @param dir - Directory path that failed
 * @param error - Error message
 * @returns Formatted error message
 */
export function userDataDirError(dir: string, error: string): string {
  return `Failed to create user data directory at ${dir}: ${error}`;
}

// ============================================================================
// Chrome Launcher Messages
// ============================================================================

/**
 * Generate Chrome launch start message.
 *
 * @param port - CDP port number
 * @returns Formatted message
 */
export function chromeLaunchStartMessage(port: number): string {
  return `Launching Chrome with CDP on port ${port}...`;
}

/**
 * Generate Chrome launch success message.
 *
 * @param pid - Chrome process ID
 * @param duration - Launch duration in milliseconds
 * @returns Formatted message
 */
export function chromeLaunchSuccessMessage(pid: number, duration: number): string {
  return `Chrome launched successfully (PID: ${pid}, ${duration}ms)`;
}

/**
 * Generate user data directory info message.
 *
 * @param dir - User data directory path
 * @returns Formatted message
 */
export function chromeUserDataDirMessage(dir: string): string {
  return `User data directory: ${dir}`;
}

/**
 * Generate preferences file not found error.
 *
 * @param file - Preferences file path
 * @returns Formatted error message
 */
export function prefsFileNotFoundError(file: string): string {
  return `Chrome preferences file not found: ${file}`;
}

/**
 * Generate invalid preferences format error.
 *
 * @param file - Preferences file path
 * @param type - Actual type found
 * @returns Formatted error message
 */
export function invalidPrefsFormatError(file: string, type: string): string {
  return `Invalid Chrome preferences format in ${file}: expected object, got ${type}`;
}

/**
 * Generate preferences load error.
 *
 * @param file - Preferences file path
 * @param error - Error message
 * @returns Formatted error message
 */
export function prefsLoadError(file: string, error: string): string {
  return `Failed to load Chrome preferences from ${file}: ${error}`;
}

/**
 * Generate generic Chrome launch error.
 *
 * @param error - Error message
 * @returns Formatted error message
 */
export function chromeLaunchFailedError(error: string): string {
  return `Failed to launch Chrome: ${error}`;
}

// ============================================================================
// Chrome Cleanup Messages
// ============================================================================

/**
 * Generate message for starting Chrome cleanup process.
 *
 * @returns Formatted message
 *
 * @example
 * ```typescript
 * console.error(cleanupChromeAttemptingMessage());
 * ```
 */
export function cleanupChromeAttemptingMessage(): string {
  return '\nAttempting to kill stale Chrome processes...';
}

/**
 * Generate warning message when Chrome PID is not found in cache.
 *
 * @returns Multi-line formatted warning message
 *
 * @example
 * ```typescript
 * console.error(cleanupChromePidNotFoundMessage());
 * ```
 */
export function cleanupChromePidNotFoundMessage(): string {
  const lines: string[] = [];
  lines.push('Warning: No Chrome PID found in cache');
  lines.push('   Either Chrome was already running, or no Chrome was launched by bdg\n');
  return lines.join('\n');
}

/**
 * Generate message indicating Chrome process is being killed.
 *
 * @param pid - Chrome process ID
 * @returns Formatted message
 *
 * @example
 * ```typescript
 * console.error(cleanupChromeKillingMessage(12345));
 * // Output: "Killing Chrome process (PID: 12345)..."
 * ```
 */
export function cleanupChromeKillingMessage(pid: number): string {
  return `Killing Chrome process (PID: ${pid})...`;
}

/**
 * Generate success message after Chrome process is killed.
 *
 * @returns Formatted success message
 *
 * @example
 * ```typescript
 * console.error(cleanupChromeSuccessMessage());
 * ```
 */
export function cleanupChromeSuccessMessage(): string {
  return 'Chrome process killed successfully';
}

/**
 * Generate error message when Chrome cleanup fails.
 *
 * @param error - Error message
 * @returns Multi-line formatted error message with troubleshooting
 *
 * @example
 * ```typescript
 * console.error(cleanupChromeFailedMessage('Process not found'));
 * ```
 */
export function cleanupChromeFailedMessage(error: string): string {
  const lines: string[] = [];
  lines.push(`Error: Failed to kill Chrome process: ${error}`);
  lines.push('   Try manually killing Chrome processes if issues persist\n');
  return lines.join('\n');
}

/**
 * Generate generic error message for Chrome cleanup process failure.
 *
 * @param error - Error message
 * @returns Formatted error message
 *
 * @example
 * ```typescript
 * console.error(cleanupChromeProcessFailedMessage('Cannot read PID file'));
 * ```
 */
export function cleanupChromeProcessFailedMessage(error: string): string {
  return `Error: Failed to cleanup Chrome processes: ${error}\n`;
}
