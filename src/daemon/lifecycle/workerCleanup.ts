/**
 * Worker Cleanup
 *
 * Handles worker cleanup: DOM collection, CDP closure, Chrome termination, and output writing.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { TelemetryStore } from '@/daemon/worker/TelemetryStore.js';
import { writeChromePid } from '@/session/chrome.js';
import { writeSessionOutput } from '@/session/output.js';
import { isProcessAlive, killChromeProcess } from '@/session/process.js';
import { collectDOM } from '@/telemetry/dom.js';
import type { CleanupFunction, LaunchedChrome } from '@/types';
import { getErrorMessage } from '@/ui/errors/index.js';
import type { Logger } from '@/ui/logging/index.js';
import { chromeExternalSkipTerminationMessage } from '@/ui/messages/chrome.js';
import {
  workerCollectingDOM,
  workerDOMCollected,
  workerDOMCollectionFailed,
  workerRunningCleanup,
  workerClosingCDP,
  workerShutdownComplete,
  workerWritingOutput,
} from '@/ui/messages/debug.js';

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

    // Collect DOM on normal shutdown
    if (reason === 'normal' && telemetryStore.activeTelemetry.includes('dom') && cdp) {
      log.debug(workerCollectingDOM());
      try {
        telemetryStore.setDomData(await collectDOM(cdp));
        log.debug(workerDOMCollected());
      } catch (error) {
        log.debug(workerDOMCollectionFailed(getErrorMessage(error)));
      }
    }

    // Run cleanup functions
    log.debug(workerRunningCleanup());
    for (const cleanup of cleanupFunctions) {
      try {
        cleanup();
      } catch (error) {
        console.error(`[worker] Cleanup function error: ${getErrorMessage(error)}`);
      }
    }

    // Close CDP connection
    if (cdp) {
      try {
        log.debug(workerClosingCDP());
        cdp.close();
      } catch (error) {
        console.error(`[worker] Error closing CDP: ${getErrorMessage(error)}`);
      }
    }

    // Terminate Chrome
    if (chrome && chromePid) {
      await terminateChrome(chrome, chromePid, log);
    } else if (!chrome) {
      console.error(`[worker] ${chromeExternalSkipTerminationMessage()}`);
    }

    // Write output
    await writeOutput(reason, telemetryStore, log);

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

    // Wait for Chrome to die (max 5 seconds)
    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
      if (!isProcessAlive(chromePid)) {
        log.debug(`[worker] Chrome process ${chromePid} confirmed dead`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      attempts++;
    }

    // Force kill if still alive
    if (isProcessAlive(chromePid)) {
      console.error(`[worker] Chrome did not die gracefully, force killing...`);
      try {
        killChromeProcess(chromePid, 'SIGKILL');
        await new Promise((resolve) => setTimeout(resolve, 500));

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

/**
 * Write session output.
 */
async function writeOutput(
  reason: 'normal' | 'crash' | 'timeout',
  telemetryStore: TelemetryStore,
  log: Logger
): Promise<void> {
  if (reason === 'normal') {
    try {
      log.debug(workerWritingOutput());
      const finalOutput = telemetryStore.buildOutput(false);
      writeSessionOutput(finalOutput);
    } catch (error) {
      console.error(`[worker] Error writing final output: ${getErrorMessage(error)}`);
    }
  } else {
    try {
      log.debug(`[worker] Writing partial output (reason: ${reason})`);
      const partialOutput = telemetryStore.buildOutput(true);
      writeSessionOutput(partialOutput);
    } catch (error) {
      console.error(`[worker] Error writing partial output: ${getErrorMessage(error)}`);
    }
  }
}
