/**
 * Which other bdg session uses a Chrome, so `--chrome-ws-url` never takes over
 * a tab another session drives, nor a Chrome another session launched (and
 * closes when it stops).
 *
 * Sessions are found in this base directory and, through the machine-wide
 * port registry, in other base directories whose sessions claimed a port.
 */

import * as fs from 'fs';

import { probeDaemonSocket } from '@/session/daemonSocket.js';
import { sessionFilePathIn, sessionOfDir } from '@/session/paths.js';
import { otherSessionDirs } from '@/session/portClaims.js';
import { createLogger, logDebugError } from '@/ui/logging/index.js';

const log = createLogger('session');

/**
 * A running session and the Chrome tab it drives.
 */
export interface ChromeOwner {
  /** Session name, or null for a default session */
  name: string | null;
  /** Session directory */
  dir: string;
  /** Base directory of the session (its `BDG_SESSION_DIR`) */
  baseDir: string;
  /** Target (tab) the session drives */
  targetId: string;
  /** Whether the session launched that Chrome (it closes Chrome when it stops) */
  launched: boolean;
}

/**
 * The tab a running session drives, from its metadata.
 *
 * @param dir - Session directory
 * @returns Owner info, or null without a running session or metadata
 */
async function readOwner(dir: string): Promise<ChromeOwner | null> {
  if ((await probeDaemonSocket(sessionFilePathIn(dir, 'DAEMON_SOCKET'))) !== 'alive') return null;
  try {
    const meta = JSON.parse(fs.readFileSync(sessionFilePathIn(dir, 'METADATA'), 'utf8')) as {
      targetId?: unknown;
      chromePid?: unknown;
    };
    if (typeof meta.targetId !== 'string') return null;
    const launched = typeof meta.chromePid === 'number' && meta.chromePid > 0;
    return { ...sessionOfDir(dir), dir, targetId: meta.targetId, launched };
  } catch (error) {
    logDebugError(log, `read the metadata in ${dir}`, error);
    return null;
  }
}

/**
 * Another running session that a new session attaching to a Chrome would
 * collide with: one that launched that Chrome, or one driving the tab the
 * new session would use.
 *
 * @param chromeTargetIds - Ids of every target of the Chrome being attached to
 * @param targetId - Tab the new session would drive
 * @returns The conflicting session, or null
 */
export async function findConflictingOwner(
  chromeTargetIds: readonly string[],
  targetId: string
): Promise<ChromeOwner | null> {
  const owners = await Promise.all(otherSessionDirs().map(readOwner));
  return (
    owners.find(
      (owner) =>
        owner !== null &&
        chromeTargetIds.includes(owner.targetId) &&
        (owner.launched || owner.targetId === targetId)
    ) ?? null
  );
}
