# Bidirectional IPC Pattern

This document describes the generic bidirectional IPC (Inter-Process Communication) pattern used for routing commands between the CLI, daemon, and worker processes.

## Architecture Overview

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│             │  Unix   │                  │  stdin  │                 │
│ CLI Command │ Socket  │  Daemon (IPC     │ ───────>│  Worker Process │
│             │ ──────> │   Server)        │         │  (CDP Handler)  │
│             │         │                  │<─────── │                 │
└─────────────┘         └──────────────────┘  stdout └─────────────────┘
                                 │                            │
                                 │                            │
                                 └────────────────────────────┘
                            Request/Response Matching
                                (via requestId)
```

### Components

1. **CLI Command** (`src/cli/collectors/*.ts`)
   - User-facing command handlers
   - Calls IPC client functions
   - Formats output for user

2. **IPC Client** (`src/ipc/client.ts`)
   - Connects to daemon via Unix socket
   - Sends JSONL requests
   - Waits for JSONL responses
   - Handles timeouts and errors

3. **Daemon IPC Server** (`src/daemon/ipcServer.ts`)
   - Listens on Unix socket for client connections
   - Tracks active worker process
   - Routes requests to worker via stdin
   - Routes responses back to clients via socket
   - Matches requests/responses by `requestId`

4. **Worker Process** (`src/daemon/worker.ts`)
   - Maintains persistent CDP connection
   - Listens on stdin for daemon commands
   - Executes CDP operations
   - Sends responses to stdout

## Communication Flow

### Request Flow (CLI → Worker)

1. **CLI calls IPC client function**
   ```typescript
   const response = await queryDOM("p");
   ```

2. **IPC client sends request to daemon**
   ```json
   {"type":"dom_query_request","sessionId":"uuid","selector":"p"}
   ```

3. **Daemon forwards to worker via stdin**
   ```json
   {"type":"dom_query_request","requestId":"dom_query_123_abc","selector":"p"}
   ```

4. **Worker executes CDP command**
   ```typescript
   const nodeIds = await cdp.send('DOM.querySelectorAll', {...});
   ```

### Response Flow (Worker → CLI)

1. **Worker sends response to stdout**
   ```json
   {"type":"dom_query_response","requestId":"dom_query_123_abc","success":true,"data":{...}}
   ```

2. **Daemon matches requestId and forwards to client**
   ```json
   {"type":"dom_query_response","sessionId":"uuid","status":"ok","data":{...}}
   ```

3. **IPC client resolves promise with response**
   ```typescript
   // Promise resolves with response data
   ```

4. **CLI formats and displays output**
   ```
   Found 3 elements matching "p":
     [1] <p> Hello world
     [2] <p> Another paragraph
     [3] <p> Third element
   ```

## Adding a New Command

Follow this 5-step pattern to add any new command:

### Step 1: Define Worker IPC Types

Add message types to `src/daemon/workerIpc.ts`:

```typescript
/**
 * Request from daemon to worker
 */
export interface WorkerFooRequest extends WorkerIPCMessage {
  type: 'foo_request';
  requestId: string;
  param1: string;
  param2?: number;
}

/**
 * Response from worker to daemon
 */
export interface WorkerFooResponse extends WorkerIPCMessage {
  type: 'foo_response';
  requestId: string;
  success: boolean;
  data?: {
    result: string;
  };
  error?: string;
}

// Add to union types
export type WorkerIPCRequest =
  | WorkerDomQueryRequest
  | WorkerDomHighlightRequest
  | WorkerDomGetRequest
  | WorkerFooRequest; // Add here

export type WorkerIPCResponse =
  | WorkerReadyMessage
  | WorkerDomQueryResponse
  | WorkerDomHighlightResponse
  | WorkerDomGetResponse
  | WorkerFooResponse; // Add here
```

### Step 2: Define Client IPC Types

Add message types to `src/ipc/types.ts`:

```typescript
/**
 * Request from CLI client to daemon
 */
export interface FooRequest extends IPCMessage {
  type: 'foo_request';
  sessionId: string;
  param1: string;
  param2?: number;
}

/**
 * Response from daemon to CLI client
 */
export interface FooResponse extends IPCMessage {
  type: 'foo_response';
  sessionId: string;
  status: 'ok' | 'error';
  data?: {
    result: string;
  };
  error?: string;
}

// Add to union types
export type IPCMessageType =
  | HandshakeRequest
  | HandshakeResponse
  | StatusRequest
  | StatusResponse
  | PeekRequest
  | PeekResponse
  | StartSessionRequest
  | StartSessionResponse
  | StopSessionRequest
  | StopSessionResponse
  | DomQueryRequest
  | DomQueryResponse
  | DomHighlightRequest
  | DomHighlightResponse
  | DomGetRequest
  | DomGetResponse
  | FooRequest      // Add here
  | FooResponse;    // Add here

export type IPCRequest =
  | HandshakeRequest
  | StatusRequest
  | PeekRequest
  | StartSessionRequest
  | StopSessionRequest
  | DomQueryRequest
  | DomHighlightRequest
  | DomGetRequest
  | FooRequest;     // Add here

export type IPCResponse =
  | HandshakeResponse
  | StatusResponse
  | PeekResponse
  | StartSessionResponse
  | StopSessionResponse
  | DomQueryResponse
  | DomHighlightResponse
  | DomGetResponse
  | FooResponse;    // Add here
```

### Step 3: Implement Worker Handler

Add handler in `src/daemon/worker.ts`:

```typescript
/**
 * Handle foo request from daemon.
 */
async function handleFoo(request: WorkerFooRequest): Promise<void> {
  console.error(`[worker] Handling foo_request (param1: ${request.param1})`);

  try {
    if (!cdp) {
      throw new Error('CDP connection not initialized');
    }

    // Execute CDP command(s)
    const result = await cdp.send('SomeDomain.someCommand', {
      param: request.param1,
    });

    // Send response
    const response: WorkerFooResponse = {
      type: 'foo_response',
      requestId: request.requestId,
      success: true,
      data: {
        result: result.someField,
      },
    };

    console.log(JSON.stringify(response));
    console.error(`[worker] Sent foo_response`);
  } catch (error) {
    const response: WorkerFooResponse = {
      type: 'foo_response',
      requestId: request.requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };

    console.log(JSON.stringify(response));
    console.error(`[worker] Sent foo_response (error: ${response.error})`);
  }
}

// Add to handleWorkerIPC switch
function handleWorkerIPC(message: WorkerIPCMessageType): void {
  console.error(`[worker] Received IPC message: ${message.type}`);

  switch (message.type) {
    case 'dom_query_request':
      void handleDomQuery(message as WorkerDomQueryRequest);
      break;
    case 'dom_highlight_request':
      void handleDomHighlight(message as WorkerDomHighlightRequest);
      break;
    case 'dom_get_request':
      void handleDomGet(message as WorkerDomGetRequest);
      break;
    case 'foo_request':
      void handleFoo(message as WorkerFooRequest); // Add here
      break;
    default:
      console.error(`[worker] Unknown IPC message type: ${message.type}`);
  }
}
```

### Step 4: Implement Daemon Forwarding

Add handlers in `src/daemon/ipcServer.ts`:

```typescript
// Add to handleMessage switch
switch (message.type) {
  case 'handshake_request':
    this.handleHandshake(socket, message);
    break;
  // ... existing cases ...
  case 'foo_request':
    this.handleFooRequest(socket, message); // Add here
    break;
  case 'foo_response':
    console.error('[daemon] Unexpected foo response from client');
    break;
}

// Add request handler
private handleFooRequest(socket: Socket, request: FooRequest): void {
  console.error(`[daemon] Foo request received (sessionId: ${request.sessionId})`);

  // Check if worker is available
  if (!this.workerProcess || !this.workerProcess.stdin) {
    const response: FooResponse = {
      type: 'foo_response',
      sessionId: request.sessionId,
      status: 'error',
      error: 'No active worker process',
    };

    socket.write(JSON.stringify(response) + '\n');
    console.error('[daemon] Foo error response sent (no worker)');
    return;
  }

  // Generate unique requestId
  const requestId = `foo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Set up timeout (10 seconds)
  const timeout = setTimeout(() => {
    this.pendingDomRequests.delete(requestId);

    const response: FooResponse = {
      type: 'foo_response',
      sessionId: request.sessionId,
      status: 'error',
      error: 'Worker response timeout (10s)',
    };

    socket.write(JSON.stringify(response) + '\n');
    console.error('[daemon] Foo timeout response sent');
  }, 10000);

  // Store pending request
  this.pendingDomRequests.set(requestId, {
    socket,
    sessionId: request.sessionId,
    timeout,
  });

  // Forward to worker
  const workerRequest: WorkerFooRequest = {
    type: 'foo_request',
    requestId,
    param1: request.param1,
    ...(request.param2 !== undefined && { param2: request.param2 }),
  };

  this.workerProcess.stdin.write(JSON.stringify(workerRequest) + '\n');
  console.error(`[daemon] Forwarded foo_request to worker (requestId: ${requestId})`);
}

// Add response forwarder
private forwardFooResponse(
  socket: Socket,
  sessionId: string,
  workerResponse: WorkerFooResponse
): void {
  const response: FooResponse = {
    type: 'foo_response',
    sessionId,
    status: workerResponse.success ? 'ok' : 'error',
    ...(workerResponse.data && { data: workerResponse.data }),
    ...(workerResponse.error && { error: workerResponse.error }),
  };

  socket.write(JSON.stringify(response) + '\n');
  console.error(`[daemon] Forwarded foo_response to client`);
}

// Add to handleWorkerResponse switch
switch (message.type) {
  case 'dom_query_response':
    this.forwardDomQueryResponse(pending.socket, pending.sessionId, message as WorkerDomQueryResponse);
    break;
  case 'dom_highlight_response':
    this.forwardDomHighlightResponse(pending.socket, pending.sessionId, message as WorkerDomHighlightResponse);
    break;
  case 'dom_get_response':
    this.forwardDomGetResponse(pending.socket, pending.sessionId, message as WorkerDomGetResponse);
    break;
  case 'foo_response':
    this.forwardFooResponse(pending.socket, pending.sessionId, message as WorkerFooResponse); // Add here
    break;
}
```

### Step 5: Implement IPC Client Helper

Add client function in `src/ipc/client.ts`:

```typescript
import type {
  // ... existing imports ...
  FooRequest,
  FooResponse,
} from '@/ipc/types.js';

/**
 * Execute foo command via the daemon's worker.
 *
 * @param param1 - First parameter
 * @param param2 - Optional second parameter
 * @returns Foo response with result
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function executeFoo(param1: string, param2?: number): Promise<FooResponse> {
  const request: FooRequest = {
    type: 'foo_request',
    sessionId: randomUUID(),
    param1,
    ...(param2 !== undefined && { param2 }),
  };

  return sendRequest<FooRequest, FooResponse>(request, 'foo');
}
```

### Step 6: Use in CLI Command

Use the IPC client in your CLI handler:

```typescript
import { executeFoo } from '@/ipc/client.js';

async function handleFooCommand(options: FooOptions): Promise<void> {
  try {
    // Send request via IPC
    const response = await executeFoo(options.param1, options.param2);

    if (response.status === 'error') {
      throw new Error(response.error ?? 'Unknown error');
    }

    if (!response.data) {
      throw new Error('No data in response');
    }

    // Display result
    if (options.json) {
      console.log(JSON.stringify(response.data, null, 2));
    } else {
      console.log(`Result: ${response.data.result}`);
    }

    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${errorMsg}`);
    process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
  }
}
```

## Key Design Principles

### 1. Request/Response Matching

- Each request gets a unique `requestId` (generated by daemon)
- Worker echoes `requestId` in response
- Daemon matches response to original client via `requestId`
- Client uses `sessionId` for logging/debugging

### 2. Timeout Handling

- All requests have 10-second timeout
- Timeout cleanup removes pending request
- Client receives timeout error response
- Prevents resource leaks from hung requests

### 3. Error Propagation

- Worker catches errors and sends error response
- Daemon forwards errors to client
- Client converts to user-friendly message
- All layers use structured error format

### 4. Persistent Connection

- Worker maintains single CDP connection
- All commands reuse same connection
- Enables features like:
  - Index-based DOM cache (stable nodeIds)
  - Faster execution (no connection overhead)
  - Session state preservation

### 5. JSONL Protocol

- Messages are newline-delimited JSON
- Easy to parse line-by-line
- Human-readable for debugging
- Streaming-friendly

## Benefits

### For Users
- ✅ Faster commands (no connection overhead)
- ✅ Reliable index-based references
- ✅ Consistent error messages

### For Developers
- ✅ Clear template pattern
- ✅ Type-safe message contracts
- ✅ Easy to add new commands
- ✅ Centralized error handling
- ✅ Debuggable (JSONL logs)

### For Architecture
- ✅ Separation of concerns
- ✅ Scalable (daemon can manage multiple workers in future)
- ✅ Testable (mock daemon/worker)
- ✅ Unix philosophy (stdin/stdout pipes)

## Debugging Tips

### Enable Debug Logging

Check stderr output from daemon and worker:

```bash
# Daemon logs
tail -f /tmp/daemon-stderr.log

# Worker logs
tail -f /tmp/worker-stderr.log
```

### Trace Message Flow

1. **CLI to Daemon**: Check socket connection
   ```
   [client] Connected to daemon for foo request
   [client] foo request sent
   ```

2. **Daemon to Worker**: Check stdin forwarding
   ```
   [daemon] Foo request received (sessionId: uuid)
   [daemon] Forwarded foo_request to worker (requestId: foo_123_abc)
   ```

3. **Worker Processing**: Check CDP execution
   ```
   [worker] Received IPC message: foo_request
   [worker] Handling foo_request (param1: test)
   [worker] Sent foo_response
   ```

4. **Worker to Daemon**: Check stdout parsing
   ```
   [daemon] Received worker response: foo_response (requestId: foo_123_abc)
   [daemon] Forwarded foo_response to client
   ```

5. **Daemon to CLI**: Check socket response
   ```
   [client] foo response received
   ```

### Common Issues

**"No active worker process"**
- Worker crashed or never started
- Check worker stderr for errors
- Verify session is running: `bdg status`

**"Worker response timeout (10s)"**
- Worker is hung or slow
- Check worker stderr for stuck operations
- Verify CDP connection is healthy

**"No pending request found for requestId"**
- Response arrived after timeout
- Worker sent duplicate response
- Check for race conditions in worker handlers

## Examples

See the DOM commands for complete working examples:
- Query: `src/cli/collectors/dom.ts` (handleDomQuery)
- Highlight: `src/cli/collectors/dom.ts` (handleDomHighlight)
- Get: `src/cli/collectors/dom.ts` (handleDomGet)

## Related Documentation

- [Architecture Overview](./ARCHITECTURE.md)
- [Session Management](./SESSION_MANAGEMENT.md)
- [CDP Connection](./CDP_CONNECTION.md)
