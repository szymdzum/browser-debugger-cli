/**
 * Daemon launcher.
 *
 * Spawns the daemon process for `bdg <url>` and waits until its socket accepts
 * connections. Single-instance enforcement lives in the daemon itself (see
 * SocketServer), so concurrent launches are safe: a losing daemon exits and
 * the CLI talks to the winner.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { DaemonStartupError } from '@/daemon/errors.js';
import { isDaemonAlive } from '@/session/daemonSocket.js';
import { ensureSessionDir, getSessionDir } from '@/session/paths.js';
import { createLogger } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('launcher');

const DAEMON_READY_TIMEOUT_MS = 5000;
const DAEMON_READY_POLL_MS = 100;

/**
 * Ensure a daemon is running, spawning one if needed.
 *
 * @throws DaemonStartupError if the daemon script is missing or the daemon
 *   does not accept connections in time
 */
export async function launchDaemon(): Promise<void> {
  if (await isDaemonAlive()) {
    log.debug('Daemon already running');
    return;
  }

  const daemonScriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'daemon.js');
  if (!fs.existsSync(daemonScriptPath)) {
    throw new DaemonStartupError(
      `Daemon script not found at ${daemonScriptPath}. Did you run 'npm run build'?`,
      'DAEMON_SCRIPT_NOT_FOUND'
    );
  }

  ensureSessionDir();
  const logPath = join(getSessionDir(), 'daemon.log');
  rotateLog(logPath);
  const logFd = fs.openSync(logPath, 'a');
  log.debug(`Starting daemon: ${daemonScriptPath}`);
  const daemon = spawn(process.execPath, [daemonScriptPath], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);

  let exited = false;
  daemon.once('exit', () => {
    exited = true;
  });
  daemon.unref();

  await waitForDaemonReady(() => exited);
}

/** Size above which the daemon log is rotated when a daemon starts */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/**
 * Keep the daemon log from growing without bound: a log over
 * {@link MAX_LOG_BYTES} becomes `daemon.log.1` (replacing an older one).
 *
 * @param logPath - Path of the daemon log
 */
function rotateLog(logPath: string): void {
  try {
    if (fs.statSync(logPath).size > MAX_LOG_BYTES) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
  } catch (error) {
    log.debug(`Daemon log not rotated: ${getErrorMessage(error)}`);
  }
}

/**
 * Poll the daemon socket until it accepts connections.
 *
 * A spawned daemon that exits early may have lost a single-instance race to
 * another daemon; in that case the winner's socket satisfies the wait.
 *
 * @param hasExited - Whether the spawned daemon process has exited
 * @throws DaemonStartupError if no daemon becomes reachable in time
 */
async function waitForDaemonReady(hasExited: () => boolean): Promise<void> {
  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isDaemonAlive()) {
      log.debug('Daemon is ready');
      return;
    }
    if (hasExited() && !(await isDaemonAlive())) {
      throw new DaemonStartupError(
        `Daemon exited during startup. See ${join(getSessionDir(), 'daemon.log')}`,
        'DAEMON_EXITED'
      );
    }
    await delay(DAEMON_READY_POLL_MS);
  }
  throw new DaemonStartupError(
    `Daemon failed to start within ${DAEMON_READY_TIMEOUT_MS / 1000} seconds`,
    'DAEMON_START_TIMEOUT'
  );
}
