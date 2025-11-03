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

import { EXIT_CODES } from '@/utils/exitCodes.js';
import {
  cleanupStaleSession,
  getDaemonPidPath,
  getDaemonSocketPath,
  isProcessAlive,
} from '@/utils/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Launch the daemon worker process.
 *
 * This function:
 * 1. Cleans up any stale session files
 * 2. Checks if a daemon is already running
 * 3. Spawns the daemon worker
 * 4. Waits for it to become ready
 *
 * @returns The spawned child process
 * @throws Error if daemon fails to start or is already running
 */
export async function launchDaemon(): Promise<ChildProcess> {
  // Clean up stale session files first
  console.error('[launcher] Checking for stale session files...');
  const cleaned = await cleanupStaleSession();
  if (cleaned) {
    console.error('[launcher] Cleaned up stale session files');
  }

  // Check if daemon is already running
  const daemonPidPath = getDaemonPidPath();
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
  // In development: src/daemon.ts
  // In production: dist/daemon.js
  const daemonScriptPath = join(__dirname, '..', '..', 'dist', 'daemon.js');

  if (!fs.existsSync(daemonScriptPath)) {
    throw new Error(`Daemon script not found at ${daemonScriptPath}. Did you run 'npm run build'?`);
  }

  console.error(`[launcher] Starting daemon: ${daemonScriptPath}`);

  // Spawn the daemon worker
  const daemon = spawn('node', [daemonScriptPath], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      BDG_DAEMON: '1', // Mark as daemon worker
    },
  });

  // Capture logs for debugging
  daemon.stdout?.on('data', (data: Buffer) => {
    console.error(`[daemon stdout] ${data.toString('utf-8').trim()}`);
  });

  daemon.stderr?.on('data', (data: Buffer) => {
    console.error(`[daemon stderr] ${data.toString('utf-8').trim()}`);
  });

  daemon.on('error', (error) => {
    console.error('[daemon] Spawn error:', error);
  });

  daemon.on('exit', (code, signal) => {
    console.error(`[daemon] Exited with code ${code}, signal ${signal}`);
  });

  // Detach the daemon so it continues running after parent exits
  daemon.unref();

  // Wait for daemon to be ready (socket file exists)
  console.error('[launcher] Waiting for daemon to be ready...');
  const socketPath = getDaemonSocketPath();
  const maxWaitMs = 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (fs.existsSync(socketPath)) {
      console.error('[launcher] Daemon is ready');
      return daemon;
    }

    // Wait 100ms before checking again
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Timeout - daemon failed to start
  daemon.kill();
  throw new Error('Daemon failed to start within 5 seconds');
}

/**
 * Check if the daemon is currently running.
 *
 * @returns True if daemon is running, false otherwise
 */
export function isDaemonRunning(): boolean {
  const daemonPidPath = getDaemonPidPath();

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
