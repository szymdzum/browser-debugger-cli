/**
 * The daemon's one shutdown order, for every caller (signal, session ended,
 * failed start, idle daemon).
 */

import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('daemon');

/** What a daemon shutdown does; the IPC server supplies the real steps, tests fakes. */
export interface ShutdownSteps {
  /** Refuse further start requests */
  refuseNewSessions(): void;
  /** Remove the socket path, so no new client finds the daemon */
  unpublish(): void;
  /** Stop the session if one is running or starting */
  stopSession(): Promise<unknown>;
  /** Wait until requests being handled have been answered */
  waitForInFlightRequests(): Promise<void>;
  /** Give the last responses time to flush */
  flush(): Promise<void>;
  /** Close the server and remove the daemon's files */
  stopServer(): Promise<void>;
  /** End the process */
  exit(): void;
}

/**
 * Shut the daemon down, in one order for every caller:
 *
 * 1. Refuse new starts and unpublish the socket: from here on no new client
 *    finds the daemon (the socket is bdg's liveness signal), while clients
 *    already connected keep their connections.
 * 2. Stop the session. A signal must end the session promptly, even during
 *    a long command (a page load, `dom screenshot --follow`): stopping first
 *    makes that command fail fast instead of holding the shutdown for up to
 *    the in-flight wait. When the session already ended (or never started:
 *    failed start, idle daemon) this does nothing.
 * 3. Wait for in-flight requests, so each gets its answer before the
 *    server closes: a command arriving after step 2 began is refused (the
 *    session is stopping), and one already running ends when the page
 *    connection closes and is answered with the session-ended error; none
 *    sees a half-torn session as a success. A `stop` that ended a starting
 *    session gets its answer here too.
 * 4. Let the last responses flush, close the server, exit.
 *
 * A failing step is logged and the rest still run: the daemon always exits.
 *
 * @param steps - The steps
 */
export async function runShutdown(steps: ShutdownSteps): Promise<void> {
  void attempt('refuse new sessions', () => steps.refuseNewSessions());
  void attempt('unpublish', () => steps.unpublish());
  await attempt('stop session', () => steps.stopSession());
  await attempt('wait for in-flight requests', () => steps.waitForInFlightRequests());
  await attempt('flush', () => steps.flush());
  await attempt('stop server', () => steps.stopServer());
  steps.exit();
}

/**
 * Run one shutdown step; a failure is logged and the shutdown goes on, so
 * the daemon always exits. A synchronous step runs and settles at once (the
 * socket is unpublished before any new client can connect).
 *
 * @param label - Step name, for the debug log
 * @param step - The step
 * @returns A promise when the step is asynchronous
 */
function attempt(label: string, step: () => void | Promise<unknown>): void | Promise<void> {
  const failed = (error: unknown): void =>
    log.debug(`Shutdown step "${label}" failed: ${getErrorMessage(error)}`);
  try {
    const result = step();
    if (result) return result.then(() => undefined, failed);
  } catch (error) {
    failed(error);
  }
}
