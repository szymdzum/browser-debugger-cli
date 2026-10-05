/**
 * Sessions across the default and named session directories (`bdg sessions`):
 * running ones, and ones whose daemon died and left a Chrome or files behind.
 */

import * as fs from 'fs';

import { getStatus } from '@/ipc/client.js';
import type { StatusResponseData } from '@/ipc/session/queries.js';
import { isSessionChrome } from '@/session/cleanup/staleSession.js';
import { probeDaemonSocket, type SocketProbeResult } from '@/session/daemonSocket.js';
import {
  SESSION_STATE_FILES,
  listSessionDirs,
  sessionFilePathIn,
  type SessionDirEntry,
} from '@/session/paths.js';
import { readPidFromFile } from '@/session/pid.js';
import { readPortFile } from '@/session/portClaims.js';
import { isValidSessionName, normalizeSessionName } from '@/session/sessionName.js';
import { createLogger, logDebugError } from '@/ui/logging/index.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { isProcessAlive } from '@/utils/process.js';

const log = createLogger('session');

/**
 * State of a session: its daemon runs (`active`, `starting`, `ending`,
 * `unresponsive`), or died and left its Chrome running (`crashed`) or only
 * files (`stale`).
 */
export type RunningSessionState =
  'active' | 'starting' | 'ending' | 'unresponsive' | 'crashed' | 'stale';

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
  if (probe !== 'alive') return describeLeftovers(entry, probe);
  try {
    const response = await getStatus(socketPath);
    if (response.status === 'ok' && response.data) return toRunningSession(name, response.data);
  } catch (error) {
    logDebugError(log, `get status of ${dir}`, error);
  }
  return { name, state: 'unresponsive' };
}

/**
 * A session whose daemon is gone: `crashed` while the Chrome bdg launched for
 * it still runs, `stale` when only its files are left. Nothing is changed on
 * disk; `cleanup` names the command that removes them.
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
  if (!orphan && !leftover) return null;
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
 * default session, or a valid lower-case name (directories such as `ALPHA`
 * or `--json` left by older versions are skipped).
 *
 * @param entry - Session directory
 * @returns True if selectable
 */
function isSelectable({ name }: SessionDirEntry): boolean {
  return name === null || (isValidSessionName(name) && name === normalizeSessionName(name));
}

/**
 * Every session: the default one first, then named sessions by name. Includes
 * crashed and stale sessions so their leftovers can be cleaned up.
 *
 * @returns Sessions
 */
export async function listRunningSessions(): Promise<RunningSessionInfo[]> {
  const sessions = await Promise.all(listSessionDirs().filter(isSelectable).map(describeSession));
  return sessions.filter((session): session is RunningSessionInfo => session !== null);
}
