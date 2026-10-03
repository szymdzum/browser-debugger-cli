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
 * Terminate a launched Chrome, escalating to SIGKILL if it does not exit.
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
    await chrome.kill();
  } catch (error) {
    log.info(`Error killing Chrome: ${getErrorMessage(error)}`);
  }

  for (let attempt = 0; attempt < CHROME_EXIT_POLL_ATTEMPTS && isProcessAlive(pid); attempt++) {
    await delay(CHROME_EXIT_POLL_MS);
  }

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
