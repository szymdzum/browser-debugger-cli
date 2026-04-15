/**
 * Orphaned daemon process discovery and cleanup.
 *
 * Uses platform-specific process discovery (ps/wmic) and `/proc/PID/environ`
 * parsing to find node daemon processes that outlived their tracked PID file,
 * then kills them with SIGKILL.
 *
 * Session isolation: daemons from other sessions (different BDG_SESSION_DIR)
 * are never touched.
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';

import { getSessionFilePath } from '@/session/paths.js';
import { readPidFromFile } from '@/session/pid.js';
import { createLogger, logDebugError } from '@/ui/logging/index.js';
import { isProcessAlive } from '@/utils/process.js';

const execAsync = promisify(exec);
const log = createLogger('cleanup');

/**
 * Read BDG_SESSION_DIR from `/proc/PID/environ` on Linux.
 *
 * @returns The session dir if readable, or null on any failure
 */
function getProcessSessionDir(pid: number): string | null {
  try {
    const environ = fs.readFileSync(`/proc/${pid}/environ`, 'utf-8');
    const vars = environ.split('\0');
    for (const v of vars) {
      if (v.startsWith('BDG_SESSION_DIR=')) {
        return v.substring('BDG_SESSION_DIR='.length);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Find orphaned daemon PIDs belonging to the current BDG_SESSION_DIR.
 *
 * Excludes the currently tracked daemon and any daemon whose session dir
 * differs from the current one (cross-session safety).
 */
async function findOrphanedDaemons(): Promise<number[]> {
  const orphanedPids: number[] = [];

  try {
    const daemonPidPath = getSessionFilePath('DAEMON_PID');
    const currentDaemonPid = readPidFromFile(daemonPidPath);
    const currentSessionDir = process.env['BDG_SESSION_DIR'] ?? null;

    const psCommand =
      process.platform === 'win32'
        ? 'wmic process where "commandline like \'%dist/daemon.js%\'" get processid'
        : 'ps aux | grep -E "node.*dist/daemon\\.js" | grep -v grep';

    const { stdout: output } = await execAsync(psCommand);

    const lines = output.trim().split('\n');

    for (const line of lines) {
      let pid: number;

      if (process.platform === 'win32') {
        const match = line.trim().match(/(\d+)/);
        if (!match?.[1]) continue;
        pid = parseInt(match[1], 10);
      } else {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2 || !parts[1]) continue;
        pid = parseInt(parts[1], 10);
      }

      if (Number.isNaN(pid)) continue;
      if (currentDaemonPid && pid === currentDaemonPid) continue;
      if (!isProcessAlive(pid)) continue;

      if (process.platform !== 'win32') {
        const processSessionDir = getProcessSessionDir(pid);
        if (processSessionDir !== null && processSessionDir !== currentSessionDir) {
          log.debug(`Skipping daemon ${pid} from different session: ${processSessionDir}`);
          continue;
        }
        if (processSessionDir === null && currentSessionDir !== null) {
          log.debug(`Skipping daemon ${pid} with unknown session dir (safety)`);
          continue;
        }
      }

      orphanedPids.push(pid);
    }
  } catch (error) {
    logDebugError(log, 'find orphaned daemons', error);
  }

  return orphanedPids;
}

/**
 * Kill all orphaned daemon processes for the current session.
 *
 * @returns Number of daemons killed
 */
export async function cleanupOrphanedDaemons(): Promise<number> {
  const orphanedPids = await findOrphanedDaemons();

  if (orphanedPids.length === 0) {
    log.debug('No orphaned daemon processes found');
    return 0;
  }

  log.debug(`Found ${orphanedPids.length} orphaned daemon process(es): ${orphanedPids.join(', ')}`);

  let killedCount = 0;

  for (const pid of orphanedPids) {
    try {
      process.kill(pid, 'SIGKILL');
      log.debug(`Killed orphaned daemon process ${pid}`);
      killedCount++;
    } catch (error) {
      logDebugError(log, `kill orphaned daemon ${pid}`, error);
    }
  }

  return killedCount;
}
