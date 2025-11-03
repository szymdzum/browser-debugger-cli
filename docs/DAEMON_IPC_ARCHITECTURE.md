# Daemon + IPC Architecture Specification

**Status**: Planning - Not Implemented
**Priority**: High
**Target Version**: v1.0.0
**Last Reviewed**: 2025-11-03
**Review Document**: See [DAEMON_IPC_ARCHITECTURE_REVIEW.md](./DAEMON_IPC_ARCHITECTURE_REVIEW.md) for critical hardening fixes

**⚠️ IMPLEMENTATION NOTE**: This architecture is not yet implemented. All code examples in this document incorporate critical stream framing and concurrency fixes identified during architecture review.

## Problem Statement

### Current Issues

1. **Blocked Terminal**: Running `bdg <url>` blocks the terminal until stopped, requiring multiple terminal windows for monitoring
2. **Wasteful I/O**: Writing 87MB files every 5 seconds just for CLI queries to read back
3. **High Latency**: File-based IPC adds unnecessary disk I/O latency
4. **Agent Unfriendly**: AI agents must process massive JSON dumps instead of targeted queries

### Current Workaround

```bash
# Terminal 1: Start collection (blocks)
bdg localhost:3000

# Terminal 2: Query while running
bdg peek
bdg details network 12345
bdg stop
```

## Solution Overview

**Auto-daemonize with IPC-based queries**: Automatically run collection in background, provide instant command-line queries via Unix domain sockets.

### Key Benefits

- ✅ Single terminal workflow
- ✅ Non-blocking `bdg <url>` command
- ✅ Instant queries via IPC (no 87MB file reads)
- ✅ Agent-friendly targeted data access
- ✅ Foreground mode available for debugging
- ✅ No separate daemon to install/manage

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│ User runs: bdg localhost:3000                               │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ CLI Process (Parent)                                        │
│ 1. Check for existing session                              │
│ 2. Clean up stale PIDs                                     │
│ 3. Fork worker process                                     │
│ 4. Wait for handshake (30s timeout)                        │
│ 5. Write session metadata                                  │
│ 6. Detach and exit                                         │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ Worker Process (Background)                                 │
│ 1. Start IPC server (Unix socket)                          │
│ 2. Connect to Chrome CDP                                   │
│ 3. Send handshake to parent                                │
│ 4. Run collection loop                                     │
│ 5. Handle IPC requests (peek/details/stop)                 │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ User runs: bdg peek                                         │
│ 1. Read session metadata                                   │
│ 2. Connect to IPC socket                                   │
│ 3. Send 'peek' request                                     │
│ 4. Receive filtered data                                   │
│ 5. Display formatted output                                │
└─────────────────────────────────────────────────────────────┘
```

## IPC Protocol

### Transport

**Unix Domain Sockets** (macOS/Linux)
- Path: `~/.bdg/session.sock`
- Format: JSON-RPC over newline-delimited JSON
- Fallback: File-based IPC on Windows (future)

### Stream Framing Considerations

**⚠️ CRITICAL**: TCP/pipe framing does not guarantee message boundaries. A single `write()` call does not guarantee a single `data` event on the receiving end.

**Common Failure Scenarios:**

1. **Chunked Messages** (Message split across multiple data events):
   ```
   Event 1: {"id":"1","success":tru
   Event 2: e,"data":{}}\n
   ```
   ❌ `JSON.parse(event1)` throws incomplete JSON error

2. **Concatenated Messages** (Multiple messages in one data event):
   ```
   Event 1: {"id":"1","success":true}\n{"id":"2","success":true}\n
   ```
   ❌ `JSON.parse(event1)` throws multi-object error

**Solution: Newline-Delimited JSON (JSONL)**

All messages MUST be newline-terminated (`\n`) and parsers MUST buffer until newline before parsing:

```typescript
let buffer = '';

socket.on('data', (data: Buffer) => {
  buffer += data.toString();

  // Process all complete messages (lines ending with \n)
  let newlineIndex: number;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);

    if (line.trim()) {
      const message = JSON.parse(line);
      handleMessage(message);
    }
  }
  // Incomplete message remains in buffer
});
```

**This pattern MUST be used in:**
- `waitForHandshake()` - Worker stdout can arrive chunked
- `IPCClient.handleData()` - Server responses can concatenate/split
- `IPCServer.handleData()` - Client requests can concatenate/split

### Message Format

```typescript
// Request
interface IPCRequest {
  id: string;           // Unique request ID
  command: 'peek' | 'details' | 'stop' | 'status' | 'ping';
  params?: {
    type?: 'network' | 'console';
    itemId?: string;
    last?: number;
  };
}

// Response
interface IPCResponse {
  id: string;           // Matches request ID
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
  };
}

// Handshake (worker → parent)
interface IPCHandshake {
  version: string;      // Protocol version (e.g., "1.0")
  pid: number;          // Worker PID
  socketPath: string;   // IPC socket location
  ready: boolean;       // CDP connection successful
  target: {
    url: string;
    title: string;
  };
}
```

### Commands

#### `peek`
Returns lightweight preview of collected data (metadata only, no bodies).

**Request:**
```json
{
  "id": "1",
  "command": "peek",
  "params": {
    "last": 10,
    "type": "network"
  }
}
```

**Response:**
```json
{
  "id": "1",
  "success": true,
  "data": {
    "network": [
      {
        "requestId": "12345.678",
        "url": "http://localhost:3000/api/users",
        "method": "GET",
        "status": 200,
        "timestamp": 1699123456789
      }
    ]
  }
}
```

#### `details`
Returns complete data for a specific item (includes bodies).

**Request:**
```json
{
  "id": "2",
  "command": "details",
  "params": {
    "type": "network",
    "itemId": "12345.678"
  }
}
```

**Response:**
```json
{
  "id": "2",
  "success": true,
  "data": {
    "requestId": "12345.678",
    "url": "http://localhost:3000/api/users",
    "method": "GET",
    "status": 200,
    "requestHeaders": {...},
    "responseHeaders": {...},
    "responseBody": "{\"users\": [...]}"
  }
}
```

#### `stop`
Gracefully stops the collection session.

**Request:**
```json
{
  "id": "3",
  "command": "stop"
}
```

**Response:**
```json
{
  "id": "3",
  "success": true,
  "data": {
    "message": "Session stopped",
    "outputPath": "~/.bdg/session.json"
  }
}
```

#### `status`
Returns current session status.

**Request:**
```json
{
  "id": "4",
  "command": "status"
}
```

**Response:**
```json
{
  "id": "4",
  "success": true,
  "data": {
    "pid": 12345,
    "uptime": 45230,
    "collectors": ["network", "console", "dom"],
    "stats": {
      "networkRequests": 142,
      "consoleMessages": 28
    }
  }
}
```

## Session Lifecycle

### 1. Launch with Handshake

```typescript
// src/daemon/launcher.ts
export async function launchDaemon(
  url: string,
  options: CollectionOptions
): Promise<void> {
  // 1. Check for existing session
  const existingPid = await getSessionPid();
  if (existingPid && await isProcessAlive(existingPid)) {
    throw new Error(
      `Session already running (PID ${existingPid})\n` +
      `Use 'bdg stop' to end it first`
    );
  }

  // 2. Clean up stale files (critical for reliability)
  await cleanupStaleSession();

  // 3. Fork worker process
  const worker = spawn(process.execPath, [
    process.argv[1],
    url,
    ...serializeOptions(options)
  ], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr
    env: { ...process.env, BDG_WORKER: '1' }
  });

  // 4. Wait for handshake (CRITICAL: don't exit until worker ready)
  const handshake = await waitForHandshake(worker, 30000);

  if (!handshake.ready) {
    worker.kill();
    throw new Error(
      'Worker failed to connect to Chrome\n' +
      'Check logs: bdg logs'
    );
  }

  // 5. Detach worker (allows parent to exit)
  worker.unref();

  // 6. Write session metadata
  await writeSessionMetadata({
    pid: worker.pid!,
    socketPath: handshake.socketPath,
    startTime: Date.now(),
    url,
    target: handshake.target
  });

  // 7. Setup log capture (async, don't block)
  setupLogCapture(worker);

  // 8. Inform user and exit parent
  console.log(`Collection started (PID ${worker.pid})`);
  console.log(`Target: ${handshake.target.title}`);
  console.log(`\nUse 'bdg peek' to monitor, 'bdg stop' to finish`);
}
```

**Guardrail: Handshake Timeout with Buffered Parsing**

**⚠️ CRITICAL**: Handshake must buffer until newline. Stdout can arrive chunked, causing `JSON.parse()` to throw on incomplete messages.

```typescript
async function waitForHandshake(
  worker: ChildProcess,
  timeoutMs: number
): Promise<IPCHandshake> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.stdout?.removeListener('data', handleData);
      reject(new Error('Handshake timeout - worker may have crashed'));
    }, timeoutMs);

    let buffer = '';

    // CRITICAL: Buffer until newline to handle chunked stdout
    const handleData = (data: Buffer) => {
      buffer += data.toString();

      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex !== -1) {
        clearTimeout(timeout);
        const line = buffer.slice(0, newlineIndex);
        worker.stdout?.removeListener('data', handleData);

        try {
          const handshake = JSON.parse(line);
          resolve(handshake);
        } catch (err) {
          reject(new Error('Invalid handshake response'));
        }
      }
    };

    // Worker sends handshake via stdout (one-time only)
    worker.stdout?.on('data', handleData);

    worker.on('error', (err) => {
      clearTimeout(timeout);
      worker.stdout?.removeListener('data', handleData);
      reject(err);
    });
  });
}
```

**Guardrail: Log Capture with Stderr Consumption**

**⚠️ CRITICAL**: Worker stderr MUST be consumed before `worker.unref()`. Otherwise, the child process can block when the stderr pipe buffer fills (typically 64KB), causing hangs mid-execution.

```typescript
function setupLogCapture(worker: ChildProcess): void {
  const logDir = path.join(os.homedir(), '.bdg', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const logFile = path.join(logDir, `worker-${worker.pid}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  // CRITICAL: Pipe stderr to prevent blocking on full pipe
  worker.stderr?.pipe(logStream);

  // Also pipe stdout (already ended after handshake, but may have buffered data)
  worker.stdout?.pipe(logStream);

  // Cleanup on worker exit
  worker.on('exit', () => {
    logStream.end();
  });

  // Rotate old logs (keep last 5)
  rotateOldLogs(logDir, 5);
}

function rotateOldLogs(logDir: string, keep: number): void {
  const files = fs.readdirSync(logDir)
    .filter(f => f.startsWith('worker-') && f.endsWith('.log'))
    .sort()
    .reverse();

  // Delete old log files beyond keep limit
  files.slice(keep).forEach(file => {
    fs.unlinkSync(path.join(logDir, file));
  });
}
```

**Alternative: Discard stderr if logging not needed**
```typescript
function setupLogCapture(worker: ChildProcess): void {
  // CRITICAL: Still must consume stderr to prevent blocking
  worker.stderr?.resume();
  worker.stdout?.resume();
}
```

### 2. Worker Process

```typescript
// src/daemon/worker.ts
export async function runWorker(
  url: string,
  options: CollectionOptions
): Promise<void> {
  const logStream = createWorkerLogStream();

  try {
    // Redirect stderr to log file (CRITICAL for crash debugging)
    process.stderr.write = (chunk: any) => {
      logStream.write(chunk);
      return true;
    };

    const session = new BdgSession(url, options);

    // 1. Start IPC server FIRST (before CDP connection)
    const ipcServer = new IPCServer(session);
    await ipcServer.start();

    // 2. Connect to Chrome
    await session.connect();

    // 3. Send handshake to parent (stdout, one-time)
    const handshake: IPCHandshake = {
      version: '1.0',
      pid: process.pid,
      socketPath: ipcServer.socketPath,
      ready: true,
      target: {
        url: session.getTarget().url,
        title: session.getTarget().title
      }
    };
    process.stdout.write(JSON.stringify(handshake) + '\n');

    // 4. Close stdout (parent doesn't need more output)
    process.stdout.end();

    // 5. Run collection loop (blocks until stopped)
    await session.run();

  } catch (error) {
    // CRITICAL: Log all errors for debugging
    logStream.write(`FATAL: ${error}\n`);
    logStream.write(error.stack + '\n');
    process.exit(1);
  } finally {
    logStream.end();
  }
}
```

### 3. Stale PID Cleanup

**Guardrail: Handle crashes and leftover files**

```typescript
// src/session/cleanup.ts
export async function cleanupStaleSession(): Promise<void> {
  const sessionDir = path.join(os.homedir(), '.bdg');
  const pidFile = path.join(sessionDir, 'session.pid');
  const metaFile = path.join(sessionDir, 'session.meta.json');
  const socketPath = path.join(sessionDir, 'session.sock');
  const lockFile = path.join(sessionDir, 'session.lock');

  let lockHandle: fs.promises.FileHandle | undefined;

  try {
    // Serialize cleanup/startup with atomic lock
    lockHandle = await fs.open(lockFile, 'wx');

    try {
      const pidStr = await fs.readFile(pidFile, 'utf-8');
      const pid = parseInt(pidStr.trim(), 10);

      // Check if process is actually alive
      if (!await isProcessAlive(pid)) {
        await Promise.all([
          fs.unlink(pidFile).catch(() => {}),
          fs.unlink(metaFile).catch(() => {}),
          fs.unlink(socketPath).catch(() => {})
        ]);
      }
    } catch {
      // No PID file or can't read - clean up anyway
      await Promise.all([
        fs.unlink(pidFile).catch(() => {}),
        fs.unlink(metaFile).catch(() => {}),
        fs.unlink(socketPath).catch(() => {})
      ]);
    }
  } catch (err) {
    // Another process holds the lock – skip cleanup to avoid racing
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err;
    }
  } finally {
    await lockHandle?.close().catch(() => {});
    await fs.unlink(lockFile).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    });
  }
}

export async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    // Send signal 0 - checks existence without killing
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}
```

## Crash Visibility

**Guardrail: Worker logs for debugging**

### Log File Structure

```
~/.bdg/
  logs/
    worker-12345.log    # Current worker log
    worker-12340.log    # Previous session (kept for debugging)
    worker-12335.log
    ...
```

### Log Rotation

```typescript
function createWorkerLogStream(): WriteStream {
  const logDir = path.join(os.homedir(), '.bdg', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const logFile = path.join(logDir, `worker-${process.pid}.log`);
  const stream = fs.createWriteStream(logFile, { flags: 'a' });

  // Keep last 5 log files, delete older ones
  rotateOldLogs(logDir, 5);

  return stream;
}
```

### Viewing Logs

```bash
# View current worker logs
bdg logs

# View logs with tail -f
bdg logs --follow

# View specific PID logs
bdg logs --pid 12345
```

## IPC Client

**Guardrail: Resilient connection with buffered JSONL parsing**

**⚠️ CRITICAL**: IPC responses must be buffered until newline. Back-to-back responses can concatenate, causing `JSON.parse()` to throw.

```typescript
// src/ipc/client.ts
export class IPCClient {
  private socket?: Socket;
  private requestId = 0;
  private buffer = ''; // CRITICAL: Buffer for incomplete messages
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  async connect(socketPath: string, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error(
          'Failed to connect to session\n' +
          'Session may have crashed. Check logs: bdg logs'
        ));
      }, timeoutMs);

      this.socket = connect(socketPath);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`IPC connection error: ${err.message}`));
      });

      this.socket.on('data', (data) => {
        this.handleData(data); // CRITICAL: Handle raw data, not response directly
      });
    });
  }

  // CRITICAL: Buffer until newline before parsing
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    // Process all complete messages (lines ending with \n)
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.trim()) {
        this.handleResponse(line);
      }
    }
    // Incomplete message remains in buffer
  }

  private handleResponse(line: string): void {
    try {
      const response: IPCResponse = JSON.parse(line);
      const pending = this.pendingRequests.get(response.id);

      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(response.id);

        if (response.success) {
          pending.resolve(response.data);
        } else {
          pending.reject(new Error(response.error?.message || 'Request failed'));
        }
      }
    } catch (err) {
      console.error('Failed to parse IPC response:', err);
    }
  }

  async request(
    command: string,
    params?: any,
    timeoutMs = 10000
  ): Promise<any> {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    const id = `${++this.requestId}`;
    const request: IPCRequest = { id, command, params };

    return new Promise((resolve, reject) => {
      // Per-request timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${command}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      this.socket!.write(JSON.stringify(request) + '\n');
    });
  }

  disconnect(): void {
    this.socket?.end();
    this.socket = undefined;
    this.buffer = ''; // Clear buffer on disconnect
  }
}
```

## Session Files

### File Structure

```
~/.bdg/
  session.pid          # Worker PID (for process checks)
  session.meta.json    # Session metadata
  session.sock         # Unix domain socket
  session.lock         # Atomic lock file
  session.json         # Final output (written on stop)
  logs/
    worker-*.log       # Worker process logs
```

### Metadata Format

```json
{
  "pid": 12345,
  "socketPath": "/Users/user/.bdg/session.sock",
  "startTime": 1699123456789,
  "url": "http://localhost:3000",
  "target": {
    "url": "http://localhost:3000/dashboard",
    "title": "Dashboard"
  },
  "collectors": ["network", "console", "dom"]
}
```

## Implementation Plan

**⚠️ STATUS: None of this code is implemented yet. All phases below are planning only.**

**Reusable Components from Current Codebase:**
- ✅ Lock file mechanism (src/utils/session.ts) - needs async version
- ✅ PID tracking (src/utils/session.ts)
- ✅ Metadata management (src/utils/session.ts)
- ✅ BdgSession class (src/session/BdgSession.ts) - ready for IPC integration
- ✅ Two-tier preview system (src/utils/session.ts) - NOT used in IPC-only arch

**Estimated Total Effort:** ~15 days (3 weeks) for full implementation

---

### Phase 1: Core IPC Infrastructure

**Priority: High | Effort: ~2.5 days**

1. ⬜ Create IPC protocol types (`src/ipc/protocol.ts`)
2. ⬜ Implement IPC server with **buffered JSONL parsing** (`src/ipc/server.ts`)
3. ⬜ Implement IPC client with **buffered JSONL parsing** (`src/ipc/client.ts`)
4. ⬜ Add session cleanup utilities (`src/session/cleanup.ts`)
5. ⬜ Create daemon launcher with **lock acquisition** (`src/daemon/launcher.ts`)
6. ⬜ Create worker process with **handshake buffering** (`src/daemon/worker.ts`)

### Phase 2: Command Updates

**Priority: High | Effort: ~2.5 days**

7. ⬜ Update `bdg <url>` to auto-daemonize
8. ⬜ Update `bdg peek` to use IPC (remove file reads)
9. ⬜ Update `bdg details` to use IPC (remove file reads)
10. ⬜ Update `bdg stop` to use IPC (remove direct SIGKILL)
11. ⬜ Update `bdg status` to use IPC

### Phase 3: Logging & Debugging

**Priority: Medium | Effort: ~1.5 days**

12. ⬜ Add worker log rotation with **stderr consumption**
13. ⬜ Add `bdg logs` command
14. ⬜ Add `--foreground` flag for debugging

### Phase 4: IPC-Only Architecture (No File Fallback)

**Priority: Medium | Effort: ~0.5 days**

15. ⬜ **REMOVE** `writePartialOutputAsync()` - IPC replaces intermediate dumps (final snapshot only)
16. ⬜ **REMOVE** `writeFullOutputAsync()` - replaced by IPC
17. ⬜ Keep only final `session.json` write on `bdg stop` command
18. ⬜ Update collectors to NOT write to disk during collection

**Rationale:** IPC-only architecture. No file-based fallback. If daemon crashes, session data is lost (acceptable trade-off for performance). Final session.json written only when user explicitly runs `bdg stop`.

### Phase 5: Advanced Features (Optional)

**Priority: Low | Effort: TBD**

19. ⬜ Add `--stream` mode for real-time output
20. ⬜ Windows named pipe support (fallback to TCP sockets)
21. ⬜ Add `--no-disk` flag to disable all file writes (including final session.json)

## Backward Compatibility

### Foreground Mode

```bash
# Traditional blocking mode (for debugging)
bdg localhost:3000 --foreground
```

**Behavior:**
- Runs in foreground (blocks terminal)
- Prints logs to stdout/stderr
- No IPC server
- No IPC server (foreground only)
- Ctrl+C stops immediately
- Compatible with existing workflow

**Note:** IPC-only architecture has NO file-based fallback. If daemon is not running or crashes, commands will error. Use foreground mode for debugging reliability.

## Error Handling

### Common Errors

**1. Session not running**
```
Error: No active session found
Start one with: bdg <url>
```

**2. IPC connection timeout**
```
Error: Failed to connect to session
Session may have crashed. Check logs:
  bdg logs
```

**3. Worker handshake timeout**
```
Error: Handshake timeout - worker may have crashed
Check logs for details:
  tail -f ~/.bdg/logs/worker-*.log
```

**4. Session already running**
```
Error: Session already running (PID 12345)
Use 'bdg stop' to end it first
```

**5. Stale PID detected**
```
Warning: Detected stale session (PID 12340)
Cleaned up stale files
```

## Testing Strategy

### Unit Tests

- IPC protocol serialization/deserialization
- Session cleanup logic (stale PID detection)
- Process alive checks (cross-platform)
- Log rotation logic

### Integration Tests

**Critical Stream Framing Tests:**
- **Chunked handshake**: Send handshake JSON in 2-3 chunks, verify parsing succeeds
- **Concatenated IPC responses**: Send multiple responses in single write, verify all parsed
- **Split IPC response**: Send response split across multiple writes, verify buffering works
- **Stderr blocking**: Fill stderr pipe (64KB+), verify worker doesn't hang

**Standard Integration Tests:**
- Full daemon launch → IPC query → stop workflow
- Crash recovery (kill worker, verify cleanup)
- Concurrent session detection
- Handshake timeout handling
- Lock file racing (start 10 sessions simultaneously, only 1 succeeds)

### Manual Testing

```bash
# Test 1: Basic workflow
bdg localhost:3000
bdg peek
bdg stop

# Test 2: Crash recovery
bdg localhost:3000
kill -9 <PID>
bdg status  # Should detect crash
bdg localhost:3000  # Should clean up and start fresh

# Test 3: Foreground mode
bdg localhost:3000 --foreground
# Should show logs, Ctrl+C stops immediately
```

## Security Considerations

1. **Unix socket permissions**: Default to user-only (0600)
2. **PID verification**: Always verify PID belongs to bdg process
3. **Socket path validation**: Prevent directory traversal
4. **Request size limits**: Cap IPC message sizes to prevent DoS

## Performance Impact

### Before (File-Based IPC)

- Write 87MB every 5 seconds
- Read 87MB for every `bdg peek`
- Latency: ~500ms (disk I/O)

### After (Socket-Based IPC)

- Write 87MB only on stop (final output)
- Query in-memory data via socket
- Latency: ~10ms (IPC overhead)

**Improvement: 50x faster, 95% less disk I/O**

## Future Enhancements

### Stream Mode

```bash
# Real-time event stream (for advanced use cases)
bdg localhost:3000 --stream | jq -c 'select(.type == "network")'
```

### Multi-Session Support

```bash
# Run multiple sessions (different ports/sockets)
bdg localhost:3000 --session web
bdg localhost:4000 --session api

bdg peek --session web
bdg stop --session api
```

### Remote IPC

```bash
# Connect to remote bdg session (over SSH tunnel)
bdg peek --remote user@host
```

## References

- Unix Domain Sockets: https://nodejs.org/api/net.html#ipc-support
- Process Management: https://nodejs.org/api/child_process.html
- JSON-RPC 2.0: https://www.jsonrpc.org/specification
- Chrome DevTools Protocol overview: https://chromedevtools.github.io/devtools-protocol/

### Practical tooling during implementation

- **chrome-remote-interface (CRI)** – Use the CLI (`npx chrome-remote-interface inspect`) or the Node client to issue raw CDP commands while prototyping. For example, validate `Page.lifecycleEvent` timing or fetch a specific response body before you expose it through IPC.
- **DevTools protocol code generator** – Pull the official protocol JSON (`npm install devtools-protocol`) and generate TypeScript interfaces so worker/IPC payloads stay aligned with upstream without hand-maintained types.
- **DevTools Recorder export** – Record a flow, then export “JavaScript + DevTools Protocol” to capture the exact CDP sequence needed for higher-level IPC commands (e.g., DOM snapshots, targeted network fetches).
- **chrome://inspect Target view** – Monitor targets in real time to ensure the daemon sees the expected sessions, and to debug lifecycle mismatches between Chrome and the IPC metadata.
- **Puppeteer Connection implementation** – Serves as a reference implementation for buffered JSONL framing, ping/pong, and reconnection logic while hardening our own stream handling.

## Related Documents

**[DAEMON_IPC_ARCHITECTURE_REVIEW.md](./DAEMON_IPC_ARCHITECTURE_REVIEW.md)** - Comprehensive architecture review identifying 5 critical hardening fixes:
1. **Handshake Robustness** - Buffer until newline to handle chunked stdout
2. **IPC Response Parsing** - Newline-delimited JSON parser for concatenated/split responses
3. **Logging Pipeline** - Stderr consumption to prevent worker blocking
4. **Session Metadata Integrity** - Lock file to prevent race conditions
5. **File-Based Fallback** - Analysis of fallback architecture (removed in IPC-only design)

All fixes from the review have been incorporated into this specification document.

## Changelog

- **2025-11-03**: Architecture review completed, critical fixes incorporated, IPC-only design finalized
- **2025-01-03**: Initial specification
