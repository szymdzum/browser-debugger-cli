/**
 * IPC Error Codes
 *
 * Semantic error codes for session-related failures.
 */

/**
 * Error codes returned in IPC responses.
 */
export enum IPCErrorCode {
  /** No active session exists. */
  NO_SESSION = 'NO_SESSION',
  /** Failed to kill session process. */
  SESSION_KILL_FAILED = 'SESSION_KILL_FAILED',
  /** Attempted to start session when one is already running. */
  SESSION_ALREADY_RUNNING = 'SESSION_ALREADY_RUNNING',
  /** Active session is attached to a different target than the new request. */
  SESSION_TARGET_MISMATCH = 'SESSION_TARGET_MISMATCH',
  /** Worker process failed to start. */
  WORKER_START_FAILED = 'WORKER_START_FAILED',
  /** Chrome browser failed to launch. */
  CHROME_LAUNCH_FAILED = 'CHROME_LAUNCH_FAILED',
  /** CDP connection timeout. */
  CDP_TIMEOUT = 'CDP_TIMEOUT',
  /**
   * Main-frame navigation failed (unreachable host, SSL error, DNS failure).
   * Chrome rendered a chrome-error page, so the session is unusable.
   */
  NAVIGATION_FAILED = 'NAVIGATION_FAILED',
  /** Generic daemon error. */
  DAEMON_ERROR = 'DAEMON_ERROR',
}
