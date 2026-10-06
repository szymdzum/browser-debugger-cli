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
import { join } from 'path';

import { DaemonStartupError, SessionDirError } from '@/daemon/errors.js';
import {
  sessionDirIsFileError,
  sessionDirNotWritableError,
  socketPathTooLongError,
} from '@/errors/messages.js';
import { isDaemonAlive } from '@/session/daemonSocket.js';
import {
  MAX_DAEMON_SOCKET_PATH_BYTES,
  ensureSessionDir,
  getSessionDir,
  getSessionFilePath,
} from '@/session/paths.js';
import { createLogger } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';
import { directoryProblem } from '@/utils/directories.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { DAEMON_SCRIPT_PATH } from '@/utils/packageRoot.js';

const log = createLogger('launcher');

const DAEMON_READY_TIMEOUT_MS = 5000;
const DAEMON_READY_POLL_MS = 20;

/** A daemon this process spawned */
export interface SpawnedDaemon {
  pid: number | undefined;
  /** Whether it has exited (from the child process's exit event) */
  hasExited: () => boolean;
}

/**
 * Ensure a daemon is running, spawning one if needed.
 *
 * @returns The daemon it spawned, or undefined when one was already running
 * @throws DaemonStartupError if the daemon script is missing or the daemon
 *   does not accept connections in time
 */
export async function launchDaemon(): Promise<SpawnedDaemon | undefined> {
  if (await isDaemonAlive()) {
    log.debug('Daemon already running');
    return undefined;
  }

  if (!fs.existsSync(DAEMON_SCRIPT_PATH)) {
    throw new DaemonStartupError(
      `Daemon script not found at ${DAEMON_SCRIPT_PATH}. Did you run 'npm run build'?`,
      'DAEMON_SCRIPT_NOT_FOUND'
    );
  }

  assertUsableSessionDir();
  const logPath = join(getSessionDir(), 'daemon.log');
  rotateLog(logPath);
  const logFd = fs.openSync(logPath, 'a');
  log.debug(`Starting daemon: ${DAEMON_SCRIPT_PATH}`);
  const daemon = spawn(process.execPath, [DAEMON_SCRIPT_PATH], {
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
  return { pid: daemon.pid, hasExited: () => exited };
}

/**
 * Check that the session directory can hold the daemon's files before
 * spawning it (otherwise the daemon dies and only its log says why).
 *
 * @throws SessionDirError (103) for a file or a path that cannot hold a
 *   directory (a pseudo-filesystem like `/proc`), (81) for a too-long path
 *   like a named session's, (82) when not writable
 */
export function assertUsableSessionDir(): void {
  const dir = getSessionDir();
  const fail = (err: { message: string; suggestion: string }, exitCode?: number): never => {
    throw new SessionDirError(err.message, err.suggestion, exitCode);
  };
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) fail(sessionDirIsFileError(dir));
  const socketPath = getSessionFilePath('DAEMON_SOCKET');
  if (Buffer.byteLength(socketPath) > MAX_DAEMON_SOCKET_PATH_BYTES) {
    fail(
      socketPathTooLongError(socketPath, MAX_DAEMON_SOCKET_PATH_BYTES),
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const problem = directoryProblem(dir);
  if (problem) {
    fail(
      sessionDirNotWritableError(dir, problem.reason),
      problem.denied ? EXIT_CODES.PERMISSION_DENIED : EXIT_CODES.SESSION_FILE_ERROR
    );
  }
  try {
    ensureSessionDir();
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const denied = code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
    fail(
      sessionDirNotWritableError(dir, code ?? getErrorMessage(error)),
      denied ? EXIT_CODES.PERMISSION_DENIED : EXIT_CODES.SESSION_FILE_ERROR
    );
  }
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
