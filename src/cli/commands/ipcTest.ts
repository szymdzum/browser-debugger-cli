/**
 * IPC Test Command - Minimal handshake MVP
 *
 * Tests IPC communication between CLI client and daemon server.
 * Ensures daemon is running, performs handshake, and prints response.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { connect as connectSocket } from 'node:net';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Command } from 'commander';

import { IPCServer } from '@/daemon/ipcServer.js';
import { connectToDaemon } from '@/ipc/client.js';
import { cleanupStaleSession } from '@/session/cleanup.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DAEMON_SCRIPT = join(__dirname, '..', '..', 'daemon.js');
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
const DEFAULT_WAIT_POLL_MS = 100;

/**
 * Resolve the absolute daemon entry point path.
 */
export function resolveDaemonEntryPoint(): string {
  if (!isAbsolute(DAEMON_SCRIPT)) {
    throw new Error(`Resolved daemon entry point is not absolute: ${DAEMON_SCRIPT}`);
  }
  return DAEMON_SCRIPT;
}

/**
 * Wait for a Unix domain socket to become available.
 */
export async function waitForSocket(
  socketPath: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_WAIT_POLL_MS;
  const start = Date.now();

  while (true) {
    try {
      await attemptConnect(socketPath);
      return;
    } catch (error) {
      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) {
        const details =
          error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown';
        throw new Error(
          `Socket "${socketPath}" not ready within ${timeoutMs}ms (last error: ${details})`
        );
      }

      await delay(pollIntervalMs);
    }
  }
}

async function attemptConnect(socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connectSocket(socketPath);

    const handleError = (err: unknown): void => {
      socket.destroy();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    socket.once('error', handleError);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Register the ipc-test command for IPC handshake testing.
 */
export function registerIpcTestCommand(program: Command): void {
  program
    .command('ipc-test')
    .description('Test IPC handshake with daemon (MVP)')
    .action(async () => {
      try {
        console.error('[ipc-test] Starting IPC handshake test...');

        // Clean up any stale session files before starting
        console.error('[ipc-test] Checking for stale session files...');
        const cleaned = cleanupStaleSession();
        if (cleaned) {
          console.error('[ipc-test] Cleaned up stale session files');
        } else {
          console.error('[ipc-test] No stale files to clean');
        }

        // Ensure daemon is running
        if (!IPCServer.isRunning()) {
          console.error('[ipc-test] Daemon not running, starting it...');
          await startDaemon();
        } else {
          console.error('[ipc-test] Daemon already running');
        }

        // Perform handshake
        console.error('[ipc-test] Connecting to daemon...');
        const response = await connectToDaemon();

        // Print response
        console.log(JSON.stringify(response, null, 2));

        if (response.status === 'ok') {
          console.error('[ipc-test] Handshake successful!');
          process.exit(EXIT_CODES.SUCCESS);
        } else {
          console.error('[ipc-test] Handshake failed:', response.message);
          process.exit(EXIT_CODES.GENERIC_FAILURE);
        }
      } catch (error) {
        console.error('[ipc-test] Error:', error);
        process.exit(EXIT_CODES.GENERIC_FAILURE);
      }
    });
}

/**
 * Start the daemon process in the background.
 *
 * Uses import.meta.url to resolve daemon script path correctly
 * regardless of current working directory.
 */
async function startDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    let daemon: ChildProcess;

    try {
      const entryPoint = resolveDaemonEntryPoint();
      console.error(`[ipc-test] Starting daemon: ${process.execPath} ${entryPoint}`);

      // Spawn daemon process with absolute script path
      daemon = spawn(process.execPath, [entryPoint], {
        detached: true,
        stdio: 'ignore',
      });

      daemon.unref();
    } catch (err) {
      reject(
        new Error(`Failed to spawn daemon: ${err instanceof Error ? err.message : String(err)}`)
      );
      return;
    }

    const socketPath = IPCServer.getSocketPath();
    let settled = false;

    const cleanup = (): void => {
      daemon.off('error', onError);
      daemon.off('exit', onExit);
    };

    const onError = (err: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Daemon process error: ${err.message}`));
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `Daemon exited unexpectedly (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`
        )
      );
    };

    daemon.once('error', onError);
    daemon.once('exit', onExit);

    waitForSocket(socketPath, {
      timeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
      pollIntervalMs: DEFAULT_WAIT_POLL_MS,
    })
      .then(() => {
        if (settled) return;
        settled = true;
        cleanup();
        console.error('[ipc-test] Daemon socket ready');
        resolve();
      })
      .catch((error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}
