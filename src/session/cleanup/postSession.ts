/**
 * Post-session cleanup: runs AFTER a session has ended cleanly.
 *
 * Invariants at this phase:
 * - The session has completed normally or is being stopped on request.
 * - Both session-scoped and daemon-scoped files are removable.
 * - chrome-profile/ is preserved (user preferences, cookies, cache).
 * - session.json output is preserved (user needs to read it).
 * - chrome.pid is preserved for emergency cleanup (auto-removed if dead).
 */

import { QueryCacheManager } from '@/session/QueryCacheManager.js';
import { releaseSessionLock } from '@/session/lock.js';
import { getSessionFilePath } from '@/session/paths.js';
import { cleanupPidFile } from '@/session/pid.js';
import { createLogger, logDebugError } from '@/ui/logging/index.js';
import { safeRemoveFile } from '@/utils/file.js';

const log = createLogger('cleanup');

/**
 * Cleanup all session files after a session ends.
 *
 * Files removed:
 * - session.pid (worker PID)
 * - session.lock (session lock)
 * - session.meta.json (session metadata)
 * - daemon.pid, daemon.sock, daemon.lock (daemon files)
 *
 * Files preserved:
 * - session.json (output file)
 * - chrome.pid (emergency cleanup)
 * - chrome-profile/ directory
 *
 * Safe to call multiple times (idempotent).
 */
export function cleanupAfterSessionEnd(): void {
  cleanupPidFile();
  releaseSessionLock();

  safeRemoveFile(getSessionFilePath('METADATA'), 'metadata file', log);
  safeRemoveFile(getSessionFilePath('DAEMON_PID'), 'daemon PID file', log);
  safeRemoveFile(getSessionFilePath('DAEMON_SOCKET'), 'daemon socket', log);
  safeRemoveFile(getSessionFilePath('DAEMON_LOCK'), 'daemon lock', log);

  void QueryCacheManager.getInstance()
    .clear()
    .catch((error) => {
      logDebugError(log, 'clear query cache', error);
    });
}
