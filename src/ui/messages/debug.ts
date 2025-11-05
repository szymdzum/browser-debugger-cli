/**
 * Debug and diagnostic messages for daemon and worker processes.
 *
 * User-facing debug output for internal operations, prefixed with
 * component names for clarity during troubleshooting.
 */

// ============================================================================
// Daemon Messages
// ============================================================================

/**
 * Generate worker spawn message with configuration.
 *
 * @param workerPath - Path to worker script
 * @param config - Worker configuration object
 * @returns Formatted debug message
 */
export function daemonSpawningWorker(workerPath: string, config: unknown): string {
  return `[daemon] Spawning worker: node ${workerPath} <config>\n[daemon] Worker config: ${JSON.stringify(config)}`;
}

/**
 * Generate worker spawned success message.
 *
 * @param pid - Worker process ID
 * @returns Formatted debug message
 */
export function daemonWorkerSpawned(pid: number): string {
  return `[daemon] Worker spawned (PID ${pid})`;
}

/**
 * Generate worker ready signal received message.
 *
 * @param workerPid - Worker process ID
 * @param chromePid - Chrome process ID
 * @returns Formatted debug message
 */
export function daemonWorkerReady(workerPid: number, chromePid: number): string {
  return `[daemon] Worker ready signal received\n[daemon] Worker PID: ${workerPid}\n[daemon] Chrome PID: ${chromePid}`;
}

/**
 * Generate failed to parse stdout message.
 *
 * @param line - The line that failed to parse
 * @returns Formatted debug message
 */
export function daemonParseError(line: string): string {
  return `[daemon] Failed to parse stdout line: ${line}`;
}

// ============================================================================
// Worker Messages
// ============================================================================

/**
 * Generate collector activation message.
 *
 * @param collectorName - Name of collector being activated
 * @returns Formatted debug message
 */
export function workerActivatingCollector(collectorName: string): string {
  return `[worker] Activating ${collectorName} collector`;
}

/**
 * Generate all collectors activated message.
 *
 * @param collectors - Array of activated collector names
 * @returns Formatted debug message
 */
export function workerCollectorsActivated(collectors: string[]): string {
  return `[worker] All collectors activated: ${collectors.join(', ')}`;
}

/**
 * Generate unknown command received message.
 *
 * @param commandName - The unknown command name
 * @returns Formatted debug message
 */
export function workerUnknownCommand(commandName: string): string {
  return `[worker] Unknown command: ${commandName}`;
}

/**
 * Generate handling command message.
 *
 * @param commandName - Command being handled
 * @returns Formatted debug message
 */
export function workerHandlingCommand(commandName: string): string {
  return `[worker] Handling ${commandName}_request`;
}

/**
 * Generate command response sent message.
 *
 * @param commandName - Command that was handled
 * @param success - Whether the command succeeded
 * @param error - Optional error message if failed
 * @returns Formatted debug message
 */
export function workerCommandResponse(
  commandName: string,
  success: boolean,
  error?: string
): string {
  if (success) {
    return `[worker] Sent ${commandName}_response (success)`;
  }
  return `[worker] Sent ${commandName}_response (error: ${error})`;
}

/**
 * Generate IPC message parse failure message.
 *
 * @param error - Error message from parse failure
 * @returns Formatted debug message
 */
export function workerIPCParseError(error: string): string {
  return `[worker] Failed to parse IPC message: ${error}`;
}

/**
 * Generate stdin closed message.
 *
 * @returns Formatted debug message
 */
export function workerStdinClosed(): string {
  return '[worker] Stdin closed, daemon disconnected';
}

/**
 * Generate stdin listener setup message.
 *
 * @returns Formatted debug message
 */
export function workerStdinListenerSetup(): string {
  return '[worker] Stdin listener set up for IPC commands';
}

/**
 * Generate ready signal sent message.
 *
 * @param workerPid - Worker process ID
 * @param chromePid - Chrome process ID
 * @returns Formatted debug message
 */
export function workerReadySignalSent(workerPid: number, chromePid: number): string {
  return `[worker] Ready signal sent (PID ${workerPid}, Chrome PID ${chromePid})`;
}

/**
 * Generate graceful shutdown started message.
 *
 * @returns Formatted debug message
 */
export function workerShutdownStarted(): string {
  return '[worker] Starting graceful shutdown...';
}

/**
 * Generate collecting final DOM snapshot message.
 *
 * @returns Formatted debug message
 */
export function workerCollectingDOM(): string {
  return '[worker] Collecting final DOM snapshot...';
}

/**
 * Generate DOM snapshot collected message.
 *
 * @returns Formatted debug message
 */
export function workerDOMCollected(): string {
  return '[worker] DOM snapshot collected';
}

/**
 * Generate failed to collect DOM message.
 *
 * @param error - Error message from collection failure
 * @returns Formatted debug message
 */
export function workerDOMCollectionFailed(error: string): string {
  return `[worker] Failed to collect DOM: ${error}`;
}

/**
 * Generate writing final output message.
 *
 * @returns Formatted debug message
 */
export function workerWritingOutput(): string {
  return '[worker] Writing final output...';
}

/**
 * Generate running cleanup functions message.
 *
 * @returns Formatted debug message
 */
export function workerRunningCleanup(): string {
  return '[worker] Running collector cleanup functions...';
}

/**
 * Generate closing CDP connection message.
 *
 * @returns Formatted debug message
 */
export function workerClosingCDP(): string {
  return '[worker] Closing CDP connection...';
}

/**
 * Generate graceful shutdown complete message.
 *
 * @returns Formatted debug message
 */
export function workerShutdownComplete(): string {
  return '[worker] Graceful shutdown complete';
}

/**
 * Generate exiting due to Chrome connection loss message.
 *
 * @returns Formatted debug message
 */
export function workerExitingConnectionLoss(): string {
  return '[worker] Exiting due to Chrome connection loss';
}

/**
 * Generate received SIGTERM message.
 *
 * @returns Formatted debug message
 */
export function workerReceivedSIGTERM(): string {
  return '[worker] Received SIGTERM';
}

/**
 * Generate received SIGINT message.
 *
 * @returns Formatted debug message
 */
export function workerReceivedSIGINT(): string {
  return '[worker] Received SIGINT';
}

/**
 * Generate timeout reached message.
 *
 * @returns Formatted debug message
 */
export function workerTimeoutReached(): string {
  return '[worker] Timeout reached, initiating shutdown';
}

/**
 * Generate session active waiting message.
 *
 * @returns Formatted debug message
 */
export function workerSessionActive(): string {
  return '[worker] Session active, waiting for signal or timeout...';
}
