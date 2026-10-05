/**
 * Running sessions across the default and named session directories
 * (`bdg sessions`).
 */

import { getStatus } from '@/ipc/client.js';
import type { StatusResponseData } from '@/ipc/session/queries.js';
import { probeDaemonSocket } from '@/session/daemonSocket.js';
import { listSessionDirs, sessionFilePathIn, type SessionDirEntry } from '@/session/paths.js';
import { createLogger, logDebugError } from '@/ui/logging/index.js';

const log = createLogger('session');

/** State of a running session's daemon */
export type RunningSessionState = 'active' | 'starting' | 'ending' | 'unresponsive';

/**
 * One running session.
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
 * Describe the session of a directory if its daemon is running.
 *
 * @param entry - Session directory
 * @returns Session info, or null when no daemon listens
 */
async function describeSession({ name, dir }: SessionDirEntry): Promise<RunningSessionInfo | null> {
  const socketPath = sessionFilePathIn(dir, 'DAEMON_SOCKET');
  if ((await probeDaemonSocket(socketPath)) !== 'alive') return null;
  try {
    const response = await getStatus(socketPath);
    if (response.status === 'ok' && response.data) return toRunningSession(name, response.data);
  } catch (error) {
    logDebugError(log, `get status of ${dir}`, error);
  }
  return { name, state: 'unresponsive' };
}

/**
 * Every running session: the default one first, then named sessions by name.
 *
 * @returns Running sessions
 */
export async function listRunningSessions(): Promise<RunningSessionInfo[]> {
  const sessions = await Promise.all(listSessionDirs().map(describeSession));
  return sessions.filter((session): session is RunningSessionInfo => session !== null);
}
