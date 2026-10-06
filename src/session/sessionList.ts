/**
 * Sessions across the default and named session directories (`bdg sessions`):
 * running ones, and ones whose daemon died and left a Chrome or files behind.
 */

import * as fs from 'fs';

import { getStatus } from '@/ipc/client.js';
import type { StatusResponseData } from '@/ipc/session/queries.js';
import { isSessionChrome, readLiveDaemonPid } from '@/session/cleanup/staleSession.js';
import { probeDaemonSocket, type SocketProbeResult } from '@/session/daemonSocket.js';
import { readLastSessionEnd, type UnexpectedEndReason } from '@/session/lastSession.js';
import {
  SESSION_STATE_FILES,
  getNamedSessionDir,
  listSessionDirs,
  sessionFilePathIn,
  type SessionDirEntry,
} from '@/session/paths.js';
import { readPidFromFile } from '@/session/pid.js';
import { readPortFile } from '@/session/portClaims.js';
import { isValidSessionName, normalizeSessionName } from '@/session/sessionName.js';
import { createLogger, logDebugError } from '@/ui/logging/index.js';
import { removeDirCommand, sessionCommand } from '@/ui/messages/sessionCommand.js';
import { isProcessAlive } from '@/utils/process.js';

const log = createLogger('session');

/**
 * State of a session: its daemon runs (`active`, `starting`, `ending`,
 * `unresponsive`), died and left its Chrome running (`crashed`) or only
 * files (`stale`), or exited after the session ended without `bdg stop`
 * (`ended`: Chrome crashed or was closed, the page was closed, `--timeout`).
 */
export type RunningSessionState =
  'active' | 'starting' | 'ending' | 'unresponsive' | 'crashed' | 'stale' | 'ended';

/**
 * One session in the list.
 */
export interface RunningSessionInfo {
  /** Session name, or null for the default session */
  name: string | null;
  state: RunningSessionState;
  /** Current page URL (or the URL being opened while starting) */
  url?: string;
  /** CDP port */
  port?: number;
  daemonPid?: number;
  /** Chrome launched by bdg (absent for an attached Chrome) */
  chromePid?: number;
  /** Command that cleans up a crashed or stale session */
  cleanup?: string;
  /** Why an `ended` session ended */
  endReason?: UnexpectedEndReason;
  /** When an `ended` session ended (epoch ms) */
  endedAt?: number;
}

/**
 * Summarize a daemon's status response.
 *
 * @param name - Session name
 * @param data - Status data
 * @returns Session info
 */
export function toRunningSession(
  name: string | null,
  data: StatusResponseData
): RunningSessionInfo {
  const meta = data.sessionMetadata;
  const state: RunningSessionState = meta ? 'active' : data.ending ? 'ending' : 'starting';
  const url = data.pageState?.url ?? data.starting?.url;
  return {
    name,
    state,
    ...(url !== undefined && { url }),
    ...(meta && { port: meta.port }),
    daemonPid: data.daemonPid,
    ...(meta?.chromePid && { chromePid: meta.chromePid }),
  };
}

/**
 * Describe the session of a directory: a running daemon, or what a dead
 * one left behind.
 *
 * @param entry - Session directory
 * @returns Session info, or null when there is no session
 */
async function describeSession(entry: SessionDirEntry): Promise<RunningSessionInfo | null> {
  const { name, dir } = entry;
  const socketPath = sessionFilePathIn(dir, 'DAEMON_SOCKET');
  const probe = await probeDaemonSocket(socketPath);
  if (probe !== 'alive') return describeWithoutSocket(entry, probe);
  try {
    const response = await getStatus(socketPath);
    if (response.status === 'ok' && response.data) return toRunningSession(name, response.data);
  } catch (error) {
    logDebugError(log, `get status of ${dir}`, error);
  }
  return { name, state: 'unresponsive' };
}

/**
 * A session whose daemon socket does not answer: `ending` while its daemon
 * (from daemon.pid, verified by command line) still runs, since a daemon
 * writes daemon.pid only after it opened its socket and removes the socket
 * first when it shuts down; otherwise see {@link describeLeftovers}.
 *
 * @param entry - Session directory
 * @param probe - Result of probing its daemon socket
 * @returns Session info, or null when the directory holds no session state
 */
function describeWithoutSocket(
  entry: SessionDirEntry,
  probe: SocketProbeResult
): RunningSessionInfo | null {
  const daemonPid = readLiveDaemonPid(entry.dir);
  if (daemonPid !== null) return { name: entry.name, state: 'ending', daemonPid };
  return describeLeftovers(entry, probe);
}

/**
 * A session whose daemon is gone: `crashed` while the Chrome bdg launched for
 * it still runs, `stale` when only its files are left, `ended` when it left
 * only the record of an end without `bdg stop` ({@link describeEnded}).
 * Nothing is changed on disk; `cleanup` names the command that removes
 * leftover files.
 *
 * @param entry - Session directory
 * @param probe - Result of probing its daemon socket
 * @returns Session info, or null when the directory holds no session state
 */
export function describeLeftovers(
  { name, dir }: SessionDirEntry,
  probe: SocketProbeResult
): RunningSessionInfo | null {
  const chromePid = readPidFromFile(sessionFilePathIn(dir, 'CHROME_PID'));
  const orphan = chromePid !== null && isProcessAlive(chromePid) && isSessionChrome(chromePid, dir);
  const leftover =
    probe === 'stale' ||
    SESSION_STATE_FILES.some((type) => fs.existsSync(sessionFilePathIn(dir, type)));
  if (!orphan && !leftover) return describeEnded({ name, dir });
  const port = leftoverPort(dir);
  return {
    name,
    state: orphan ? 'crashed' : 'stale',
    ...(port !== null && { port }),
    ...(orphan && { chromePid }),
    cleanup: sessionCommand('bdg cleanup', name),
  };
}

/**
 * A session that ended without `bdg stop` and whose daemon exited cleanly:
 * `ended`, with why and when, until the session starts again or
 * `bdg cleanup` clears the record.
 *
 * @param entry - Session directory
 * @returns Session info, or null when the directory holds no such record
 */
function describeEnded({ name, dir }: SessionDirEntry): RunningSessionInfo | null {
  const end = readLastSessionEnd(dir);
  if (end === null) return null;
  return {
    name,
    state: 'ended',
    endReason: end.reason,
    endedAt: end.endedAt,
    cleanup: sessionCommand('bdg cleanup', name),
  };
}

/**
 * The port a dead session used: from its metadata, else its `port.txt`.
 *
 * @param dir - Session directory
 * @returns Port, or null if unknown
 */
function leftoverPort(dir: string): number | null {
  try {
    const meta = JSON.parse(fs.readFileSync(sessionFilePathIn(dir, 'METADATA'), 'utf8')) as {
      port?: unknown;
    };
    if (typeof meta.port === 'number') return meta.port;
  } catch (error) {
    logDebugError(log, `read the metadata in ${dir}`, error);
  }
  return readPortFile(sessionFilePathIn(dir, 'PORT'));
}

/**
 * Whether a directory entry is a session `--session` can select: the
 * default session, or a valid lower-case name.
 *
 * @param entry - Session directory
 * @returns True if selectable
 */
function isSelectable({ name }: SessionDirEntry): boolean {
  return name === null || (isValidSessionName(name) && name === normalizeSessionName(name));
}

/**
 * Whether two paths are the same directory (same inode and device), e.g.
 * `sessions/ALPHA` and `sessions/alpha` on a case-insensitive file system.
 *
 * @param a - First path
 * @param b - Second path
 * @returns True if both exist and are the same directory
 */
function isSameDir(a: string, b: string): boolean {
  try {
    const first = fs.statSync(a);
    const second = fs.statSync(b);
    return first.ino === second.ino && first.dev === second.dev;
  } catch (error) {
    logDebugError(log, `compare ${a} with ${b}`, error);
    return false;
  }
}

/**
 * The session `--session` reaches in a directory: the entry itself when its
 * name is selectable, the lower-cased session when the name differs only in
 * case and `--session <lower-case>` resolves to this very directory (a
 * case-insensitive file system), else null.
 *
 * @param entry - Session directory
 * @returns Selectable entry, or null
 */
function selectableEntry(entry: SessionDirEntry): SessionDirEntry | null {
  if (isSelectable(entry) || entry.name === null) return entry;
  const lower = normalizeSessionName(entry.name);
  if (!isValidSessionName(lower)) return null;
  return isSameDir(entry.dir, getNamedSessionDir(lower)) ? { name: lower, dir: entry.dir } : null;
}

/**
 * A directory `--session` cannot reach (e.g. `--json`, or `ALPHA` on a
 * case-sensitive file system, made by an earlier build): described like any
 * session while its daemon answers, otherwise `stale` with the command that
 * removes it by hand.
 *
 * @param entry - Session directory
 * @returns Session info
 */
async function describeUnselectable(entry: SessionDirEntry): Promise<RunningSessionInfo | null> {
  const socketPath = sessionFilePathIn(entry.dir, 'DAEMON_SOCKET');
  if ((await probeDaemonSocket(socketPath)) === 'alive') return describeSession(entry);
  return { name: entry.name, state: 'stale', cleanup: removeDirCommand(entry.dir) };
}

/**
 * Every session: the default one first, then named sessions by name. Includes
 * crashed and stale sessions, and directories `--session` cannot reach, so
 * their leftovers can be cleaned up. A directory differing only in case
 * (`ALPHA`) that `--session alpha` reaches is listed once, as `alpha`.
 *
 * @returns Sessions
 */
export async function listRunningSessions(): Promise<RunningSessionInfo[]> {
  const listed = new Set<string | null>();
  const sessions = await Promise.all(
    listSessionDirs().map((entry) => {
      const selectable = selectableEntry(entry);
      if (selectable === null) return describeUnselectable(entry);
      if (listed.has(selectable.name)) return Promise.resolve(null);
      listed.add(selectable.name);
      return describeSession(selectable);
    })
  );
  return sessions.filter((session): session is RunningSessionInfo => session !== null);
}
