/**
 * Port claims across concurrent sessions.
 *
 * Sessions started at the same time must not pick the same CDP port: Chrome
 * binds it only after the choice is made. A session claims its port by
 * writing `port.txt` while holding a lock shared by all sessions under the
 * same base directory; a running session's claim is skipped by the others.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  getSessionBaseDir,
  getSessionDir,
  listSessionDirs,
  sessionFilePathIn,
} from '@/session/paths.js';
import { createLogger, logDebugError } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';

const log = createLogger('session');

/** Lock file guarding port selection, in the base session directory */
const PORT_LOCK_FILE = 'port.lock';

/** How long to wait for the lock before choosing a port without it */
const LOCK_WAIT_MS = 5000;

/** Lock age after which its holder is assumed dead */
const STALE_LOCK_MS = 10000;

const LOCK_POLL_MS = 25;

/**
 * Read a port number from a `port.txt` file.
 *
 * @param portPath - File path
 * @returns Port, or null if missing or invalid
 */
export function readPortFile(portPath: string): number | null {
  try {
    const port = parseInt(fs.readFileSync(portPath, 'utf-8').trim(), 10);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
  } catch (error) {
    logDebugError(log, `read ${portPath}`, error);
    return null;
  }
}

/**
 * Ports claimed by other sessions that are running or starting (their daemon
 * socket exists).
 *
 * @returns Claimed ports
 */
export function portsClaimedByOtherSessions(): Set<number> {
  const ownDir = getSessionDir();
  const ports = listSessionDirs()
    .filter(({ dir }) => dir !== ownDir)
    .filter(({ dir }) => fs.existsSync(sessionFilePathIn(dir, 'DAEMON_SOCKET')))
    .map(({ dir }) => readPortFile(sessionFilePathIn(dir, 'PORT')));
  return new Set(ports.filter((port): port is number => port !== null));
}

/**
 * Take the port-selection lock.
 *
 * @param lockPath - Lock file path
 * @param token - Written into the lock so only its owner removes it
 * @returns True if the lock was taken; false after {@link LOCK_WAIT_MS} or
 *   when the lock file cannot be created
 */
async function acquireLock(lockPath: string, token: string): Promise<boolean> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(lockPath, token, { flag: 'wx' });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        logDebugError(log, 'take the port lock', error);
        return false;
      }
      removeStaleLock(lockPath);
      await delay(LOCK_POLL_MS);
    }
  }
  return false;
}

/**
 * Remove a lock left by a process that died while holding it. The lock is
 * moved aside first (only one waiter's rename succeeds); if another process
 * took a fresh lock in the meantime, that one is put back.
 *
 * @param lockPath - Lock file path
 */
function removeStaleLock(lockPath: string): void {
  try {
    if (Date.now() - fs.statSync(lockPath).mtimeMs <= STALE_LOCK_MS) return;
    const staleOwner = fs.readFileSync(lockPath, 'utf8');
    const moved = `${lockPath}.${process.pid}.stale`;
    fs.renameSync(lockPath, moved);
    if (fs.readFileSync(moved, 'utf8') !== staleOwner) fs.linkSync(moved, lockPath);
    fs.rmSync(moved, { force: true });
  } catch (error) {
    logDebugError(log, 'check the port lock', error);
  }
}

/**
 * Release the lock if it is still ours (it may have been taken over as stale).
 *
 * @param lockPath - Lock file path
 * @param token - The token written when the lock was taken
 */
function releaseLock(lockPath: string, token: string): void {
  try {
    if (fs.readFileSync(lockPath, 'utf8') === token) fs.rmSync(lockPath, { force: true });
  } catch (error) {
    logDebugError(log, 'release the port lock', error);
  }
}

/**
 * Run port selection under the lock shared by all sessions of the base
 * directory. If the lock cannot be taken in time, the selection runs anyway.
 *
 * @param select - Chooses and records the port
 * @returns The chosen port
 */
export async function withPortLock(select: () => Promise<number>): Promise<number> {
  const baseDir = getSessionBaseDir();
  fs.mkdirSync(baseDir, { recursive: true });
  const lockPath = path.join(baseDir, PORT_LOCK_FILE);
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const locked = await acquireLock(lockPath, token);
  if (!locked) log.debug('Port lock busy; choosing a port without it');
  try {
    return await select();
  } finally {
    if (locked) releaseLock(lockPath, token);
  }
}
