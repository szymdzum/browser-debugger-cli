# IPC Pattern Simplification Analysis

## Current State Assessment

**Problem**: Adding a new command requires updating 5 files with significant duplication:

1. **src/daemon/workerIpc.ts** - Worker message types (request + response interfaces)
2. **src/ipc/types.ts** - Client message types (request + response interfaces)
3. **src/daemon/worker.ts** - Worker handler function + switch case
4. **src/daemon/ipcServer.ts** - Daemon forwarder function + 2 switch cases (handleMessage + handleWorkerResponse)
5. **src/ipc/client.ts** - Client helper function

**Current Implementation Pattern**:

```typescript
// Pattern for DOM commands (query, highlight, get):
// 1. Define types in workerIpc.ts (without sessionId)
// 2. Define duplicate types in ipc/types.ts (with sessionId)
// 3. Add handler in worker.ts (handleDomQuery, handleDomHighlight, handleDomGet)
// 4. Add case in worker.ts switch statement
// 5. Add forwarder in ipcServer.ts (handleDomQueryRequest, etc.)
// 6. Add case in ipcServer.ts handleMessage switch
// 7. Add case in ipcServer.ts handleWorkerResponse switch
// 8. Add forwarding function (forwardDomQueryResponse, etc.)
// 9. Add client helper in client.ts (queryDOM, highlightDOM, getDOM)
```

**Key Observations**:
- Worker types use `requestId`, client types use `sessionId`
- Daemon translates between these two ID fields
- Most message handling is pure forwarding with ID translation
- Each command follows identical pattern with only parameter differences

---

## Approach 1: Unified Command Types + Handler Registry

**Concept**: Define command types once, use utility types to add sessionId/requestId at boundaries, and use handler registries instead of switch statements.

### Code Example

**Step 1: Define shared command schemas** (new file: `src/ipc/commands.ts`)

```typescript
/**
 * Shared command schemas - defined once for both worker and client.
 * Base types have no IDs - they're added at boundaries via utility types.
 */

// Base command payload (no IDs)
export interface DomQueryCommand {
  selector: string;
}

export interface DomHighlightCommand {
  selector?: string;
  index?: number;
  nodeId?: number;
  first?: boolean;
  nth?: number;
  color?: string;
  opacity?: number;
}

export interface DomGetCommand {
  selector?: string;
  index?: number;
  nodeId?: number;
  all?: boolean;
  nth?: number;
}

// Base response payloads (no IDs, no success/error wrapper)
export interface DomQueryData {
  selector: string;
  count: number;
  nodes: Array<{
    index: number;
    nodeId: number;
    tag?: string;
    classes?: string[];
    preview?: string;
  }>;
}

export interface DomHighlightData {
  highlighted: number;
  nodeIds: number[];
}

export interface DomGetData {
  nodes: Array<{
    nodeId: number;
    tag?: string;
    attributes?: Record<string, string>;
    classes?: string[];
    outerHTML?: string;
  }>;
}

// Command registry - single source of truth
export const COMMANDS = {
  dom_query: {
    requestSchema: {} as DomQueryCommand,
    responseSchema: {} as DomQueryData,
  },
  dom_highlight: {
    requestSchema: {} as DomHighlightCommand,
    responseSchema: {} as DomHighlightData,
  },
  dom_get: {
    requestSchema: {} as DomGetCommand,
    responseSchema: {} as DomGetData,
  },
} as const;

export type CommandName = keyof typeof COMMANDS;

// Utility types to add IDs at boundaries
export type WorkerRequest<T extends CommandName> = {
  type: `${T}_request`;
  requestId: string;
} & typeof COMMANDS[T]['requestSchema'];

export type WorkerResponse<T extends CommandName> = {
  type: `${T}_response`;
  requestId: string;
  success: boolean;
  data?: typeof COMMANDS[T]['responseSchema'];
  error?: string;
};

export type ClientRequest<T extends CommandName> = {
  type: `${T}_request`;
  sessionId: string;
} & typeof COMMANDS[T]['requestSchema'];

export type ClientResponse<T extends CommandName> = {
  type: `${T}_response`;
  sessionId: string;
  status: 'ok' | 'error';
  data?: typeof COMMANDS[T]['responseSchema'];
  error?: string;
};
```

**Step 2: Update worker with handler registry** (`src/daemon/worker.ts`)

```typescript
import { COMMANDS, type CommandName, type WorkerRequest, type WorkerResponse } from '@/ipc/commands.js';
import { CDPConnection } from '@/connection/cdp.js';

// Handler registry - type-safe handlers for each command
type CommandHandler<T extends CommandName> = (
  cdp: CDPConnection,
  params: typeof COMMANDS[T]['requestSchema']
) => Promise<typeof COMMANDS[T]['responseSchema']>;

const commandHandlers: {
  [K in CommandName]: CommandHandler<K>;
} = {
  dom_query: async (cdp, params) => {
    // Existing handleDomQuery logic without message wrapping
    await cdp.send('DOM.enable');
    const nodeIds = await queryBySelector(cdp, params.selector);
    const nodes = [];
    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];
      if (nodeId === undefined) continue;
      const nodeInfo = await getNodeInfo(cdp, nodeId);
      nodes.push({
        index: i + 1,
        nodeId: nodeInfo.nodeId,
        ...(nodeInfo.tag !== undefined && { tag: nodeInfo.tag }),
        ...(nodeInfo.classes !== undefined && { classes: nodeInfo.classes }),
        preview: createNodePreview(nodeInfo),
      });
    }
    writeQueryCache({
      selector: params.selector,
      timestamp: new Date().toISOString(),
      nodes,
    });
    return {
      selector: params.selector,
      count: nodes.length,
      nodes,
    };
  },

  dom_highlight: async (cdp, params) => {
    // Existing handleDomHighlight logic without message wrapping
    await cdp.send('DOM.enable');
    await cdp.send('Overlay.enable');
    let nodeIds: number[] = [];

    if (params.nodeId !== undefined) {
      nodeIds = [params.nodeId];
    } else if (params.index !== undefined) {
      const nodeId = getNodeIdByIndex(params.index);
      if (!nodeId) {
        throw new Error(
          `No cached element at index ${params.index}. Run 'bdg dom query <selector>' first.`
        );
      }
      nodeIds = [nodeId];
    } else if (params.selector) {
      nodeIds = await queryBySelector(cdp, params.selector);
      if (nodeIds.length === 0) {
        throw new Error(`No elements found matching "${params.selector}"`);
      }
      if (params.first) {
        const firstNode = nodeIds[0];
        if (firstNode === undefined) throw new Error('No elements found');
        nodeIds = [firstNode];
      } else if (params.nth !== undefined) {
        if (params.nth < 1 || params.nth > nodeIds.length) {
          throw new Error(`--nth ${params.nth} out of range (found ${nodeIds.length} elements)`);
        }
        const nthNode = nodeIds[params.nth - 1];
        if (nthNode === undefined) throw new Error(`Element at index ${params.nth} not found`);
        nodeIds = [nthNode];
      }
    } else {
      throw new Error('Either selector, index, or nodeId must be provided');
    }

    const colorName = (params.color ?? 'red') as keyof typeof HIGHLIGHT_COLORS;
    const color = HIGHLIGHT_COLORS[colorName] ?? HIGHLIGHT_COLORS.red;
    const opacity = params.opacity ?? color.a;

    for (const nodeId of nodeIds) {
      await cdp.send('Overlay.highlightNode', {
        highlightConfig: {
          contentColor: { ...color, a: opacity },
        },
        nodeId,
      });
    }

    return {
      highlighted: nodeIds.length,
      nodeIds,
    };
  },

  dom_get: async (cdp, params) => {
    // Existing handleDomGet logic without message wrapping
    await cdp.send('DOM.enable');
    let nodeIds: number[] = [];

    if (params.nodeId !== undefined) {
      nodeIds = [params.nodeId];
    } else if (params.index !== undefined) {
      const nodeId = getNodeIdByIndex(params.index);
      if (!nodeId) {
        throw new Error(
          `No cached element at index ${params.index}. Run 'bdg dom query <selector>' first.`
        );
      }
      nodeIds = [nodeId];
    } else if (params.selector) {
      nodeIds = await queryBySelector(cdp, params.selector);
      if (nodeIds.length === 0) {
        throw new Error(`No elements found matching "${params.selector}"`);
      }
      if (params.nth !== undefined) {
        if (params.nth < 1 || params.nth > nodeIds.length) {
          throw new Error(`--nth ${params.nth} out of range (found ${nodeIds.length} elements)`);
        }
        const nthNode = nodeIds[params.nth - 1];
        if (nthNode === undefined) throw new Error(`Element at index ${params.nth} not found`);
        nodeIds = [nthNode];
      } else if (!params.all) {
        const firstNode = nodeIds[0];
        if (firstNode === undefined) throw new Error('No elements found');
        nodeIds = [firstNode];
      }
    } else {
      throw new Error('Either selector, index, or nodeId must be provided');
    }

    const nodes = [];
    for (const nodeId of nodeIds) {
      const info = await getNodeInfo(cdp, nodeId);
      nodes.push({
        nodeId: info.nodeId,
        ...(info.tag !== undefined && { tag: info.tag }),
        ...(info.attributes !== undefined && { attributes: info.attributes }),
        ...(info.classes !== undefined && { classes: info.classes }),
        ...(info.outerHTML !== undefined && { outerHTML: info.outerHTML }),
      });
    }

    return { nodes };
  },
};

// Generic message handler - replaces switch statement
async function handleWorkerIPC(message: WorkerRequest<CommandName>): Promise<void> {
  // Extract command name from message type (e.g., "dom_query_request" -> "dom_query")
  const commandName = message.type.replace('_request', '') as CommandName;
  const handler = commandHandlers[commandName];

  if (!handler) {
    console.error(`[worker] Unknown command: ${commandName}`);
    return;
  }

  console.error(`[worker] Handling ${commandName}_request`);

  try {
    if (!cdp) {
      throw new Error('CDP connection not initialized');
    }

    // Extract params (everything except type and requestId)
    const { type, requestId, ...params } = message;

    // Call handler
    const data = await handler(cdp, params as any);

    // Send success response
    const response: WorkerResponse<typeof commandName> = {
      type: `${commandName}_response` as const,
      requestId: message.requestId,
      success: true,
      data,
    };

    console.log(JSON.stringify(response));
    console.error(`[worker] Sent ${commandName}_response (success)`);
  } catch (error) {
    // Send error response
    const response: WorkerResponse<typeof commandName> = {
      type: `${commandName}_response` as const,
      requestId: message.requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };

    console.log(JSON.stringify(response));
    console.error(`[worker] Sent ${commandName}_response (error: ${response.error})`);
  }
}

// Setup stdin listener (simplified)
function setupStdinListener(): void {
  let buffer = '';

  process.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as WorkerRequest<CommandName>;
          void handleWorkerIPC(message);
        } catch (error) {
          console.error(
            `[worker] Failed to parse IPC message: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  });

  process.stdin.on('end', () => {
    console.error('[worker] Stdin closed, daemon disconnected');
  });

  console.error('[worker] Stdin listener set up for IPC commands');
}
```

**Step 3: Update daemon with generic forwarding** (`src/daemon/ipcServer.ts`)

```typescript
import { COMMANDS, type CommandName, type ClientRequest, type ClientResponse, type WorkerRequest, type WorkerResponse } from '@/ipc/commands.js';

// Generic request forwarder - replaces individual handler methods
private handleCommandRequest(socket: Socket, request: ClientRequest<CommandName>): void {
  const commandName = request.type.replace('_request', '') as CommandName;
  console.error(`[daemon] ${commandName} request received (sessionId: ${request.sessionId})`);

  // Check if worker is available
  if (!this.workerProcess?.stdin) {
    const response: ClientResponse<typeof commandName> = {
      type: `${commandName}_response` as const,
      sessionId: request.sessionId,
      status: 'error',
      error: 'No active worker process',
    };

    socket.write(JSON.stringify(response) + '\n');
    console.error(`[daemon] ${commandName} error response sent (no worker)`);
    return;
  }

  // Generate unique requestId
  const requestId = `${commandName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Set up timeout (10 seconds for DOM commands)
  const timeout = setTimeout(() => {
    this.pendingDomRequests.delete(requestId);

    const response: ClientResponse<typeof commandName> = {
      type: `${commandName}_response` as const,
      sessionId: request.sessionId,
      status: 'error',
      error: 'Worker response timeout (10s)',
    };

    socket.write(JSON.stringify(response) + '\n');
    console.error(`[daemon] ${commandName} timeout response sent`);
  }, 10000);

  // Store pending request
  this.pendingDomRequests.set(requestId, {
    socket,
    sessionId: request.sessionId,
    timeout,
  });

  // Forward to worker (translate sessionId -> requestId)
  const { sessionId, ...params } = request;
  const workerRequest: WorkerRequest<typeof commandName> = {
    ...params,
    requestId,
  } as WorkerRequest<typeof commandName>;

  this.workerProcess.stdin.write(JSON.stringify(workerRequest) + '\n');
  console.error(`[daemon] Forwarded ${commandName}_request to worker (requestId: ${requestId})`);
}

// Simplified handleMessage - uses registry
private handleMessage(socket: Socket, line: string): void {
  console.error('[daemon] Raw frame:', line);

  try {
    const message = JSON.parse(line) as ClientRequest<CommandName>;

    // Check if it's a registered command
    const commandName = message.type.replace('_request', '') as CommandName;
    if (COMMANDS[commandName]) {
      this.handleCommandRequest(socket, message);
      return;
    }

    // Fall back to original switch for non-command messages
    switch (message.type) {
      case 'handshake_request':
        this.handleHandshake(socket, message as HandshakeRequest);
        break;
      case 'status_request':
        this.handleStatusRequest(socket, message as StatusRequest);
        break;
      case 'peek_request':
        this.handlePeekRequest(socket, message as PeekRequest);
        break;
      case 'start_session_request':
        void this.handleStartSessionRequest(socket, message as StartSessionRequest);
        break;
      case 'stop_session_request':
        this.handleStopSessionRequest(socket, message as StopSessionRequest);
        break;
      default:
        console.error(`[daemon] Unknown message type: ${message.type}`);
    }
  } catch (error) {
    console.error('[daemon] Failed to parse message:', error);
  }
}

// Generic response forwarder - replaces individual forward methods
private handleWorkerResponse(message: WorkerResponse<CommandName>): void {
  console.error(
    `[daemon] Received worker response: ${message.type} (requestId: ${message.requestId})`
  );

  // Look up pending request
  const pending = this.pendingDomRequests.get(message.requestId);
  if (!pending) {
    console.error(`[daemon] No pending request found for requestId: ${message.requestId}`);
    return;
  }

  // Clear timeout and remove from pending
  clearTimeout(pending.timeout);
  this.pendingDomRequests.delete(message.requestId);

  // Forward response to client (translate requestId -> sessionId, success -> status)
  const commandName = message.type.replace('_response', '') as CommandName;
  const { requestId, success, ...rest } = message;

  const response: ClientResponse<typeof commandName> = {
    ...rest,
    type: `${commandName}_response` as const,
    sessionId: pending.sessionId,
    status: success ? 'ok' : 'error',
  } as ClientResponse<typeof commandName>;

  pending.socket.write(JSON.stringify(response) + '\n');
  console.error(`[daemon] Forwarded ${commandName}_response to client`);
}
```

**Step 4: Update client with generic helper** (`src/ipc/client.ts`)

```typescript
import { COMMANDS, type CommandName, type ClientRequest, type ClientResponse } from '@/ipc/commands.js';

/**
 * Generic command sender - works for any registered command.
 */
async function sendCommand<T extends CommandName>(
  commandName: T,
  params: typeof COMMANDS[T]['requestSchema']
): Promise<ClientResponse<T>> {
  const request: ClientRequest<T> = {
    type: `${commandName}_request` as const,
    sessionId: randomUUID(),
    ...params,
  } as ClientRequest<T>;

  return sendRequest<ClientRequest<T>, ClientResponse<T>>(request, commandName);
}

// Convenience helpers - now just thin wrappers
export async function queryDOM(selector: string): Promise<ClientResponse<'dom_query'>> {
  return sendCommand('dom_query', { selector });
}

export async function highlightDOM(options: {
  selector?: string;
  index?: number;
  nodeId?: number;
  first?: boolean;
  nth?: number;
  color?: string;
  opacity?: number;
}): Promise<ClientResponse<'dom_highlight'>> {
  return sendCommand('dom_highlight', options);
}

export async function getDOM(options: {
  selector?: string;
  index?: number;
  nodeId?: number;
  all?: boolean;
  nth?: number;
}): Promise<ClientResponse<'dom_get'>> {
  return sendCommand('dom_get', options);
}
```

### Pros & Cons

**Pros**:
- ✅ Single source of truth for command schemas (`COMMANDS` registry)
- ✅ Type duplication eliminated - utility types add IDs at boundaries
- ✅ Switch statements replaced with handler registries
- ✅ Adding new command requires updates to **2 files only**:
  1. `src/ipc/commands.ts` - Add schema + handler registry entry
  2. `src/daemon/worker.ts` - Add handler implementation
  3. Optional: Add convenience helper in `src/ipc/client.ts`
- ✅ Strong type safety maintained - TypeScript knows command schemas
- ✅ Generic forwarding logic eliminates boilerplate
- ✅ Compatible with existing JSONL protocol

**Cons**:
- ⚠️ Requires moderate refactoring effort (1-2 days)
- ⚠️ Handler registry pattern may be less familiar to some developers
- ⚠️ Generic types (utility types) add some complexity
- ⚠️ Need to ensure type inference works correctly with utility types

### Files Changed for New Command

**Before**: 5 files (150-200 lines of code)
**After**: 2-3 files (50-70 lines of code)

**Adding a new "dom_click" command**:

1. **src/ipc/commands.ts** (~20 lines):
   ```typescript
   export interface DomClickCommand {
     selector?: string;
     index?: number;
     nodeId?: number;
   }

   export interface DomClickData {
     clicked: boolean;
     nodeId: number;
   }

   export const COMMANDS = {
     // ... existing commands
     dom_click: {
       requestSchema: {} as DomClickCommand,
       responseSchema: {} as DomClickData,
     },
   } as const;
   ```

2. **src/daemon/worker.ts** (~30 lines):
   ```typescript
   const commandHandlers = {
     // ... existing handlers
     dom_click: async (cdp, params) => {
       await cdp.send('DOM.enable');
       let nodeId: number;

       if (params.nodeId !== undefined) {
         nodeId = params.nodeId;
       } else if (params.index !== undefined) {
         nodeId = getNodeIdByIndex(params.index);
         if (!nodeId) throw new Error('No cached element');
       } else if (params.selector) {
         const nodeIds = await queryBySelector(cdp, params.selector);
         if (nodeIds.length === 0) throw new Error('No elements found');
         nodeId = nodeIds[0]!;
       } else {
         throw new Error('selector, index, or nodeId required');
       }

       // Trigger click
       await cdp.send('Runtime.evaluate', {
         expression: `document.querySelector('[data-node-id="${nodeId}"]').click()`,
       });

       return { clicked: true, nodeId };
     },
   };
   ```

3. **src/ipc/client.ts** (optional, ~10 lines):
   ```typescript
   export async function clickDOM(options: {
     selector?: string;
     index?: number;
     nodeId?: number;
   }): Promise<ClientResponse<'dom_click'>> {
     return sendCommand('dom_click', options);
   }
   ```

---

## Approach 2: Generic Command Pattern (Trade Type Safety for Simplicity)

**Concept**: Use a single generic message type with command name + params. Sacrifice compile-time type safety for extreme simplicity.

### Code Example

**Step 1: Define generic message types** (`src/ipc/types.ts`)

```typescript
/**
 * Generic command message - works for any command.
 */
export interface GenericRequest {
  type: 'command_request';
  sessionId: string;
  command: string; // e.g., "dom_query", "dom_highlight"
  params: Record<string, unknown>; // Arbitrary parameters
}

export interface GenericResponse {
  type: 'command_response';
  sessionId: string;
  command: string;
  status: 'ok' | 'error';
  data?: unknown;
  error?: string;
}

// Worker equivalent
export interface GenericWorkerRequest {
  type: 'command_request';
  requestId: string;
  command: string;
  params: Record<string, unknown>;
}

export interface GenericWorkerResponse {
  type: 'command_response';
  requestId: string;
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}
```

**Step 2: Worker with generic handler** (`src/daemon/worker.ts`)

```typescript
// Handler registry - maps command names to handler functions
type GenericHandler = (cdp: CDPConnection, params: Record<string, unknown>) => Promise<unknown>;

const commandHandlers: Record<string, GenericHandler> = {
  dom_query: async (cdp, params) => {
    const { selector } = params as { selector: string }; // Manual type assertion
    await cdp.send('DOM.enable');
    const nodeIds = await queryBySelector(cdp, selector);
    // ... rest of logic
    return { selector, count: nodeIds.length, nodes };
  },

  dom_highlight: async (cdp, params) => {
    const { selector, index, nodeId, first, nth, color, opacity } = params as {
      selector?: string;
      index?: number;
      nodeId?: number;
      first?: boolean;
      nth?: number;
      color?: string;
      opacity?: number;
    };
    await cdp.send('DOM.enable');
    await cdp.send('Overlay.enable');
    // ... rest of logic
    return { highlighted: nodeIds.length, nodeIds };
  },

  dom_get: async (cdp, params) => {
    const { selector, index, nodeId, all, nth } = params as {
      selector?: string;
      index?: number;
      nodeId?: number;
      all?: boolean;
      nth?: number;
    };
    await cdp.send('DOM.enable');
    // ... rest of logic
    return { nodes };
  },
};

// Single handler for all commands
async function handleWorkerIPC(message: GenericWorkerRequest): Promise<void> {
  const { command, requestId, params } = message;
  const handler = commandHandlers[command];

  if (!handler) {
    console.error(`[worker] Unknown command: ${command}`);
    const response: GenericWorkerResponse = {
      type: 'command_response',
      requestId,
      command,
      success: false,
      error: `Unknown command: ${command}`,
    };
    console.log(JSON.stringify(response));
    return;
  }

  console.error(`[worker] Handling command: ${command}`);

  try {
    if (!cdp) {
      throw new Error('CDP connection not initialized');
    }

    const data = await handler(cdp, params);

    const response: GenericWorkerResponse = {
      type: 'command_response',
      requestId,
      command,
      success: true,
      data,
    };

    console.log(JSON.stringify(response));
    console.error(`[worker] Sent ${command} response (success)`);
  } catch (error) {
    const response: GenericWorkerResponse = {
      type: 'command_response',
      requestId,
      command,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };

    console.log(JSON.stringify(response));
    console.error(`[worker] Sent ${command} response (error: ${response.error})`);
  }
}
```

**Step 3: Daemon generic forwarding** (`src/daemon/ipcServer.ts`)

```typescript
// Single method handles all commands
private handleGenericCommand(socket: Socket, request: GenericRequest): void {
  const { command, sessionId } = request;
  console.error(`[daemon] Command request received: ${command} (sessionId: ${sessionId})`);

  if (!this.workerProcess?.stdin) {
    const response: GenericResponse = {
      type: 'command_response',
      sessionId,
      command,
      status: 'error',
      error: 'No active worker process',
    };
    socket.write(JSON.stringify(response) + '\n');
    return;
  }

  const requestId = `${command}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const timeout = setTimeout(() => {
    this.pendingRequests.delete(requestId);
    const response: GenericResponse = {
      type: 'command_response',
      sessionId,
      command,
      status: 'error',
      error: 'Worker response timeout (10s)',
    };
    socket.write(JSON.stringify(response) + '\n');
  }, 10000);

  this.pendingRequests.set(requestId, {
    socket,
    sessionId,
    command,
    timeout,
  });

  const workerRequest: GenericWorkerRequest = {
    type: 'command_request',
    requestId,
    command,
    params: request.params,
  };

  this.workerProcess.stdin.write(JSON.stringify(workerRequest) + '\n');
}

// Single message handler
private handleMessage(socket: Socket, line: string): void {
  try {
    const message = JSON.parse(line);

    if (message.type === 'command_request') {
      this.handleGenericCommand(socket, message as GenericRequest);
      return;
    }

    // Handle other message types (handshake, status, etc.)
    // ...
  } catch (error) {
    console.error('[daemon] Failed to parse message:', error);
  }
}

// Single response forwarder
private handleWorkerResponse(message: GenericWorkerResponse): void {
  const pending = this.pendingRequests.get(message.requestId);
  if (!pending) return;

  clearTimeout(pending.timeout);
  this.pendingRequests.delete(message.requestId);

  const response: GenericResponse = {
    type: 'command_response',
    sessionId: pending.sessionId,
    command: message.command,
    status: message.success ? 'ok' : 'error',
    data: message.data,
    error: message.error,
  };

  pending.socket.write(JSON.stringify(response) + '\n');
}
```

**Step 4: Client generic sender** (`src/ipc/client.ts`)

```typescript
// Single generic command sender
async function sendCommand(
  command: string,
  params: Record<string, unknown>
): Promise<GenericResponse> {
  const request: GenericRequest = {
    type: 'command_request',
    sessionId: randomUUID(),
    command,
    params,
  };

  return sendRequest<GenericRequest, GenericResponse>(request, command);
}

// Convenience wrappers with type hints (TypeScript can't check params)
export async function queryDOM(selector: string): Promise<GenericResponse> {
  return sendCommand('dom_query', { selector });
}

export async function highlightDOM(options: {
  selector?: string;
  index?: number;
  nodeId?: number;
  first?: boolean;
  nth?: number;
  color?: string;
  opacity?: number;
}): Promise<GenericResponse> {
  return sendCommand('dom_highlight', options);
}

export async function getDOM(options: {
  selector?: string;
  index?: number;
  nodeId?: number;
  all?: boolean;
  nth?: number;
}): Promise<GenericResponse> {
  return sendCommand('dom_get', options);
}
```

### Pros & Cons

**Pros**:
- ✅ **Extreme simplicity** - minimal boilerplate
- ✅ Adding new command requires updates to **1 file only** (worker.ts handler registry)
- ✅ No type duplication at all
- ✅ Generic forwarding eliminates all switch statements
- ✅ Compatible with existing JSONL protocol

**Cons**:
- ❌ **Loss of compile-time type safety** - params are `Record<string, unknown>`
- ❌ Manual type assertions required in handlers (runtime risk)
- ❌ No autocomplete for command params in IDE
- ❌ Harder to catch parameter mismatches during development
- ❌ Response data is `unknown` - requires type assertions at call site

### Files Changed for New Command

**Before**: 5 files (150-200 lines)
**After**: 1 file (15-20 lines)

**Adding "dom_click" command**:

```typescript
// Only change: src/daemon/worker.ts
const commandHandlers: Record<string, GenericHandler> = {
  // ... existing handlers
  dom_click: async (cdp, params) => {
    const { selector, index, nodeId } = params as {
      selector?: string;
      index?: number;
      nodeId?: number;
    };

    // ... implementation
    return { clicked: true, nodeId };
  },
};
```

---

## Approach 3: RPC Library Integration (kkRPC)

**Concept**: Use kkRPC library for stdin/stdout and Unix socket communication with built-in type safety.

### Investigation Summary

**kkRPC** (https://github.com/kunkunsh/kkrpc) is the most relevant lightweight RPC library that supports:
- stdin/stdout communication (NodeIo adapter)
- Unix sockets (via custom adapters)
- TypeScript with type safety
- Bidirectional communication
- Callback support

**Installation**:
```bash
npm install kkrpc
```

### Code Example

**Step 1: Define shared API interface** (`src/ipc/api.ts`)

```typescript
/**
 * Shared API interface - both client and worker implement this.
 */
export interface WorkerAPI {
  domQuery(selector: string): Promise<{
    selector: string;
    count: number;
    nodes: Array<{
      index: number;
      nodeId: number;
      tag?: string;
      classes?: string[];
      preview?: string;
    }>;
  }>;

  domHighlight(options: {
    selector?: string;
    index?: number;
    nodeId?: number;
    first?: boolean;
    nth?: number;
    color?: string;
    opacity?: number;
  }): Promise<{
    highlighted: number;
    nodeIds: number[];
  }>;

  domGet(options: {
    selector?: string;
    index?: number;
    nodeId?: number;
    all?: boolean;
    nth?: number;
  }): Promise<{
    nodes: Array<{
      nodeId: number;
      tag?: string;
      attributes?: Record<string, string>;
      classes?: string[];
      outerHTML?: string;
    }>;
  }>;
}
```

**Step 2: Worker implementation** (`src/daemon/worker.ts`)

```typescript
import { NodeIo, RPCChannel } from 'kkrpc';
import type { WorkerAPI } from '@/ipc/api.js';

// Implement API methods
const workerAPI: WorkerAPI = {
  async domQuery(selector) {
    if (!cdp) throw new Error('CDP not initialized');

    await cdp.send('DOM.enable');
    const nodeIds = await queryBySelector(cdp, selector);
    const nodes = [];

    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];
      if (nodeId === undefined) continue;
      const nodeInfo = await getNodeInfo(cdp, nodeId);
      nodes.push({
        index: i + 1,
        nodeId: nodeInfo.nodeId,
        ...(nodeInfo.tag !== undefined && { tag: nodeInfo.tag }),
        ...(nodeInfo.classes !== undefined && { classes: nodeInfo.classes }),
        preview: createNodePreview(nodeInfo),
      });
    }

    writeQueryCache({ selector, timestamp: new Date().toISOString(), nodes });
    return { selector, count: nodes.length, nodes };
  },

  async domHighlight(options) {
    if (!cdp) throw new Error('CDP not initialized');

    await cdp.send('DOM.enable');
    await cdp.send('Overlay.enable');

    // ... existing logic

    return { highlighted: nodeIds.length, nodeIds };
  },

  async domGet(options) {
    if (!cdp) throw new Error('CDP not initialized');

    await cdp.send('DOM.enable');

    // ... existing logic

    return { nodes };
  },
};

// Set up RPC channel over stdin/stdout
function setupRPCChannel(): void {
  const stdio = new NodeIo(process.stdin, process.stdout);
  const channel = new RPCChannel(stdio, { expose: workerAPI });

  console.error('[worker] RPC channel established over stdin/stdout');
}
```

**Step 3: Daemon RPC bridge** (`src/daemon/ipcServer.ts`)

```typescript
import { NodeIo, RPCChannel } from 'kkrpc';
import type { WorkerAPI } from '@/ipc/api.js';

export class IPCServer {
  private workerRPC: RPCChannel<WorkerAPI> | null = null;

  private async handleStartSessionRequest(
    socket: Socket,
    request: StartSessionRequest
  ): Promise<void> {
    // ... existing launch logic

    // Set up RPC channel to worker
    if (metadata.workerProcess.stdout && metadata.workerProcess.stdin) {
      const stdio = new NodeIo(
        metadata.workerProcess.stdout,
        metadata.workerProcess.stdin
      );
      this.workerRPC = new RPCChannel<WorkerAPI>(stdio);
      console.error('[daemon] RPC channel to worker established');
    }

    // ... send response
  }

  private async handleDomQueryRequest(socket: Socket, request: DomQueryRequest): Promise<void> {
    console.error(`[daemon] DOM query request received (sessionId: ${request.sessionId})`);

    if (!this.workerRPC) {
      const response: DomQueryResponse = {
        type: 'dom_query_response',
        sessionId: request.sessionId,
        status: 'error',
        error: 'No active worker RPC channel',
      };
      socket.write(JSON.stringify(response) + '\n');
      return;
    }

    try {
      // Call worker method via RPC (fully typed!)
      const data = await this.workerRPC.remote.domQuery(request.selector);

      const response: DomQueryResponse = {
        type: 'dom_query_response',
        sessionId: request.sessionId,
        status: 'ok',
        data,
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] DOM query response sent');
    } catch (error) {
      const response: DomQueryResponse = {
        type: 'dom_query_response',
        sessionId: request.sessionId,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };

      socket.write(JSON.stringify(response) + '\n');
    }
  }
}
```

**Step 4: Client remains unchanged** (`src/ipc/client.ts`)

```typescript
// Client stays the same - still uses Unix socket JSONL
// Daemon handles RPC translation internally
export async function queryDOM(selector: string): Promise<DomQueryResponse> {
  const request: DomQueryRequest = {
    type: 'dom_query_request',
    sessionId: randomUUID(),
    selector,
  };

  return sendRequest<DomQueryRequest, DomQueryResponse>(request, 'dom query');
}
```

### Pros & Cons

**Pros**:
- ✅ Full type safety with shared interface
- ✅ IDE autocomplete for all API methods
- ✅ No manual message type definitions needed (RPC handles it)
- ✅ Eliminates all forwarding boilerplate in worker
- ✅ Built-in error handling and serialization

**Cons**:
- ❌ **Additional dependency** (kkrpc ~50KB, may have transitive deps)
- ❌ Daemon still needs to translate between RPC and JSONL (hybrid approach)
- ❌ Client-daemon communication still uses custom JSONL (not RPC)
- ❌ Learning curve for new RPC abstraction
- ❌ Harder to debug (RPC layer adds indirection)
- ❌ May not support Unix sockets directly (requires custom adapter)

### Files Changed for New Command

**Before**: 5 files (150-200 lines)
**After**: 3 files (40-50 lines)

**Adding "dom_click" command**:

1. **src/ipc/api.ts** (~10 lines):
   ```typescript
   export interface WorkerAPI {
     // ... existing methods
     domClick(options: { selector?: string; index?: number; nodeId?: number }): Promise<{
       clicked: boolean;
       nodeId: number;
     }>;
   }
   ```

2. **src/daemon/worker.ts** (~20 lines):
   ```typescript
   const workerAPI: WorkerAPI = {
     // ... existing methods
     async domClick(options) {
       if (!cdp) throw new Error('CDP not initialized');
       // ... implementation
       return { clicked: true, nodeId };
     },
   };
   ```

3. **src/daemon/ipcServer.ts** (~10 lines):
   ```typescript
   private async handleDomClickRequest(socket: Socket, request: DomClickRequest): Promise<void> {
     if (!this.workerRPC) { /* error */ }
     const data = await this.workerRPC.remote.domClick({
       selector: request.selector,
       index: request.index,
       nodeId: request.nodeId,
     });
     // ... send response
   }
   ```

4. **src/ipc/types.ts** (still need client types)
5. **src/ipc/client.ts** (convenience helper)

---

## Recommendation

### Best Approach: **Approach 1 (Unified Types + Handler Registry)**

**Reasoning**:

1. **Optimal Balance**: Maintains strong type safety while drastically reducing boilerplate
2. **No New Dependencies**: Uses only TypeScript features, no external libraries
3. **Significant Simplification**: Reduces 5 files → 2-3 files per command
4. **Pattern Familiarity**: Handler registries are well-known pattern in Node.js
5. **Maintainability**: Single source of truth for command schemas
6. **Incremental Migration**: Can be adopted gradually without breaking existing code

**Implementation Effort**: 1-2 days
- Day 1: Refactor worker and daemon to use handler registries
- Day 2: Update client helpers and test thoroughly

### Alternative: **Approach 2 (Generic Commands)** if...

- You value extreme simplicity over type safety
- Team is comfortable with runtime type assertions
- Command schemas change frequently (less type maintenance)
- You want the absolute minimum lines of code

**Not Recommended: Approach 3 (RPC Library)** because:

- Adds external dependency for marginal benefit
- Still requires hybrid JSONL/RPC architecture (daemon is middleman)
- Doesn't simplify client-daemon communication
- Debugging becomes harder with RPC abstraction layer
- Unix socket support may require custom adapter development

---

## Migration Path (Approach 1)

**Phase 1: Prepare Infrastructure** (2-3 hours)
1. Create `src/ipc/commands.ts` with command registry
2. Define utility types (`WorkerRequest`, `ClientRequest`, etc.)
3. Add first command (dom_query) to registry

**Phase 2: Refactor Worker** (3-4 hours)
1. Create handler registry in worker.ts
2. Move existing handler logic into registry functions
3. Replace switch statement with generic handler
4. Test with single command (dom_query)

**Phase 3: Refactor Daemon** (3-4 hours)
1. Add generic command request handler
2. Update handleMessage to check command registry
3. Add generic worker response forwarder
4. Test end-to-end with single command

**Phase 4: Migrate Remaining Commands** (2-3 hours)
1. Add dom_highlight to registry
2. Add dom_get to registry
3. Remove old switch cases
4. Update client helpers to use new types

**Phase 5: Cleanup** (1 hour)
1. Remove duplicate types from workerIpc.ts and ipc/types.ts
2. Update documentation
3. Run full test suite

**Total Estimated Time**: 11-15 hours (1.5-2 days)

---

## Example: Complete "dom_click" Command (Approach 1)

Here's what adding a complete new command looks like with Approach 1:

**File 1: src/ipc/commands.ts** (add to registry)
```typescript
export interface DomClickCommand {
  selector?: string;
  index?: number;
  nodeId?: number;
}

export interface DomClickData {
  clicked: boolean;
  nodeId: number;
}

export const COMMANDS = {
  // ... existing commands
  dom_click: {
    requestSchema: {} as DomClickCommand,
    responseSchema: {} as DomClickData,
  },
} as const;
```

**File 2: src/daemon/worker.ts** (add handler)
```typescript
const commandHandlers: { [K in CommandName]: CommandHandler<K> } = {
  // ... existing handlers
  dom_click: async (cdp, params) => {
    await cdp.send('DOM.enable');

    let nodeId: number;
    if (params.nodeId !== undefined) {
      nodeId = params.nodeId;
    } else if (params.index !== undefined) {
      const cached = getNodeIdByIndex(params.index);
      if (!cached) throw new Error('No cached element');
      nodeId = cached;
    } else if (params.selector) {
      const nodeIds = await queryBySelector(cdp, params.selector);
      if (nodeIds.length === 0) throw new Error('No elements found');
      nodeId = nodeIds[0]!;
    } else {
      throw new Error('selector, index, or nodeId required');
    }

    // Get element bounds for click coordinates
    const boxModel = await cdp.send('DOM.getBoxModel', { nodeId });
    const quad = boxModel.model.content;
    const x = (quad[0] + quad[2]) / 2;
    const y = (quad[1] + quad[5]) / 2;

    // Trigger click via Input domain
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });

    return { clicked: true, nodeId };
  },
};
```

**File 3 (Optional): src/ipc/client.ts** (convenience helper)
```typescript
export async function clickDOM(options: {
  selector?: string;
  index?: number;
  nodeId?: number;
}): Promise<ClientResponse<'dom_click'>> {
  return sendCommand('dom_click', options);
}
```

**That's it!** No changes needed to:
- ❌ ~~src/daemon/ipcServer.ts~~ (generic forwarding handles it)
- ❌ ~~Switch statements~~ (registry handles routing)
- ❌ ~~Type duplication~~ (utility types handle ID fields)

**Usage in CLI**:
```typescript
// In CLI command handler
const response = await clickDOM({ selector: 'button.submit' });
if (response.status === 'ok') {
  console.log(`Clicked element with nodeId: ${response.data?.nodeId}`);
}
```

---

## Conclusion

**Approach 1 (Unified Types + Handler Registry)** is the recommended solution because it:

1. **Reduces complexity**: 5 files → 2-3 files per command (60% reduction)
2. **Maintains type safety**: Full TypeScript support with utility types
3. **Eliminates boilerplate**: Generic forwarding replaces switch statements
4. **Single source of truth**: Command registry defines all schemas
5. **No dependencies**: Pure TypeScript solution
6. **Incremental adoption**: Can migrate one command at a time

The migration effort is reasonable (1.5-2 days) and the long-term maintainability gains are substantial. Every future command will require only 2-3 file updates instead of 5, saving significant development time.
