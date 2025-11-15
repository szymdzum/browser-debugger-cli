/**
 * Process management utilities for checking process liveness and killing processes.
 *
 * WHY: Centralized cross-platform process operations for session management.
 */

import { spawnSync } from 'child_process';

import { taskkillStderr, taskkillFailedError } from '@/ui/messages/internal.js';

/**
 * Check if a process with the given PID is alive.
 *
 * Uses signal 0 to check process existence without sending an actual signal.
 * On Windows, falls back to tasklist when the signal check fails.
 *
 * @param pid - Process ID to check
 * @returns True if process is running, false otherwise
 *
 * @example
 * ```typescript
 * if (isProcessAlive(12345)) {
 *   console.log('Process is still running');
 * }
 * ```
 */
export function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without actually sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    if (process.platform === 'win32') {
      // Fallback: check tasklist for the PID
      const result = spawnSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        shell: true,
        encoding: 'utf-8',
      });
      if (result.error) return false;
      const out = (result.stdout || '').trim();
      // If a line is returned and not 'INFO: No tasks...' assume process exists
      return out.length > 0 && !/No tasks/i.test(out);
    }
    // ESRCH error means process doesn't exist
    return false;
  }
}

/**
 * Kill a Chrome process using cross-platform approach.
 *
 * Windows: Uses `taskkill /pid <pid> /T /F` to kill process tree
 * Unix/macOS: Tries to kill process group (-pid). If that fails, falls back to killing the PID.
 *
 * WHY: Chrome spawns multiple child processes. We need to kill the entire process tree.
 *
 * @param pid - Chrome process ID to kill
 * @param signal - Signal to send (Unix only, default 'SIGTERM'). Ignored on Windows.
 * @throws Error if kill operation fails
 *
 * @example
 * ```typescript
 * try {
 *   killChromeProcess(chromePid, 'SIGKILL'); // Force kill
 * } catch (error) {
 *   console.error('Failed to kill Chrome:', error);
 * }
 * ```
 */
export function killChromeProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    // Windows: Use taskkill to kill process tree
    // /T = kill process tree, /F = force kill
    const result = spawnSync(`taskkill /pid ${pid} /T /F`, {
      shell: true,
      encoding: 'utf-8',
    });

    // Check for spawn errors (command not found, etc.)
    if (result.error) {
      throw result.error;
    }

    // Check exit status - taskkill returns non-zero on failure
    // Common exit codes:
    // - 0: Success
    // - 128: Process not found
    // - 1: Access denied or other error
    if (result.status !== 0 && result.status !== null) {
      const errorMsg = (result.stderr ?? result.stdout).trim() || 'Unknown error';
      throw new Error(taskkillFailedError(result.status, errorMsg));
    }

    // Log stderr for debugging (taskkill sometimes writes to stderr even on success)
    if (result.stderr?.trim()) {
      console.error(taskkillStderr(result.stderr.trim()));
    }
  } else {
    // Unix/macOS: Prefer killing the process group (negative PID) to include children
    try {
      process.kill(-pid, signal);
    } catch {
      // Fall back to killing just the PID
      process.kill(pid, signal);
    }
  }
}
