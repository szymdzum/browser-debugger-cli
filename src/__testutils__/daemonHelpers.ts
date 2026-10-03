/**
 * Daemon helpers for smoke tests.
 *
 * Everything here is scoped to the isolated test session directory
 * (`BDG_SESSION_DIR`, see testHome.ts). Helpers never touch processes or
 * ports outside that directory, so running smoke tests locally cannot kill
 * the developer's own bdg sessions or Chrome instances.
 */

import * as fs from 'fs';
import * as net from 'net';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { getSessionFilePath } from '@/session/paths.js';
import { isProcessAlive } from '@/utils/process.js';

import { ensureTestSessionDir } from './testHome.js';

ensureTestSessionDir();

const SOCKET_PROBE_TIMEOUT_MS = 500;
const PROCESS_EXIT_TIMEOUT_MS = 5000;

/**
 * Check whether the test daemon accepts connections on its socket.
 *
 * @returns True if a connection to the daemon socket succeeds
 */
export async function isDaemonRunning(): Promise<boolean> {
  const socketPath = getSessionFilePath('DAEMON_SOCKET');
  if (!fs.existsSync(socketPath)) {
    return false;
  }
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, SOCKET_PROBE_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Read the Chrome PID recorded for the test session.
 *
 * @returns Chrome PID from session metadata, or null if unavailable
 */
export function readTestChromePid(): number | null {
  try {
    const raw = fs.readFileSync(getSessionFilePath('METADATA'), 'utf-8');
    const pid = (JSON.parse(raw) as { chromePid?: unknown }).chromePid;
    return typeof pid === 'number' && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Read a positive PID from a file in the test session directory.
 *
 * @param filePath - PID file path
 * @returns PID, or null if missing or invalid
 */
function readPositivePid(filePath: string): number | null {
  try {
    const pid = parseInt(fs.readFileSync(filePath, 'utf-8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Wait until a process exits.
 *
 * @param pid - Process ID
 * @param timeoutMs - Maximum time to wait
 * @returns True if the process is gone
 */
export async function waitForProcessExit(
  pid: number,
  timeoutMs: number = PROCESS_EXIT_TIMEOUT_MS
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessAlive(pid);
}

/**
 * SIGKILL a process if it is alive.
 *
 * @param pid - Process ID
 */
function killIfAlive(pid: number): void {
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return;
  }
}

/**
 * Tear down whatever the test session left behind.
 *
 * Tries a graceful `bdg stop` first, then SIGKILLs only the processes recorded
 * in the test session directory, and finally removes session state files.
 */
export async function cleanupAllSessions(): Promise<void> {
  if (await isDaemonRunning()) {
    await runCommand('stop', ['--kill-chrome'], { timeout: 15000 });
  }

  const pids = [
    readPositivePid(getSessionFilePath('DAEMON_PID')),
    readPositivePid(getSessionFilePath('CHROME_PID')),
    readTestChromePid(),
  ];
  const livePids = pids.filter((pid): pid is number => pid !== null);
  livePids.forEach(killIfAlive);
  await Promise.all(livePids.map((pid) => waitForProcessExit(pid)));

  const files = ['DAEMON_PID', 'DAEMON_SOCKET', 'METADATA', 'CHROME_PID'] as const;
  for (const file of files) {
    fs.rmSync(getSessionFilePath(file), { force: true });
  }
}
