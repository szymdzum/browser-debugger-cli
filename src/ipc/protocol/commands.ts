/**
 * Worker Command Schemas
 *
 * Defines the request/response schemas for commands sent to the worker process.
 * Each command has a request schema (input) and response data schema (output).
 */

import type { PageState, SessionActivity } from '@/ipc/session/types.js';

/**
 * Worker peek command request schema.
 */
export interface WorkerPeekCommand {
  /** Number of recent items to return. */
  lastN?: number;
}

/**
 * Worker peek command response data.
 */
export interface WorkerPeekData {
  version: string;
  startTime: number;
  duration: number;
  target: { url: string; title: string };
  activeTelemetry: string[];
  network: Array<{
    requestId: string;
    timestamp: number;
    method: string;
    url: string;
    status?: number;
    mimeType?: string;
  }>;
  console: Array<{ timestamp: number; type: string; text: string }>;
}

/**
 * Worker details command request schema.
 */
export interface WorkerDetailsCommand {
  /** Type of item to get details for. */
  itemType: 'network' | 'console';
  /** Unique identifier of the item. */
  id: string;
}

/**
 * Worker details command response data.
 */
export interface WorkerDetailsData {
  /** The requested item (network request or console message). */
  item: unknown;
}

/**
 * CDP call command request schema.
 */
export interface CdpCallCommand {
  /** CDP method name (e.g., 'Network.getCookies'). */
  method: string;
  /** Optional parameters for the CDP method. */
  params?: Record<string, unknown>;
}

/**
 * CDP call command response data.
 */
export interface CdpCallData {
  /** Result from CDP method call. */
  result: unknown;
}

/**
 * Worker status command request schema (no parameters required).
 */
export type WorkerStatusCommand = Record<string, unknown>;

/**
 * Worker status command response data.
 */
export interface WorkerStatusData {
  startTime: number;
  duration: number;
  target: PageState;
  activeTelemetry: string[];
  activity: SessionActivity;
}

/**
 * Command definition structure.
 */
type CommandDef<TReq, TRes> = { requestSchema: TReq; responseSchema: TRes };

/**
 * Shape of the command registry.
 */
export type RegistryShape = {
  worker_peek: CommandDef<WorkerPeekCommand, WorkerPeekData>;
  worker_details: CommandDef<WorkerDetailsCommand, WorkerDetailsData>;
  worker_status: CommandDef<WorkerStatusCommand, WorkerStatusData>;
  cdp_call: CommandDef<CdpCallCommand, CdpCallData>;
};

/**
 * Central registry of all worker commands.
 * Maps command names to their request/response schemas.
 */
export const COMMANDS = {
  worker_peek: { requestSchema: {} as WorkerPeekCommand, responseSchema: {} as WorkerPeekData },
  worker_details: {
    requestSchema: {} as WorkerDetailsCommand,
    responseSchema: {} as WorkerDetailsData,
  },
  worker_status: {
    requestSchema: {} as WorkerStatusCommand,
    responseSchema: {} as WorkerStatusData,
  },
  cdp_call: { requestSchema: {} as CdpCallCommand, responseSchema: {} as CdpCallData },
} as const satisfies RegistryShape;

/**
 * All registered command schemas.
 */
export type CommandSchemas = typeof COMMANDS;

/**
 * All valid command names.
 */
export type CommandName = keyof typeof COMMANDS;
