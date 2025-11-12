/**
 * Daemon helper utilities for smoke tests.
 *
 * Provides functions to check daemon status and manage session state.
 * WHY: Enables testing daemon lifecycle without exposing internals.
 */

import * as fs from 'fs';

import { getSessionFilePath } from '@/session/paths.js';
import { readPid } from '@/session/pid.js';
import { isProcessAlive } from '@/session/process.js';

/**
 * Check if daemon is currently running.
 *
 * @returns True if daemon process is alive
 *
 * @example
 * ```typescript
 * await runCommand('http://localhost:3000', []);
 * assert.ok(await isDaemonRunning());
 * ```
 */
export function isDaemonRunning(): boolean {
  try {
    const daemonPidPath = getSessionFilePath('DAEMON_PID');

    if (!fs.existsSync(daemonPidPath)) {
      return false;
    }

    const pidStr = fs.readFileSync(daemonPidPath, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      return false;
    }

    return isProcessAlive(pid);
  } catch {
    return false;
  }
}

/**
 * Check if session is currently active.
 *
 * @returns True if session process is alive
 *
 * @example
 * ```typescript
 * await runCommand('http://localhost:3000', []);
 * assert.ok(await isSessionActive());
 * ```
 */
export function isSessionActive(): boolean {
  try {
    const sessionPid = readPid();

    if (sessionPid === null) {
      return false;
    }

    return isProcessAlive(sessionPid);
  } catch {
    return false;
  }
}

/**
 * Kill daemon process forcefully.
 *
 * @param signal - Kill signal (default: SIGTERM)
 *
 * @example
 * ```typescript
 * await killDaemon('SIGKILL'); // Simulate crash
 * ```
 */
export async function killDaemon(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  const daemonPidPath = getSessionFilePath('DAEMON_PID');

  if (!fs.existsSync(daemonPidPath)) {
    return;
  }

  const pidStr = fs.readFileSync(daemonPidPath, 'utf-8').trim();
  const pid = parseInt(pidStr, 10);

  if (!isNaN(pid) && isProcessAlive(pid)) {
    process.kill(pid, signal);

    // Wait for process to die
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (!isProcessAlive(pid)) {
          clearInterval(check);
          resolve(undefined);
        }
      }, 100);

      // Timeout after 5s
      setTimeout(() => {
        clearInterval(check);
        resolve(undefined);
      }, 5000);
    });
  }
}

/**
 * Clean up all session files forcefully.
 *
 * WHY: Ensures clean state between tests.
 *
 * @example
 * ```typescript
 * afterEach(async () => {
 *   await cleanupAllSessions();
 * });
 * ```
 */
export async function cleanupAllSessions(): Promise<void> {
  // Kill daemon if running
  await killDaemon('SIGKILL');

  // Kill Chrome on port 9222 (default port used by tests)
  try {
    const { execSync } = await import('child_process');
    execSync('lsof -ti:9222 | xargs kill -9 2>/dev/null || true', { stdio: 'ignore' });
  } catch {
    // Ignore errors if no process on port
  }

  // Wait for processes to fully die
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Remove all session files
  const files = [
    'DAEMON_PID',
    'DAEMON_SOCKET',
    'DAEMON_LOCK',
    'PID',
    'LOCK',
    'METADATA',
    'OUTPUT',
  ] as const;

  for (const file of files) {
    try {
      const filePath = getSessionFilePath(file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Read session output file.
 *
 * @returns Parsed session output or null if not exists
 *
 * @example
 * ```typescript
 * await runCommand('stop', []);
 * const output = readSessionOutput();
 * assert.equal(output.success, true);
 * ```
 */
export function readSessionOutput(): unknown {
  try {
    const outputPath = getSessionFilePath('OUTPUT');

    if (!fs.existsSync(outputPath)) {
      return null;
    }

    const content = fs.readFileSync(outputPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Wait for daemon to start (with timeout).
 *
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns True if daemon started, false if timeout
 *
 * @example
 * ```typescript
 * runCommand('start', ['http://localhost:3000']); // Don't await
 * assert.ok(await waitForDaemon(5000));
 * ```
 */
export async function waitForDaemon(timeoutMs: number = 5000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (isDaemonRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}
