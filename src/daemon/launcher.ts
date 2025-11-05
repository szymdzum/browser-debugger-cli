/**
 * Daemon Launcher - Spawns and manages the daemon process
 *
 * This module handles:
 * - Spawning the daemon worker process
 * - Waiting for the handshake to complete
 * - Capturing daemon logs
 * - Ensuring only one daemon runs at a time
 */

import { spawn } from 'child_process';
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import type { ChildProcess } from 'child_process';

import { cleanupStaleSession } from '@/session/cleanup.js';
import { acquireDaemonLock, releaseDaemonLock } from '@/session/lock.js';
import { getSessionFilePath } from '@/session/paths.js';
import { isProcessAlive } from '@/session/process.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { createLogger } from '@/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const log = createLogger('launcher');

/**
 * Launch the daemon worker process.
 *
 * This function:
 * 1. Acquires daemon lock atomically (prevents concurrent daemon starts)
 * 2. Cleans up any stale session files
 * 3. Checks if a daemon is already running
 * 4. Spawns the daemon worker
 * 5. Waits for it to become ready
 *
 * @returns The spawned child process
 * @throws Error if daemon fails to start or is already running
 */
export async function launchDaemon(): Promise<ChildProcess> {
  // Acquire daemon lock atomically to prevent concurrent daemon starts (P0 Fix #1)
  log.debug('Acquiring daemon lock...');
  if (!acquireDaemonLock()) {
    const error = new Error(
      'Daemon startup already in progress. Wait a moment and try again.'
    ) as Error & { code: string; exitCode: number };
    error.code = 'DAEMON_STARTUP_IN_PROGRESS';
    error.exitCode = EXIT_CODES.DAEMON_ALREADY_RUNNING;
    throw error;
  }

  try {
    // Clean up stale session files first
    log.debug('Checking for stale session files...');
    const cleaned = cleanupStaleSession();
    if (cleaned) {
      log.debug('Cleaned up stale session files');
    }

    // Check if daemon is already running
    const daemonPidPath = getSessionFilePath('DAEMON_PID');
    if (fs.existsSync(daemonPidPath)) {
      try {
        const pidStr = fs.readFileSync(daemonPidPath, 'utf-8').trim();
        const pid = parseInt(pidStr, 10);

        if (!isNaN(pid) && isProcessAlive(pid)) {
          const error = new Error(
            `Daemon already running (PID ${pid}). Use 'bdg stop' to stop it.`
          ) as Error & { code: string; exitCode: number };
          error.code = 'DAEMON_ALREADY_RUNNING';
          error.exitCode = EXIT_CODES.DAEMON_ALREADY_RUNNING;
          throw error;
        }
      } catch (error: unknown) {
        // If it's our "already running" error, re-throw it
        if (
          error instanceof Error &&
          'code' in error &&
          (error as Error & { code?: string }).code === 'DAEMON_ALREADY_RUNNING'
        ) {
          throw error;
        }
        // Otherwise ignore read errors, will clean up below
      }
    }

    // Determine the daemon script path
    // When running from dist/daemon/launcher.js, __dirname is dist/daemon/
    // So we go up one level to dist/, then to daemon.js
    const daemonScriptPath = join(__dirname, '..', 'daemon.js');

    if (!fs.existsSync(daemonScriptPath)) {
      throw new Error(
        `Daemon script not found at ${daemonScriptPath}. Did you run 'npm run build'?`
      );
    }

    log.debug(`Starting daemon: ${daemonScriptPath}`);

    // Spawn the daemon worker
    const daemon = spawn('node', [daemonScriptPath], {
      detached: true,
      stdio: 'ignore', // Fully detached - daemon must not depend on parent's stdio
      env: {
        ...process.env,
        BDG_DAEMON: '1', // Mark as daemon worker
      },
    });

    // Note: No stdio pipes to avoid SIGPIPE when CLI exits
    // Daemon logs go to daemon's own stderr (can be captured separately if needed)

    // Detach the daemon so it continues running after parent exits
    daemon.unref();

    // Wait for daemon to be ready (socket file exists)
    log.debug('Waiting for daemon to be ready...');
    const socketPath = getSessionFilePath('DAEMON_SOCKET');
    const maxWaitMs = 5000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      if (fs.existsSync(socketPath)) {
        log.debug('Daemon is ready');
        // Note: Keep daemon lock held - daemon will release it when it writes its PID
        return daemon;
      }

      // Wait 100ms before checking again
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Timeout - daemon failed to start
    daemon.kill();
    throw new Error('Daemon failed to start within 5 seconds');
  } catch (error) {
    // Release lock on any error
    releaseDaemonLock();
    throw error;
  }
}

/**
 * Check if the daemon is currently running.
 *
 * @returns True if daemon is running, false otherwise
 */
export function isDaemonRunning(): boolean {
  const daemonPidPath = getSessionFilePath('DAEMON_PID');

  if (!fs.existsSync(daemonPidPath)) {
    return false;
  }

  try {
    const pidStr = fs.readFileSync(daemonPidPath, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    return !isNaN(pid) && isProcessAlive(pid);
  } catch {
    return false;
  }
}
