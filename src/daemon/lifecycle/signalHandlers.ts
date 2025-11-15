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

/**
 * Setup signal handlers for graceful shutdown.
 *
 * @param context - Cleanup context
 * @param timeout - Optional timeout in seconds for auto-stop
 */
export function setupSignalHandlers(context: CleanupContext, timeout?: number): void {
  const { log } = context;

  // SIGTERM handler (graceful shutdown from daemon)
  process.on('SIGTERM', () => {
    log.debug(workerReceivedSIGTERM());
    void cleanupWorker('normal', context).then(() => process.exit(0));
  });

  // SIGINT handler (Ctrl+C)
  process.on('SIGINT', () => {
    log.debug(workerReceivedSIGINT());
    void cleanupWorker('normal', context).then(() => process.exit(0));
  });

  // Timeout handler (auto-stop after configured duration)
  if (timeout) {
    console.error(`[worker] Auto-stop after ${timeout}s`);
    setTimeout(() => {
      log.debug(workerTimeoutReached());
      void cleanupWorker('timeout', context).then(() => process.exit(0));
    }, timeout * 1000);
  }
}
