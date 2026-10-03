/**
 * Worker Command Schemas
 *
 * Defines the request/response schemas for commands sent to the worker process.
 * Each command has a request schema (input) and response data schema (output).
 */

import type { HintDetails } from '@/errors/notices.js';
import type {
  ClickResult,
  FillResult,
  PressKeyResult,
  RawFormData,
  ScrollResult,
  SubmitResult,
} from '@/ipc/protocol/domTypes.js';
import type { PageState, SessionActivity } from '@/ipc/session/types.js';
import type { NetworkRequest } from '@/types.js';

/**
 * Worker peek command request schema.
 */
export interface WorkerPeekCommand {
  /** Number of recent items to return. */
  lastN?: number;
  /** Offset from the end (for pagination). Default: 0 (most recent). */
  offset?: number;
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
  /** Total number of network requests (for pagination). */
  totalNetwork?: number;
  /** Total number of console messages (for pagination). */
  totalConsole?: number;
  /** Whether there are more network items available. */
  hasMoreNetwork?: boolean;
  /** Whether there are more console items available. */
  hasMoreConsole?: boolean;
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
  /** Structured hint suggesting a more efficient alternative. UI formats at boundary. */
  hint?: HintDetails;
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
  /** Current navigation counter (increments on each page navigation). */
  navigationId: number;
}

/**
 * Worker HAR data command request schema (no parameters required).
 */
export type WorkerHARDataCommand = Record<string, unknown>;

/**
 * Worker HAR data command response data.
 */
export interface WorkerHARDataData {
  /** All collected network requests for HAR export. */
  requests: NetworkRequest[];
}

/**
 * Worker network headers command request schema.
 */
export interface WorkerNetworkHeadersCommand {
  /** Optional request ID to get headers from. Defaults to main page navigation. */
  id?: string;
  /** Optional header name to filter results. Case-insensitive. */
  headerName?: string;
}

/**
 * Worker network headers command response data.
 */
export interface WorkerNetworkHeadersData {
  /** URL of the request. */
  url: string;
  /** Request ID for correlation with peek output. */
  requestId: string;
  /** Request headers. */
  requestHeaders: Record<string, string>;
  /** Response headers. */
  responseHeaders: Record<string, string>;
}

/**
 * dom_eval: evaluate a JavaScript expression in the page and return its value.
 */
export interface DomEvalCommand {
  script: string;
}

export interface DomEvalData {
  value: unknown;
}

/**
 * dom_fill: fill a form field, optionally waiting for network stability after.
 */
export interface DomFillCommand {
  selector: string;
  value: string;
  index?: number;
  blur?: boolean;
  wait?: boolean;
}

export type DomFillData = FillResult;

/**
 * dom_click: click an element, optionally waiting for stability after.
 */
export interface DomClickCommand {
  selector: string;
  index?: number;
  wait?: boolean;
}

export type DomClickData = ClickResult;

/**
 * dom_submit: submit a form with smart waiting (navigation / network idle).
 */
export interface DomSubmitCommand {
  selector: string;
  index?: number;
  waitNavigation?: boolean;
  waitNetwork?: number;
  timeout?: number;
}

export type DomSubmitData = SubmitResult;

/**
 * dom_press_key: dispatch a key event on an element.
 */
export interface DomPressKeyCommand {
  selector: string;
  key: string;
  index?: number;
  times?: number;
  modifiers?: string;
  wait?: boolean;
}

export type DomPressKeyData = PressKeyResult;

/**
 * dom_scroll: scroll the page or an element into view.
 */
export interface DomScrollCommand {
  selector?: string;
  index?: number;
  down?: number;
  up?: number;
  left?: number;
  right?: number;
  top?: boolean;
  bottom?: boolean;
  wait?: boolean;
}

export type DomScrollData = ScrollResult;

/**
 * dom_form_discover: run the form discovery script and return raw form data.
 */
export type DomFormDiscoverCommand = Record<string, never>;

export type DomFormDiscoverData = RawFormData;

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
  worker_har_data: CommandDef<WorkerHARDataCommand, WorkerHARDataData>;
  worker_network_headers: CommandDef<WorkerNetworkHeadersCommand, WorkerNetworkHeadersData>;
  cdp_call: CommandDef<CdpCallCommand, CdpCallData>;
  dom_eval: CommandDef<DomEvalCommand, DomEvalData>;
  dom_fill: CommandDef<DomFillCommand, DomFillData>;
  dom_click: CommandDef<DomClickCommand, DomClickData>;
  dom_submit: CommandDef<DomSubmitCommand, DomSubmitData>;
  dom_press_key: CommandDef<DomPressKeyCommand, DomPressKeyData>;
  dom_scroll: CommandDef<DomScrollCommand, DomScrollData>;
  dom_form_discover: CommandDef<DomFormDiscoverCommand, DomFormDiscoverData>;
};

/**
 * Creates a phantom command definition that carries request/response types only.
 *
 * @returns Empty schema objects typed as the inferred request and response
 */
function defineCommand<TReq, TRes>(): CommandDef<TReq, TRes> {
  return { requestSchema: {} as TReq, responseSchema: {} as TRes };
}

/**
 * Central registry of all worker commands.
 * Maps command names to their request/response schemas.
 */
export const COMMANDS: RegistryShape = {
  worker_peek: defineCommand(),
  worker_details: defineCommand(),
  worker_status: defineCommand(),
  worker_har_data: defineCommand(),
  worker_network_headers: defineCommand(),
  cdp_call: defineCommand(),
  dom_eval: defineCommand(),
  dom_fill: defineCommand(),
  dom_click: defineCommand(),
  dom_submit: defineCommand(),
  dom_press_key: defineCommand(),
  dom_scroll: defineCommand(),
  dom_form_discover: defineCommand(),
};

/**
 * All registered command schemas.
 */
export type CommandSchemas = typeof COMMANDS;

/**
 * All valid command names.
 */
export type CommandName = keyof typeof COMMANDS;
