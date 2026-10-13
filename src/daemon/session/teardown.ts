/**
 * Session teardown releases: close the page connection (asking a launched
 * Chrome to close first) and terminate a launched Chrome. The order they run
 * in is defined by `startSequence.ts`.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { ChromeNoticeCode, NoticeSink } from '@/errors/notices.js';
import { clearChromePid } from '@/session/chrome.js';
import type { LaunchedChrome } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { raceTimeout } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';
import { isProcessAlive, killChromeProcess, waitForProcessExit } from '@/utils/process.js';

/** How often to check whether Chrome has exited (it usually takes 100–300 ms) */
const CHROME_EXIT_POLL_MS = 50;
/** Up to 5 s for Chrome to shut down cleanly after Browser.close or SIGTERM */
const GRACEFUL_EXIT_WAIT_MS = 5000;
/** How long to wait for Browser.close to answer (Chrome may exit without answering) */
const BROWSER_CLOSE_REPLY_MS = 500;

/**
 * The page connection to release, and the Chrome behind it.
 */
export interface ConnectionRelease {
  /** Launched Chrome, or null when attached to the user's Chrome */
  chrome: LaunchedChrome | null;
  /** The session's current page connection, if it still has one */
  cdp: CDPConnection | null;
  /** Attached to a user's Chrome (--chrome-ws-url) rather than one bdg launched */
  external: boolean;
  log: Logger;
  notify: NoticeSink<ChromeNoticeCode>;
}

/**
 * Release the page connection: a launched Chrome is asked to close itself
 * through it first ({@link requestBrowserClose}); an attached Chrome is left
 * running, and the user is told so. Never throws.
 *
 * @param release - Connection, Chrome and how to report
 */
export async function releaseConnection(release: ConnectionRelease): Promise<void> {
  const { chrome, cdp, external, log, notify } = release;
  if (!cdp) return;
  if (chrome) await requestBrowserClose(cdp, chrome.pid, log);
  try {
    cdp.close();
  } catch (error) {
    log.info(`Error closing CDP: ${getErrorMessage(error)}`);
  }
  if (!chrome && external) notify({ code: 'EXTERNAL_CHROME_SKIP_TERMINATION' });
}

/**
 * Ask Chrome to close itself through CDP and wait for it to exit.
 *
 * `Browser.close` runs Chrome's normal shutdown, which writes cookies and
 * storage to the profile; signals (even SIGTERM) can end the process before
 * recent changes are persisted.
 *
 * @param cdp - Open CDP connection
 * @param pid - Chrome's main process id
 * @param log - Logger
 */
async function requestBrowserClose(cdp: CDPConnection, pid: number, log: Logger): Promise<void> {
  try {
    await raceTimeout(cdp.send('Browser.close'), BROWSER_CLOSE_REPLY_MS);
  } catch (error) {
    log.debug(`Browser.close failed: ${getErrorMessage(error)}`);
  }
  await waitForProcessExit(pid, GRACEFUL_EXIT_WAIT_MS, { pollMs: CHROME_EXIT_POLL_MS });
}

/**
 * Terminate a launched Chrome that is still running (normally it already
 * exited after `Browser.close`, e.g. when CDP was lost).
 *
 * SIGTERM goes to Chrome's main process only (not its process group), so it
 * can still shut its children down in order; signalling the whole group
 * (which chrome-launcher's kill does, with SIGKILL) loses cookies and storage
 * written since the last periodic flush.
 * chrome-launcher's kill still runs afterwards to remove its temporary
 * profile, escalating to SIGKILL on the group if Chrome is still alive.
 *
 * Clears chrome.pid once Chrome is confirmed dead; otherwise the file is kept
 * so a later `bdg cleanup` or session start can reap it.
 *
 * @param chrome - Launched Chrome instance
 * @param log - Logger
 */
export async function terminateChrome(chrome: LaunchedChrome, log: Logger): Promise<void> {
  const pid = chrome.pid;
  try {
    process.kill(pid, 'SIGTERM');
    await waitForProcessExit(pid, GRACEFUL_EXIT_WAIT_MS, { pollMs: CHROME_EXIT_POLL_MS });
  } catch (error) {
    log.debug(`SIGTERM to Chrome failed: ${getErrorMessage(error)}`);
  }
  try {
    await chrome.kill();
  } catch (error) {
    log.info(`Error killing Chrome: ${getErrorMessage(error)}`);
  }

  await waitForProcessExit(pid, GRACEFUL_EXIT_WAIT_MS, { pollMs: CHROME_EXIT_POLL_MS });

  if (isProcessAlive(pid)) {
    log.info(`Chrome (PID ${pid}) did not exit gracefully, force killing`);
    try {
      killChromeProcess(pid, 'SIGKILL');
      await waitForProcessExit(pid, GRACEFUL_EXIT_WAIT_MS, { pollMs: CHROME_EXIT_POLL_MS });
    } catch (error) {
      log.info(`Failed to force kill Chrome: ${getErrorMessage(error)}`);
    }
  }

  if (isProcessAlive(pid)) {
    log.info(`Chrome (PID ${pid}) survived SIGKILL`);
    return;
  }
  clearChromePid(pid);
}
