/**
 * Session teardown: stop collectors, close CDP, terminate launched Chrome.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { ChromeNoticeCode, NoticeSink } from '@/errors/notices.js';
import { clearChromePid } from '@/session/chrome.js';
import type { CleanupFunction, LaunchedChrome } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';
import { isProcessAlive, killChromeProcess } from '@/utils/process.js';

const CHROME_EXIT_POLL_MS = 500;
const CHROME_EXIT_POLL_ATTEMPTS = 10;
/** Up to 5 s for Chrome to shut down cleanly after SIGTERM. */
const GRACEFUL_EXIT_POLL_ATTEMPTS = 10;

/**
 * Resources to release during teardown. Any of them may be missing if the
 * session failed part-way through startup.
 */
export interface TeardownContext {
  chrome: LaunchedChrome | null;
  cdp: CDPConnection | null;
  cleanupFunctions: CleanupFunction[];
  /** Attached to a user's Chrome (--chrome-ws-url) rather than one bdg launched */
  external: boolean;
  log: Logger;
  notify: NoticeSink<ChromeNoticeCode>;
}

/**
 * Release all session resources. Never throws.
 *
 * @param context - Resources to release
 */
export async function teardownSession(context: TeardownContext): Promise<void> {
  const { chrome, cdp, cleanupFunctions, external, log, notify } = context;

  for (const cleanup of cleanupFunctions) {
    try {
      await cleanup();
    } catch (error) {
      log.debug(`Collector cleanup error: ${getErrorMessage(error)}`);
    }
  }

  if (chrome && cdp) {
    await requestBrowserClose(cdp, chrome.pid, log);
  }

  if (cdp) {
    try {
      cdp.close();
    } catch (error) {
      log.info(`Error closing CDP: ${getErrorMessage(error)}`);
    }
  }

  if (chrome) {
    await terminateChrome(chrome, log);
  } else if (cdp && external) {
    notify({ code: 'EXTERNAL_CHROME_SKIP_TERMINATION' });
  }
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
    await Promise.race([cdp.send('Browser.close'), delay(CHROME_EXIT_POLL_MS)]);
  } catch (error) {
    log.debug(`Browser.close failed: ${getErrorMessage(error)}`);
  }
  await waitForExit(pid, GRACEFUL_EXIT_POLL_ATTEMPTS);
}

/**
 * Wait until a process exits.
 *
 * @param pid - Process id
 * @param attempts - Polls of {@link CHROME_EXIT_POLL_MS}
 */
async function waitForExit(pid: number, attempts: number): Promise<void> {
  for (let attempt = 0; attempt < attempts && isProcessAlive(pid); attempt++) {
    await delay(CHROME_EXIT_POLL_MS);
  }
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
async function terminateChrome(chrome: LaunchedChrome, log: Logger): Promise<void> {
  const pid = chrome.pid;
  try {
    process.kill(pid, 'SIGTERM');
    await waitForExit(pid, GRACEFUL_EXIT_POLL_ATTEMPTS);
  } catch (error) {
    log.debug(`SIGTERM to Chrome failed: ${getErrorMessage(error)}`);
  }
  try {
    await chrome.kill();
  } catch (error) {
    log.info(`Error killing Chrome: ${getErrorMessage(error)}`);
  }

  await waitForExit(pid, CHROME_EXIT_POLL_ATTEMPTS);

  if (isProcessAlive(pid)) {
    log.info(`Chrome (PID ${pid}) did not exit gracefully, force killing`);
    try {
      killChromeProcess(pid, 'SIGKILL');
      await delay(CHROME_EXIT_POLL_MS);
    } catch (error) {
      log.info(`Failed to force kill Chrome: ${getErrorMessage(error)}`);
    }
  }

  if (isProcessAlive(pid)) {
    log.info(`Chrome (PID ${pid}) survived SIGKILL`);
    return;
  }
  clearChromePid();
}
