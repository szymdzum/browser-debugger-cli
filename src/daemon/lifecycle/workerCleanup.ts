/**
 * Worker Cleanup
 *
 * Handles worker cleanup: DOM collection, CDP closure, and Chrome termination.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { TelemetryStore } from '@/daemon/worker/TelemetryStore.js';
import { writeChromePid } from '@/session/chrome.js';
import { collectDOM } from '@/telemetry/dom.js';
import type { CleanupFunction, LaunchedChrome } from '@/types';
import type { Logger } from '@/ui/logging/index.js';
import { chromeExternalSkipTerminationMessage } from '@/ui/messages/chrome.js';
import {
  workerCollectingDOM,
  workerDOMCollected,
  workerDOMCollectionFailed,
  workerRunningCleanup,
  workerClosingCDP,
  workerShutdownComplete,
} from '@/ui/messages/debug.js';
import { delay } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';
import { isProcessAlive, killChromeProcess } from '@/utils/process.js';

/**
 * Worker cleanup context.
 */
export interface CleanupContext {
  chrome: LaunchedChrome | null;
  cdp: CDPConnection | null;
  cleanupFunctions: CleanupFunction[];
  telemetryStore: TelemetryStore;
  log: Logger;
}

/**
 * Perform worker cleanup.
 *
 * @param reason - Why cleanup is happening (normal, crash, timeout)
 * @param context - Cleanup context with resources to clean up
 */
export async function cleanupWorker(
  reason: 'normal' | 'crash' | 'timeout',
  context: CleanupContext
): Promise<void> {
  const { chrome, cdp, cleanupFunctions, telemetryStore, log } = context;

  log.debug(`[worker] Cleanup started (reason: ${reason})`);

  try {
    const chromePid = chrome?.pid;
    if (chromePid) {
      try {
        writeChromePid(chromePid);
        log.debug(`[worker] Chrome PID ${chromePid} cached for cleanup`);
      } catch (error) {
        console.error(`[worker] Failed to cache Chrome PID: ${getErrorMessage(error)}`);
      }
    }

    if (reason === 'normal' && telemetryStore.activeTelemetry.includes('dom') && cdp) {
      log.debug(workerCollectingDOM());
      try {
        telemetryStore.setDomData(await collectDOM(cdp));
        log.debug(workerDOMCollected());
      } catch (error) {
        log.debug(workerDOMCollectionFailed(getErrorMessage(error)));
      }
    }

    log.debug(workerRunningCleanup());
    for (const cleanup of cleanupFunctions) {
      try {
        const result = cleanup();
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        log.debug(`Cleanup function error: ${getErrorMessage(error)}`);
      }
    }

    if (cdp) {
      try {
        log.debug(workerClosingCDP());
        cdp.close();
      } catch (error) {
        console.error(`[worker] Error closing CDP: ${getErrorMessage(error)}`);
      }
    }

    if (chrome && chromePid) {
      await terminateChrome(chrome, chromePid, log);
    } else if (!chrome && cdp) {
      // External Chrome mode (connected via --chrome-ws-url)
      console.error(`[worker] ${chromeExternalSkipTerminationMessage()}`);
    }
    // If both chrome and cdp are null, Chrome launch failed - nothing to terminate

    log.debug(workerShutdownComplete());
  } catch (error) {
    console.error(`[worker] Error during cleanup: ${getErrorMessage(error)}`);
  }
}

/**
 * Terminate Chrome process.
 */
async function terminateChrome(
  chrome: LaunchedChrome,
  chromePid: number,
  log: Logger
): Promise<void> {
  try {
    console.error(`[worker] Terminating Chrome (PID ${chromePid})...`);
    await chrome.kill();

    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
      if (!isProcessAlive(chromePid)) {
        log.debug(`[worker] Chrome process ${chromePid} confirmed dead`);
        return;
      }
      await delay(500);
      attempts++;
    }

    if (isProcessAlive(chromePid)) {
      console.error(`[worker] Chrome did not die gracefully, force killing...`);
      try {
        killChromeProcess(chromePid, 'SIGKILL');
        await delay(500);

        if (isProcessAlive(chromePid)) {
          console.error(`[worker] WARNING: Chrome process ${chromePid} survived SIGKILL`);
        } else {
          log.debug(`[worker] Chrome process ${chromePid} force killed successfully`);
        }
      } catch (error) {
        console.error(`[worker] Failed to force kill Chrome: ${getErrorMessage(error)}`);
      }
    }
  } catch (error) {
    console.error(`[worker] Error killing Chrome: ${getErrorMessage(error)}`);
  }
}
