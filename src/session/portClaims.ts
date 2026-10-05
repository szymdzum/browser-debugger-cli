/**
 * Port claims across concurrent sessions.
 *
 * Sessions started at the same time must not pick the same CDP port: Chrome
 * binds it only after the choice is made. A session claims its port by
 * writing `port.txt` while holding a lock; a running session's claim is
 * skipped by the others.
 *
 * Ports belong to the machine, not to a session directory, so the lock and a
 * registry of claiming session directories live in one directory per user
 * under the OS temp directory: sessions of different `BDG_SESSION_DIR`s see
 * each other's claims too. That directory is used only if it is a real
 * directory owned by the user that nobody else can write to; otherwise the
 * lock falls back to the base session directory and only that directory's
 * claims are seen (the launched Chrome's identity is still checked).
 */

import * as fs from 'fs';
import * as os from 'os';
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

/** Lock file guarding port selection, in the port registry (or base session) directory */
const PORT_LOCK_FILE = 'port.lock';

/** Subdirectory of the port registry: one file per claimed port, holding the claiming session directory */
const CLAIMS_DIR = 'claims';

/** Overrides the port registry directory (tests) */
const PORT_REGISTRY_DIR_ENV = 'BDG_PORT_REGISTRY_DIR';

/** How long to wait for the lock before choosing a port without it */
const LOCK_WAIT_MS = 5000;

/** Lock age after which its holder is assumed dead */
const STALE_LOCK_MS = 10000;

const LOCK_POLL_MS = 25;

/** Permission bits that let other users write */
const GROUP_OTHER_WRITE = 0o022;

/** Records a port claim; a no-op when the registry cannot be used safely */
export type RecordPortClaim = (port: number) => void;

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
 * Directory holding the port lock and the claims registry, shared by every
 * session of the user on this machine.
 *
 * @returns `$BDG_PORT_REGISTRY_DIR`, else `<os temp dir>/bdg-ports-<uid>`
 */
export function getPortRegistryDir(): string {
  const override = process.env[PORT_REGISTRY_DIR_ENV]?.trim();
  if (override) return path.resolve(override);
  const uid = process.getuid?.();
  return path.join(os.tmpdir(), uid === undefined ? 'bdg-ports' : `bdg-ports-${uid}`);
}

/**
 * Whether a path is a directory the current user can trust: a real directory
 * (not a symlink), owned by the user, not writable by group or others.
 *
 * @param dir - Directory
 * @returns Why it cannot be trusted, or null if it can
 */
export function untrustedDirReason(dir: string): string | null {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory()) return 'not a directory';
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) return `owned by uid ${stat.uid}`;
  if (process.platform !== 'win32' && (stat.mode & GROUP_OTHER_WRITE) !== 0) {
    return `writable by others (mode ${(stat.mode & 0o777).toString(8)})`;
  }
  return null;
}

/**
 * The port registry directory, created (mode 0700) if missing, if it can be
 * trusted (see {@link untrustedDirReason}).
 *
 * @param create - Create the directory (and its claims subdirectory) if missing
 * @returns The directory, or null if it is missing or untrusted
 */
function trustedRegistryDir(create: boolean): string | null {
  const dir = getPortRegistryDir();
  try {
    if (create) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      fs.mkdirSync(path.join(dir, CLAIMS_DIR), { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(dir)) return null;
    const reason = untrustedDirReason(dir) ?? untrustedDirReason(path.join(dir, CLAIMS_DIR));
    if (reason === null) return dir;
    log.info(`Not using the port registry ${dir} (${reason}); port claims are per directory`);
  } catch (error) {
    logDebugError(log, `use the port registry ${dir}`, error);
  }
  return null;
}

/**
 * Record in the registry that this session directory claims a port. Written
 * to a new temporary file that is renamed into place, so no symlink is
 * followed. The claim holds while that session runs and its `port.txt` names
 * the port; it needs no removal.
 *
 * @param registryDir - Trusted registry directory
 * @param port - Claimed port
 */
function writePortClaim(registryDir: string, port: number): void {
  const claimPath = path.join(registryDir, CLAIMS_DIR, String(port));
  const tempPath = `${claimPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempPath, getSessionDir(), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(tempPath, claimPath);
  } catch (error) {
    logDebugError(log, `record the claim of port ${port}`, error);
    fs.rmSync(tempPath, { force: true });
  }
}

/**
 * Session directories in the registry (any base directory).
 *
 * @returns Claiming session directories; none if the registry is untrusted
 */
function registeredSessionDirs(): string[] {
  const registryDir = trustedRegistryDir(false);
  if (registryDir === null) return [];
  const claimsDir = path.join(registryDir, CLAIMS_DIR);
  try {
    return fs
      .readdirSync(claimsDir)
      .filter((file) => /^\d+$/.test(file))
      .map((file) => readClaim(path.join(claimsDir, file)))
      .filter((dir): dir is string => dir !== null);
  } catch (error) {
    logDebugError(log, `list ${claimsDir}`, error);
    return [];
  }
}

/**
 * Read the session directory of one claim.
 *
 * @param claimPath - Claim file
 * @returns Absolute session directory, or null if unreadable or partly written
 */
function readClaim(claimPath: string): string | null {
  try {
    const dir = fs.readFileSync(claimPath, 'utf8').trim();
    return path.isAbsolute(dir) ? dir : null;
  } catch (error) {
    logDebugError(log, `read ${claimPath}`, error);
    return null;
  }
}

/**
 * Session directories other than the selected one that bdg knows of: those of
 * this base directory, and those of any base directory found in the
 * machine-wide registry. They need not hold a running session.
 *
 * @returns Session directories
 */
export function otherSessionDirs(): string[] {
  const ownDir = getSessionDir();
  const dirs = new Set([...listSessionDirs().map(({ dir }) => dir), ...registeredSessionDirs()]);
  return [...dirs].filter((dir) => dir !== ownDir);
}

/**
 * Ports claimed by other sessions that are running or starting (their daemon
 * socket exists), see {@link otherSessionDirs}.
 *
 * @returns Claimed ports
 */
export function portsClaimedByOtherSessions(): Set<number> {
  const ports = otherSessionDirs()
    .filter((dir) => fs.existsSync(sessionFilePathIn(dir, 'DAEMON_SOCKET')))
    .map((dir) => readPortFile(sessionFilePathIn(dir, 'PORT')));
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
 * Run port selection under the lock shared by all sessions of the user on
 * this machine (in the trusted registry directory; else in the base session
 * directory). If the lock cannot be taken in time, the selection runs anyway.
 *
 * @param select - Chooses the port; gets a function recording the claim in
 *   the registry, a no-op without the registry lock
 * @returns The chosen port
 */
export async function withPortLock(
  select: (recordClaim: RecordPortClaim) => Promise<number>
): Promise<number> {
  const registryDir = trustedRegistryDir(true);
  const lockDir = registryDir ?? getSessionBaseDir();
  fs.mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, PORT_LOCK_FILE);
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const locked = await acquireLock(lockPath, token);
  if (!locked) log.debug('Port lock busy; choosing a port without it');
  const recordClaim: RecordPortClaim =
    locked && registryDir !== null ? (port) => writePortClaim(registryDir, port) : () => {};
  try {
    return await select(recordClaim);
  } finally {
    if (locked) releaseLock(lockPath, token);
  }
}
