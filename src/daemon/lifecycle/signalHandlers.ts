/**
 * Signal Handlers
 *
 * Sets up process signal handlers for graceful shutdown.
 */

import type { CleanupContext } from '@/daemon/lifecycle/workerCleanup.js';
import { cleanupWorker } from '@/daemon/lifecycle/workerCleanup.js';
import {
  workerReceivedSIGTERM,
  workerReceivedSIGINT,
  workerTimeoutReached,
} from '@/ui/messages/debug.js';
import { getErrorMessage } from '@/utils/errors.js';

/**
 * Setup signal handlers for graceful shutdown.
 *
 * @param context - Cleanup context
 * @param timeout - Optional timeout in seconds for auto-stop
 */
export function setupSignalHandlers(context: CleanupContext, timeout?: number): void {
  const { log } = context;

  process.on('SIGTERM', () => {
    log.debug(workerReceivedSIGTERM());
    cleanupWorker('normal', context)
      .then(() => process.exit(0))
      .catch((error) => {
        log.debug(`Cleanup error during SIGTERM: ${getErrorMessage(error)}`);
        process.exit(1);
      });
  });

  process.on('SIGINT', () => {
    log.debug(workerReceivedSIGINT());
    cleanupWorker('normal', context)
      .then(() => process.exit(0))
      .catch((error) => {
        log.debug(`Cleanup error during SIGINT: ${getErrorMessage(error)}`);
        process.exit(1);
      });
  });

  if (timeout) {
    console.error(`[worker] Auto-stop after ${timeout}s`);
    setTimeout(() => {
      log.debug(workerTimeoutReached());
      cleanupWorker('timeout', context)
        .then(() => process.exit(0))
        .catch((error) => {
          log.debug(`Cleanup error during timeout: ${getErrorMessage(error)}`);
          process.exit(1);
        });
    }, timeout * 1000);
  }
}
