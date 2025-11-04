/**
 * Worker IPC Message Types
 *
 * Defines non-command messages for communication between daemon and worker process.
 * Command messages are defined in @/ipc/commands.ts
 */

/**
 * Base message type for worker IPC
 */
export interface WorkerIPCMessage {
  type: string;
  requestId: string; // Unique ID to match requests with responses
}

/**
 * Worker ready signal sent from worker to daemon on startup.
 * This is NOT a command - it's a lifecycle signal.
 */
export interface WorkerReadyMessage extends WorkerIPCMessage {
  type: 'worker_ready';
  workerPid: number;
  chromePid: number;
  port: number;
  target: {
    url: string;
    title?: string;
  };
}

/**
 * Union type of all non-command worker responses.
 * Command responses are defined in @/ipc/commands.ts (WorkerResponseUnion)
 */
export type WorkerIPCResponse = WorkerReadyMessage;
