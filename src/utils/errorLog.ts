/**
 * Error logging utility for debugging bdg command failures.
 *
 * Logs errors to /tmp/browser-debugger-errors.log for post-mortem analysis.
 */

import { appendFileSync } from 'node:fs';

const ERROR_LOG_PATH = '/tmp/browser-debugger-errors.log';

/**
 * Log an error to the error log file.
 *
 * @param command - The command that was run (from process.argv)
 * @param error - The error message or Error object
 * @param exitCode - The exit code that will be used
 */
export function logError(command: string[], error: string | Error, exitCode: number): void {
  try {
    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;

    const entry = [
      `[${timestamp}] exit=${exitCode}`,
      `cmd: ${command.slice(2).join(' ')}`,
      `error: ${errorMessage}`,
      ...(stack ? [`stack: ${stack}`] : []),
      '---',
    ].join('\n');

    appendFileSync(ERROR_LOG_PATH, entry + '\n');
  } catch {
    // Silently ignore logging failures
  }
}
