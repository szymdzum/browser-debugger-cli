/**
 * Chrome-related user-facing messages.
 *
 * Centralized location for Chrome diagnostics, launch errors, and troubleshooting messages.
 */

import type { ChromeDiagnostics } from '@/connection/diagnostics.js';
import { pluralize, joinLines } from '@/ui/formatting.js';

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
 * Generate external Chrome connection message.
 *
 * @returns Formatted message
 */
export function chromeExternalConnectionMessage(): string {
  return 'Connecting to existing Chrome instance...';
}

/**
 * Generate external Chrome WebSocket URL message.
 *
 * @param wsUrl - WebSocket URL
 * @returns Formatted message
 */
export function chromeExternalWebSocketMessage(wsUrl: string): string {
  return `WebSocket URL: ${wsUrl}`;
}

/**
 * Generate external Chrome no PID message.
 *
 * @returns Formatted message
 */
export function chromeExternalNoPidMessage(): string {
  return 'Using external Chrome (no PID - not managed by bdg)';
}

/**
 * Generate external Chrome skip termination message.
 *
 * @returns Formatted message
 */
export function chromeExternalSkipTerminationMessage(): string {
  return 'Using external Chrome - skipping termination (not managed by bdg)';
}

/**
 * Generate error message when no page target is found after Chrome launch.
 *
 * @param port - CDP port number
 * @param availableTargets - Formatted list of available targets (or null if none)
 * @returns Formatted error message with diagnostics and troubleshooting steps
 */
export function noPageTargetFoundError(port: number, availableTargets: string | null): string {
  return joinLines(
    'No page target found after Chrome launch\n',
    'Possible causes:',
    `  1. Port conflict (${port})`,
    `     → Check: lsof -ti:${port}`,
    `     → Kill: pkill -f "chrome.*${port}"`,
    '  2. Chrome failed to create default target',
    '  3. Stale session',
    '     → Fix: bdg cleanup && bdg <url>\n',
    `Available Chrome targets:\n${availableTargets ?? '  (none)'}\n`,
    'Try:',
    '  - Clean up and retry: bdg cleanup && bdg <url>',
    `  - Use different port: bdg <url> --port ${port + 1}`
  );
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

/**
 * Generate error for invalid Chrome binary override path.
 *
 * @param path - Path that was provided via env/option
 * @param source - Human-readable source label (e.g. CHROME_PATH)
 * @returns Formatted error message
 */
export function chromeBinaryOverrideNotFound(path: string, source: string): string {
  return `Chrome binary override (${source}) points to "${path}", but that file does not exist.`;
}

/**
 * Generate error when Chrome binary override is not executable.
 *
 * @param path - Provided Chrome binary path
 * @param source - Human-readable source label (e.g. CHROME_PATH)
 * @returns Formatted error message with remediation guidance
 */
export function chromeBinaryOverrideNotExecutable(path: string, source: string): string {
  return (
    `Chrome binary override (${source}) points to "${path}", but it is not an executable file.\n` +
    'Update the path to the Chrome binary (e.g. /Applications/Google Chrome.app/Contents/MacOS/Google Chrome) or unset the override to let bdg auto-detect Chrome.'
  );
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
  return joinLines(
    'Warning: No Chrome PID found in cache',
    '   Either Chrome was already running, or no Chrome was launched by bdg\n'
  );
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
  return joinLines(
    `Error: Failed to kill Chrome process: ${error}`,
    '   Try manually killing Chrome processes if issues persist\n'
  );
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
