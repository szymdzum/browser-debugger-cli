/**
 * Cross-platform process management utilities.
 *
 * Pure utility functions for process operations - no dependencies on domain modules.
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
    process.kill(pid, 0);
    return true;
  } catch {
    if (process.platform === 'win32') {
      const result = spawnSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        shell: true,
        encoding: 'utf-8',
      });
      if (result.error) return false;
      const out = (result.stdout || '').trim();
      return out.length > 0 && !/No tasks/i.test(out);
    }
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
    const result = spawnSync(`taskkill /pid ${pid} /T /F`, {
      shell: true,
      encoding: 'utf-8',
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0 && result.status !== null) {
      const errorMsg = (result.stderr ?? result.stdout).trim() || 'Unknown error';
      throw new Error(taskkillFailedError(result.status, errorMsg));
    }

    if (result.stderr?.trim()) {
      console.error(taskkillStderr(result.stderr.trim()));
    }
  } else {
    try {
      process.kill(-pid, signal);
    } catch {
      process.kill(pid, signal);
    }
  }
}
