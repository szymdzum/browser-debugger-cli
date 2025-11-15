/**
 * IPC Commands & Guards (flat)
 */

// Base command schemas (no IDs)
export interface WorkerPeekCommand {
  lastN?: number;
}
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

export interface WorkerDetailsCommand {
  itemType: 'network' | 'console';
  id: string;
}
export interface WorkerDetailsData {
  item: unknown;
}

export interface CdpCallCommand {
  method: string;
  params?: Record<string, unknown>;
}
export interface CdpCallData {
  result: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WorkerStatusCommand {}
export interface WorkerStatusData {
  startTime: number;
  duration: number;
  target: { url: string; title: string };
  activeTelemetry: string[];
  activity: {
    networkRequestsCaptured: number;
    consoleMessagesCaptured: number;
    lastNetworkRequestAt?: number;
    lastConsoleMessageAt?: number;
  };
}

type CommandDef<TReq, TRes> = { requestSchema: TReq; responseSchema: TRes };
export type RegistryShape = {
  worker_peek: CommandDef<WorkerPeekCommand, WorkerPeekData>;
  worker_details: CommandDef<WorkerDetailsCommand, WorkerDetailsData>;
  worker_status: CommandDef<WorkerStatusCommand, WorkerStatusData>;
  cdp_call: CommandDef<CdpCallCommand, CdpCallData>;
};

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

export type CommandSchemas = typeof COMMANDS;
export type CommandName = keyof typeof COMMANDS;

export type WorkerRequest<T extends CommandName> = {
  type: `${T}_request`;
  requestId: string;
} & (typeof COMMANDS)[T]['requestSchema'];

export type WorkerResponse<T extends CommandName> = {
  type: `${T}_response`;
  requestId: string;
  success: boolean;
  data?: (typeof COMMANDS)[T]['responseSchema'];
  error?: string;
};

export type ClientRequest<T extends CommandName> = {
  type: `${T}_request`;
  sessionId: string;
} & (typeof COMMANDS)[T]['requestSchema'];

export type ClientResponse<T extends CommandName> = {
  type: `${T}_response`;
  sessionId: string;
  status: 'ok' | 'error';
  data?: (typeof COMMANDS)[T]['responseSchema'];
  error?: string;
};

export type WorkerRequestUnion = { [K in CommandName]: WorkerRequest<K> }[CommandName];
export type WorkerResponseUnion = { [K in CommandName]: WorkerResponse<K> }[CommandName];
export type ClientRequestUnion = { [K in CommandName]: ClientRequest<K> }[CommandName];

export function isCommandRequest(type: string): type is `${CommandName}_request` {
  const commandName = type.replace('_request', '') as CommandName;
  return commandName in COMMANDS;
}

export function isCommandResponse(type: string): type is `${CommandName}_response` {
  const commandName = type.replace('_response', '') as CommandName;
  return commandName in COMMANDS;
}

export function getCommandName(type: string): CommandName | null {
  const commandName = type.replace(/_request|_response/, '') as CommandName;
  return commandName in COMMANDS ? commandName : null;
}
