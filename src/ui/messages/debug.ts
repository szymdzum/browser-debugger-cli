/**
 * Debug and diagnostic messages for daemon and worker processes.
 *
 * User-facing debug output for internal operations. Context prefixes
 * (e.g., [daemon], [worker]) are added by the logger, not here.
 *
 * WHY: Avoids duplicate prefixes when used with createLogger().
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
  return `Spawning worker: node ${workerPath} <config>\nWorker config: ${JSON.stringify(config)}`;
}

/**
 * Generate worker spawned success message.
 *
 * @param pid - Worker process ID
 * @returns Formatted debug message
 */
export function daemonWorkerSpawned(pid: number): string {
  return `Worker spawned (PID ${pid})`;
}

/**
 * Generate worker ready signal received message.
 *
 * @param workerPid - Worker process ID
 * @param chromePid - Chrome process ID
 * @returns Formatted debug message
 */
export function daemonWorkerReady(workerPid: number, chromePid: number): string {
  return `Worker ready signal received\nWorker PID: ${workerPid}\nChrome PID: ${chromePid}`;
}

/**
 * Generate failed to parse stdout message.
 *
 * @param line - The line that failed to parse
 * @returns Formatted debug message
 */
export function daemonParseError(line: string): string {
  return `Failed to parse stdout line: ${line}`;
}

// ============================================================================
// Worker Messages
// ============================================================================

/**
 * Generate telemetry module activation message.
 *
 * @param collectorName - Name of telemetry module being activated
 * @returns Formatted debug message
 */
export function workerActivatingCollector(collectorName: string): string {
  return `Activating ${collectorName} telemetry`;
}

/**
 * Generate all telemetry modules activated message.
 *
 * @param telemetry - Array of activated telemetry module names
 * @returns Formatted debug message
 */
export function workerCollectorsActivated(telemetry: string[]): string {
  return `All telemetry modules activated: ${telemetry.join(', ')}`;
}

/**
 * Generate unknown command received message.
 *
 * @param commandName - The unknown command name
 * @returns Formatted debug message
 */
export function workerUnknownCommand(commandName: string): string {
  return `Unknown command: ${commandName}`;
}

/**
 * Generate handling command message.
 *
 * @param commandName - Command being handled
 * @returns Formatted debug message
 */
export function workerHandlingCommand(commandName: string): string {
  return `Handling ${commandName}_request`;
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
    return `Sent ${commandName}_response (success)`;
  }
  return `Sent ${commandName}_response (error: ${error})`;
}

/**
 * Generate IPC message parse failure message.
 *
 * @param error - Error message from parse failure
 * @returns Formatted debug message
 */
export function workerIPCParseError(error: string): string {
  return `Failed to parse IPC message: ${error}`;
}

/**
 * Generate stdin closed message.
 *
 * @returns Formatted debug message
 */
export function workerStdinClosed(): string {
  return 'Stdin closed, daemon disconnected';
}

/**
 * Generate stdin listener setup message.
 *
 * @returns Formatted debug message
 */
export function workerStdinListenerSetup(): string {
  return 'Stdin listener set up for IPC commands';
}

/**
 * Generate collecting final DOM snapshot message.
 *
 * @returns Formatted debug message
 */
export function workerCollectingDOM(): string {
  return 'Collecting final DOM snapshot...';
}

/**
 * Generate DOM snapshot collected message.
 *
 * @returns Formatted debug message
 */
export function workerDOMCollected(): string {
  return 'DOM snapshot collected';
}

/**
 * Generate failed to collect DOM message.
 *
 * @param error - Error message from collection failure
 * @returns Formatted debug message
 */
export function workerDOMCollectionFailed(error: string): string {
  return `Failed to collect DOM: ${error}`;
}

/**
 * Generate writing final output message.
 *
 * @returns Formatted debug message
 */
export function workerWritingOutput(): string {
  return 'Writing final output...';
}

/**
 * Generate running cleanup functions message.
 *
 * @returns Formatted debug message
 */
export function workerRunningCleanup(): string {
  return 'Running collector cleanup functions...';
}

/**
 * Generate closing CDP connection message.
 *
 * @returns Formatted debug message
 */
export function workerClosingCDP(): string {
  return 'Closing CDP connection...';
}

/**
 * Generate graceful shutdown complete message.
 *
 * @returns Formatted debug message
 */
export function workerShutdownComplete(): string {
  return 'Graceful shutdown complete';
}

/**
 * Generate exiting due to Chrome connection loss message.
 *
 * @returns Formatted debug message
 */
export function workerExitingConnectionLoss(): string {
  return 'Exiting due to Chrome connection loss';
}

/**
 * Generate received SIGTERM message.
 *
 * @returns Formatted debug message
 */
export function workerReceivedSIGTERM(): string {
  return 'Received SIGTERM';
}

/**
 * Generate received SIGINT message.
 *
 * @returns Formatted debug message
 */
export function workerReceivedSIGINT(): string {
  return 'Received SIGINT';
}

/**
 * Generate timeout reached message.
 *
 * @returns Formatted debug message
 */
export function workerTimeoutReached(): string {
  return 'Timeout reached, initiating shutdown';
}

/**
 * Generate session active waiting message.
 *
 * @returns Formatted debug message
 */
export function workerSessionActive(): string {
  return 'Session active, waiting for signal or timeout...';
}
