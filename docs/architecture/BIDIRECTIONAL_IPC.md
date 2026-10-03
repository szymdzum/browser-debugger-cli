# Bidirectional IPC Pattern

This document describes the generic bidirectional IPC (Inter-Process Communication) pattern used for routing commands between the CLI and the daemon, which hosts the browser session in-process.

## Architecture Overview

```
┌─────────────┐         ┌──────────────────────────────────────────┐
│             │  Unix   │  Daemon = Session                        │
│ CLI Command │ Socket  │                                          │
│             │ ──────> │  ipcServer → SessionController → Session │
│             │<─────── │                        (CDP, telemetry)  │
└─────────────┘         └──────────────────────────────────────────┘
       │                                   │
       └───────────────────────────────────┘
             Request/Response Matching
        (one connection per request, sessionId echoed)
```

### Components

1. **CLI Command** (`src/commands/*.ts`)
   - User-facing command handlers
   - Calls IPC client functions inside `runCommand()`
   - Formats output for user

2. **IPC Client** (`src/ipc/client.ts`, `src/ipc/transport/`)
   - Connects to daemon via Unix socket
   - Sends one JSONL request per connection
   - Waits for the JSONL response and validates `sessionId` and response `type`
   - Handles timeouts (45s default, `BDG_IPC_TIMEOUT_MS`) and connection errors

3. **Daemon IPC Server** (`src/daemon/ipcServer.ts`)
   - Listens on `~/.bdg/daemon.sock` for client connections
   - Parses JSONL frames and validates message structure
   - Routes lifecycle/query requests to named `SessionController` methods
   - Routes every registered command (`isCommandRequest()`) to `SessionController.command()`
   - Writes the response back on the same socket

4. **Session Controller** (`src/daemon/SessionController.ts`)
   - Owns the daemon's single `Session`
   - Returns "No active session" errors when none is running
   - Applies per-request timeouts (30s for commands, 5s for status/peek/HAR)
   - Converts `CommandError` into `error`, `exitCode` and `suggestion` response fields

5. **Session** (`src/daemon/session/Session.ts`, `src/daemon/session/commandRegistry.ts`)
   - Maintains the persistent CDP connection and `TelemetryStore`
   - `execute(name, params)` calls the registered handler directly, in-process

## Communication Flow

### Request Flow (CLI → Session)

1. **CLI calls IPC client function**
   ```typescript
   const response = await callCDP('Network.getCookies');
   ```

2. **IPC client sends request to daemon**
   ```json
   {"type":"cdp_call_request","sessionId":"uuid","method":"Network.getCookies"}
   ```

3. **Daemon routes the request to the controller**
   ```typescript
   if (isCommandRequest(message.type)) {
     return this.controller.command(message);
   }
   ```

4. **Session executes the handler against CDP**
   ```typescript
   const data = await session.execute('cdp_call', { method: 'Network.getCookies' });
   ```

### Response Flow (Session → CLI)

1. **Controller wraps the handler result**
   ```json
   {"type":"cdp_call_response","sessionId":"uuid","status":"ok","data":{...}}
   ```

2. **Daemon writes the response to the client socket**

3. **IPC client resolves promise with response**
   ```typescript
   // Promise resolves with response data
   ```

4. **CLI formats and displays output**
   ```
   {
     "cookies": [...]
   }
   ```

## Adding a New Command

Follow this 4-step pattern to add any new session command. No daemon routing changes are needed.

### Step 1: Define Command Schemas

Add request/response types and register them in `src/ipc/protocol/commands.ts`:

```typescript
/**
 * foo command request schema.
 */
export interface FooCommand {
  param1: string;
  param2?: number;
}

/**
 * foo command response data.
 */
export interface FooData {
  result: string;
}

export type RegistryShape = {
  // ... existing commands ...
  foo: CommandDef<FooCommand, FooData>; // Add here
};

export const COMMANDS: RegistryShape = {
  // ... existing commands ...
  foo: defineCommand(), // Add here
};
```

`ClientRequest<'foo'>` and `ClientResponse<'foo'>` (`src/ipc/protocol/messages.ts`) are derived from this registry, so the wire types `foo_request` / `foo_response` need no hand-written definitions. `isCommandRequest('foo_request')` now returns true, which makes the daemon route the request to `SessionController.command()`.

### Step 2: Implement the Session Handler

Add the handler in `src/daemon/session/commandRegistry.ts`. `CommandRegistry` is a mapped type over `CommandName`, so the compiler requires it:

```typescript
export function createCommandRegistry(store: TelemetryStore): CommandRegistry {
  return {
    // ... existing handlers ...
    foo: async (cdp, params) => {
      const result = await cdp.send('SomeDomain.someCommand', {
        param: params.param1,
      });
      return { result: result.someField };
    },
  };
}
```

Handlers return data or throw. To give the CLI a semantic exit code and suggestion, throw a `CommandError`; the controller forwards `exitCode` and `suggestion` in the error response:

```typescript
throw new CommandError(
  'Element not found',
  { suggestion: 'Re-run query to refresh cache' },
  EXIT_CODES.STALE_CACHE
);
```

### Step 3: Implement IPC Client Helper

Add a client function in `src/ipc/client.ts` using the internal `sendCommand` helper:

```typescript
/**
 * Execute foo command in the daemon's session.
 *
 * @param param1 - First parameter
 * @param param2 - Optional second parameter
 * @returns Foo response with result
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function executeFoo(
  param1: string,
  param2?: number
): Promise<ClientResponse<'foo'>> {
  return sendCommand('foo', { param1, ...(param2 !== undefined && { param2 }) });
}
```

### Step 4: Use in CLI Command

Use the IPC client in your CLI handler via `runCommand`, which handles JSON/human output and maps a missing daemon to exit code 83:

```typescript
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { executeFoo } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';

await runCommand(
  async (opts) => {
    const response = await executeFoo(opts.param1, opts.param2);
    validateIPCResponse(response);
    return { success: true, data: response.data };
  },
  options,
  formatFoo
);
```

## Key Design Principles

### 1. Request/Response Matching

- Each request uses its own socket connection, so responses cannot be crossed
- The daemon echoes `sessionId` and replies with `<type>_response`
- The client validates both before resolving
- `sessionId` also serves logging/debugging

### 2. Timeout Handling

- The controller bounds handler execution (30s for commands, 5s for status/peek/HAR data)
- The client bounds the whole round trip (45s default, `BDG_IPC_TIMEOUT_MS`)
- Timeouts become error responses, not hung connections

### 3. Error Propagation

- Handlers throw; the controller catches and builds an error response
- `CommandError` exit codes and suggestions are forwarded end-to-end
- Client converts to user-friendly message
- All layers use structured error format

### 4. Persistent Connection

- The session maintains a single CDP connection for its lifetime
- All commands reuse the same connection, in the same process
- Enables features like:
  - Index-based DOM cache (stable nodeIds)
  - Faster execution (no connection overhead, no extra IPC hop)
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
- ✅ Type-safe message contracts derived from one registry
- ✅ Easy to add new commands (no routing boilerplate)
- ✅ Centralized error handling
- ✅ Debuggable (JSONL logs)

### For Architecture
- ✅ Separation of concerns (transport, routing, session logic)
- ✅ One process per session: daemon lifetime = session lifetime
- ✅ Testable (handlers are plain functions of `cdp` and params)

## Debugging Tips

### Enable Debug Logging

Daemon stdout/stderr goes to the session directory:

```bash
# Daemon logs
tail -f ~/.bdg/daemon.log

# Client-side debug logs
bdg cdp Network.getCookies --debug
```

### Trace Message Flow

1. **CLI to Daemon**: Check socket connection (client, `--debug`)
   ```
   Connected to daemon for cdp_call request
   cdp_call request sent
   ```

2. **Daemon Processing**: Check `~/.bdg/daemon.log` for session and CDP errors

3. **Daemon to CLI**: Check socket response (client, `--debug`)
   ```
   cdp_call response received
   ```

### Common Issues

**"No active session"**
- No daemon is listening on `~/.bdg/daemon.sock` (exit code 83), or the daemon has no running session
- Start one with `bdg <url>`
- Verify with `bdg status`

**"Command timeout (30s)"**
- The handler is hung or slow
- Check `~/.bdg/daemon.log` for stuck operations
- Verify CDP connection is healthy

**"<name> request timeout after 45s"**
- The client gave up waiting for the daemon
- Check whether the daemon is still alive: `bdg status`

## Examples

See these commands for complete working examples:
- CDP passthrough: `src/commands/cdp.ts` (`callCDP`)
- Eval: `src/commands/dom/eval.ts` (`domEval`)
- Details: `src/commands/details.ts` (`getDetails`)

## Related Documentation

- [Execution Flow](./BDG_EXECUTION_FLOW.md)
- [Telemetry Plugins](./TELEMETRY-PLUGIN.md)
- [Daemon = Session Migration](../roadmap/DAEMON_SESSION_MIGRATION.md)
