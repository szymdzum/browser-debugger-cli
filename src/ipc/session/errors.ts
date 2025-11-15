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
  /** Worker process failed to start. */
  WORKER_START_FAILED = 'WORKER_START_FAILED',
  /** Chrome browser failed to launch. */
  CHROME_LAUNCH_FAILED = 'CHROME_LAUNCH_FAILED',
  /** CDP connection timeout. */
  CDP_TIMEOUT = 'CDP_TIMEOUT',
  /** Generic daemon error. */
  DAEMON_ERROR = 'DAEMON_ERROR',
}
