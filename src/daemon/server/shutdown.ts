/**
 * The daemon's one shutdown order, for every caller (signal, session ended,
 * failed start, idle daemon).
 */

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
 * Shut the daemon down.
 *
 * @param _steps - The steps
 */
export async function runShutdown(_steps: ShutdownSteps): Promise<void> {}
