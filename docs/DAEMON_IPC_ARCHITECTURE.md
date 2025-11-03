# Daemon + IPC Architecture Specification

**Status**: Planning
**Priority**: High
**Target Version**: v1.0.0

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

**Guardrail: Handshake Timeout**

```typescript
async function waitForHandshake(
  worker: ChildProcess,
  timeoutMs: number
): Promise<IPCHandshake> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Handshake timeout - worker may have crashed'));
    }, timeoutMs);

    // Worker sends handshake via stdout (one-time only)
    worker.stdout?.once('data', (data) => {
      clearTimeout(timeout);
      try {
        const handshake = JSON.parse(data.toString());
        resolve(handshake);
      } catch (err) {
        reject(new Error('Invalid handshake response'));
      }
    });

    worker.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
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

  try {
    const pidStr = await fs.readFile(pidFile, 'utf-8');
    const pid = parseInt(pidStr.trim());

    // Check if process is actually alive
    if (!await isProcessAlive(pid)) {
      // Stale PID - clean up all session files
      await Promise.all([
        fs.unlink(pidFile).catch(() => {}),
        fs.unlink(metaFile).catch(() => {}),
        fs.unlink(socketPath).catch(() => {}),
        fs.unlink(path.join(sessionDir, 'session.lock')).catch(() => {})
      ]);
    }
  } catch (err) {
    // No PID file or can't read - clean up anyway
    await Promise.all([
      fs.unlink(pidFile).catch(() => {}),
      fs.unlink(metaFile).catch(() => {}),
      fs.unlink(socketPath).catch(() => {})
    ]);
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

**Guardrail: Resilient connection with timeouts**

```typescript
// src/ipc/client.ts
export class IPCClient {
  private socket?: Socket;
  private requestId = 0;
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
        this.handleResponse(data);
      });
    });
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

  private handleResponse(data: Buffer): void {
    try {
      const response: IPCResponse = JSON.parse(data.toString());
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

  disconnect(): void {
    this.socket?.end();
    this.socket = undefined;
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

### Phase 1: Core IPC Infrastructure

**Priority: High**

1. ✅ Create IPC protocol types (`src/ipc/protocol.ts`)
2. ✅ Implement IPC server (`src/ipc/server.ts`)
3. ✅ Implement IPC client (`src/ipc/client.ts`)
4. ✅ Add session cleanup utilities (`src/session/cleanup.ts`)
5. ✅ Create daemon launcher (`src/daemon/launcher.ts`)
6. ✅ Create worker process (`src/daemon/worker.ts`)

### Phase 2: Command Updates

**Priority: High**

7. ✅ Update `bdg <url>` to auto-daemonize
8. ✅ Update `bdg peek` to use IPC
9. ✅ Update `bdg details` to use IPC
10. ✅ Update `bdg stop` to use IPC
11. ✅ Update `bdg status` to use IPC

### Phase 3: Logging & Debugging

**Priority: Medium**

12. ✅ Add worker log rotation
13. ✅ Add `bdg logs` command
14. ✅ Add `--foreground` flag for debugging

### Phase 4: File I/O Optimization

**Priority: Medium**

15. ✅ Reduce file writes from 5s → 30s (crash recovery only)
16. ✅ Remove `writePartialOutput()` (replaced by IPC)
17. ✅ Keep `writeFullOutput()` for final session.json only

### Phase 5: Advanced Features (Optional)

**Priority: Low**

18. ⬜ Add `--stream` mode for real-time output
19. ⬜ Windows named pipe support (fallback to files for now)
20. ⬜ Add `--no-disk` flag to disable all file writes

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
- File-based peek/details still work
- Ctrl+C stops immediately

### File-Based Fallback

If IPC connection fails, commands should fall back to reading session files:

```typescript
async function peek(options: PeekOptions): Promise<void> {
  try {
    // Try IPC first
    const client = new IPCClient();
    await client.connect(socketPath);
    const data = await client.request('peek', options);
    console.log(formatPeekOutput(data));
  } catch (err) {
    // Fall back to file-based
    console.warn('IPC unavailable, reading from file...');
    const data = await readPartialOutput();
    console.log(formatPeekOutput(data));
  }
}
```

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

- Full daemon launch → IPC query → stop workflow
- Crash recovery (kill worker, verify cleanup)
- Concurrent session detection
- Handshake timeout handling

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

## Changelog

- **2025-01-03**: Initial specification
