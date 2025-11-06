# BDG Execution Flow

This document describes the complete execution flow when running `bdg <url>`.

## Overview

BDG uses a **3-process architecture**:
1. **CLI Process** - User command (exits after starting session)
2. **Daemon Process** - Long-running IPC server
3. **Worker Process** - Chrome CDP session manager

## Execution Flow: `bdg localhost:3000`

### Phase 1: CLI Entry & Daemon Check

**1. `src/index.ts` - Main entry point**
```
main()
  ├─ Check if running as daemon worker (BDG_DAEMON=1)
  ├─ isDaemonRunning() - Check daemon PID file
  └─ If not running: launchDaemon()
```

**2. `src/daemon/launcher.ts` - Daemon launcher**
```
launchDaemon()
  ├─ acquireDaemonLock() - Atomic lock (prevent concurrent starts)
  ├─ cleanupStaleSession() - Remove stale session files
  ├─ spawn('node', ['dist/daemon.js']) - Spawn daemon (detached)
  ├─ Wait for socket file (max 5s)
  └─ releaseDaemonLock() - Release lock on error
```

**3. `src/daemon.ts` - Daemon entry point (separate process)**
```
main()
  ├─ new IPCServer()
  └─ server.start()
```

**4. `src/daemon/ipcServer.ts` - IPC server initialization**
```
start()
  ├─ ensureSessionDir() - Create ~/.bdg/
  ├─ createServer() - Unix socket at ~/.bdg/daemon.sock
  └─ writePidFile() - Write daemon PID
```

### Phase 2: Command Parsing & Dispatch

**5. `src/index.ts` (continued)**
```
main()
  ├─ new Command() - Initialize Commander
  ├─ commandRegistry.forEach() - Register commands
  └─ program.parse() - Parse CLI arguments
```

**6. `src/cli/commands/start.ts` - Start command handler**
```
registerStartCommands()
  └─ .action()
      ├─ buildSessionOptions() - Normalize CLI options
      └─ collectorAction()
          └─ startSessionViaDaemon()
```

**7. `src/cli/handlers/daemonSessionController.ts` - Session controller**
```
startSessionViaDaemon()
  └─ sendStartSessionRequest(url, options) - Send IPC request
```

**8. `src/ipc/client.ts` - IPC client**
```
sendStartSessionRequest()
  ├─ Connect to ~/.bdg/daemon.sock
  ├─ Send JSONL: {"type": "start_session_request", ...}
  └─ Wait for response
```

### Phase 3: Daemon Handles Request

**9. `src/daemon/ipcServer.ts` - Daemon receives request**
```
handleConnection()
  └─ handleMessage()
      └─ handleStartSessionRequest()
          ├─ Check for existing session (concurrency guard)
          └─ launchSessionInWorker()
```

**10. `src/daemon/startSession.ts` - Worker launcher**
```
launchSessionInWorker()
  ├─ validateUrl() - Validate target URL
  ├─ spawn('node', ['dist/daemon/worker.js', config]) - Spawn worker
  └─ Wait for worker_ready signal on stdout (max 40s)
```

### Phase 4: Worker Process Initialization

**11. `src/daemon/worker.ts` - Worker entry point (separate process)**
```
main()
  ├─ parseWorkerConfig() - Parse config from argv
  ├─ normalizeUrl() - Add protocol if missing
  └─ launchChrome()
```

**12. `src/connection/launcher.ts` - Chrome launcher**
```
launchChrome()
  ├─ Auto-detect Chrome binary path
  ├─ Spawn Chrome --remote-debugging-port=9222
  ├─ Poll for CDP endpoint (max retries)
  └─ Return LaunchedChrome metadata
```

**13. `src/daemon/worker.ts` (continued)**
```
main()
  ├─ fetchCDPTargets() - Get available tabs via HTTP
  └─ new CDPConnection()
```

**14. `src/connection/cdp.ts` - CDP connection**
```
new CDPConnection()
  ├─ Connect to ws://localhost:9222/devtools/page/<targetId>
  ├─ Set up message ID tracking
  └─ Set up event subscription system
```

**15. `src/daemon/worker.ts` (continued)**
```
main()
  └─ waitForPageReady()
```

**16. `src/utils/pageReadiness.ts` - Page readiness detection**
```
waitForPageReady()
  ├─ cdp.send('Page.enable')
  ├─ Wait for Page.loadEventFired (max 2s)
  └─ Optional: Network/DOM stability (if waitForStability: true)
```

**17. `src/daemon/worker.ts` (continued)**
```
main()
  └─ activateCollectors()
```

**18. `src/collectors/network.ts` - Network collector**
```
startNetworkCollection()
  ├─ cdp.send('Network.enable')
  ├─ Register event handlers:
  │   ├─ Network.requestWillBeSent
  │   ├─ Network.responseReceived
  │   └─ Network.loadingFinished
  └─ Return cleanup function
```

**19. `src/collectors/console.ts` - Console collector**
```
startConsoleCollection()
  ├─ cdp.send('Runtime.enable')
  ├─ cdp.send('Log.enable')
  ├─ Register event handlers:
  │   ├─ Runtime.consoleAPICalled
  │   └─ Log.entryAdded
  └─ Return cleanup function
```

**20. `src/collectors/dom.ts` - DOM collector (prepare only)**
```
prepareDOMCollection()
  ├─ cdp.send('DOM.enable')
  └─ Return cleanup function
  Note: Actual snapshot happens on stop
```

**21. `src/daemon/worker.ts` (continued)**
```
main()
  ├─ writeSessionMetadata() - Write ~/.bdg/session.meta.json
  ├─ writePid() - Write ~/.bdg/session.pid
  ├─ Send worker_ready signal to stdout (JSONL)
  ├─ Set up stdin listener for IPC commands
  └─ Set up shutdown handlers (SIGTERM, SIGINT)
```

### Phase 5: Response & CLI Exit

**22. `src/daemon/startSession.ts` - Worker launcher receives signal**
```
launchSessionInWorker()
  ├─ Parse worker_ready message from stdout
  └─ Return WorkerMetadata to daemon
```

**23. `src/daemon/ipcServer.ts` - Daemon sends response**
```
handleStartSessionRequest()
  ├─ Store worker process reference
  └─ Send JSONL: {"type": "start_session_response", "status": "ok", ...}
```

**24. `src/ipc/client.ts` - IPC client receives response**
```
sendStartSessionRequest()
  ├─ Parse JSONL response
  └─ Return to session controller
```

**25. `src/cli/handlers/daemonSessionController.ts` - Display info**
```
startSessionViaDaemon()
  ├─ Output session metadata (PIDs, target URL, etc.)
  ├─ Show available commands (status, peek, stop)
  └─ process.exit(0) - CLI exits immediately
```

### Phase 6: Background Operation

**26. Worker continues running in background**
```
Worker Process (background)
  ├─ Listen for CDP events (network, console)
  ├─ Accumulate data in memory arrays
  ├─ Respond to IPC commands via stdin/stdout
  └─ Wait for stop command or timeout
```

## Process Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Process                             │
│  (node dist/index.js localhost:3000)                           │
│                                                                 │
│  index.ts → start.ts → daemonSessionController.ts              │
│                           │                                     │
│                           │ Unix Socket                         │
│                           │ ~/.bdg/daemon.sock                  │
│                           ▼                                     │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              Daemon Process (background)                  │ │
│  │         (node dist/daemon.js, detached)                   │ │
│  │                                                           │ │
│  │  daemon.ts → ipcServer.ts → startSession.ts              │ │
│  │                                  │                        │ │
│  │                                  │ spawn worker           │ │
│  │                                  ▼                        │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │         Worker Process (background)               │  │ │
│  │  │   (node dist/daemon/worker.js, detached)          │  │ │
│  │  │                                                    │  │ │
│  │  │  worker.ts → launcher.ts → Chrome Process         │  │ │
│  │  │           → cdp.ts (WebSocket)                    │  │ │
│  │  │           → collectors/*.ts (Network/Console/DOM) │  │ │
│  │  │                                                    │  │ │
│  │  │  stdin/stdout ← IPC → daemon                      │  │ │
│  │  └────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  CLI exits after starting session (exit code 0)                │
└─────────────────────────────────────────────────────────────────┘
```

## Key Files Reference

| File | Role | Process |
|------|------|---------|
| `src/index.ts` | CLI entry point | CLI |
| `src/cli/commands/start.ts` | Start command handler | CLI |
| `src/cli/handlers/daemonSessionController.ts` | Session controller | CLI |
| `src/ipc/client.ts` | IPC client | CLI |
| `src/daemon/launcher.ts` | Daemon spawner | CLI |
| `src/daemon.ts` | Daemon entry point | Daemon |
| `src/daemon/ipcServer.ts` | IPC server (Unix socket) | Daemon |
| `src/daemon/startSession.ts` | Worker spawner | Daemon |
| `src/daemon/worker.ts` | Worker entry & IPC handler | Worker |
| `src/connection/launcher.ts` | Chrome launcher | Worker |
| `src/connection/cdp.ts` | CDP WebSocket client | Worker |
| `src/collectors/network.ts` | Network request collector | Worker |
| `src/collectors/console.ts` | Console message collector | Worker |
| `src/collectors/dom.ts` | DOM snapshot collector | Worker |
| `src/utils/pageReadiness.ts` | Page load detection | Worker |

## Session Files

During execution, BDG creates these files in `~/.bdg/`:

| File | Created By | Purpose |
|------|------------|---------|
| `daemon.sock` | Daemon | Unix socket for IPC |
| `daemon.pid` | Daemon | Daemon process ID |
| `daemon.lock` | CLI | Atomic lock during daemon startup |
| `session.pid` | Worker | Worker process ID |
| `session.meta.json` | Worker | Session metadata (Chrome PID, port, target) |
| `session.json` | Worker | Final output (written on stop only) |
| `chrome-profile/` | Worker | Chrome user data directory |

## Communication Protocols

### IPC Protocol (CLI ↔ Daemon)

**Transport**: Unix domain socket (`~/.bdg/daemon.sock`)
**Format**: JSONL (newline-delimited JSON)

**Request Types**:
- `handshake_request` - Connection test
- `status_request` - Get session status
- `start_session_request` - Start new session
- `stop_session_request` - Stop session
- `peek_request` - Preview collected data
- `query_request` - Execute JavaScript

**Response Types**:
- `<type>_response` with `status: 'ok' | 'error'`

### Worker IPC (Daemon ↔ Worker)

**Transport**: stdin/stdout pipes
**Format**: JSONL

**Worker → Daemon**:
- `worker_ready` - Worker initialized successfully
- Command responses (DOM queries, peek, etc.)

**Daemon → Worker**:
- Command requests (forwarded from CLI)

### CDP Protocol (Worker ↔ Chrome)

**Transport**: WebSocket (`ws://localhost:9222/devtools/page/<targetId>`)
**Format**: JSON-RPC 2.0

**Commands**:
- `Page.enable`, `Network.enable`, `Runtime.enable`, etc.

**Events**:
- `Network.requestWillBeSent`, `Runtime.consoleAPICalled`, etc.

## Timing Breakdown (Typical)

| Phase | Duration | Notes |
|-------|----------|-------|
| CLI startup | ~50ms | Node.js startup + Commander parsing |
| Daemon check/launch | ~100ms | If daemon not running, spawn + socket wait |
| IPC request | ~10ms | Unix socket communication |
| Worker spawn | ~50ms | Node.js process spawn |
| Chrome launch | ~500-2000ms | Chrome startup (varies by system) |
| CDP connection | ~50-200ms | WebSocket handshake + target discovery |
| Page readiness | ~100-2000ms | Wait for load event (2s timeout) |
| Collector activation | ~50ms | Enable CDP domains |
| **Total** | **~1-5 seconds** | Varies by page complexity |

## Error Handling

### Daemon Already Running
- **Check**: `isDaemonRunning()` reads PID file
- **Error**: Custom error with `code: 'DAEMON_ALREADY_RUNNING'`
- **Exit Code**: `EXIT_CODES.DAEMON_ALREADY_RUNNING`

### Session Already Running
- **Check**: Worker PID file exists and process alive
- **Response**: `IPCErrorCode.SESSION_ALREADY_RUNNING` with session metadata
- **Suggestions**: `bdg status` or `bdg stop && bdg <url>`

### Chrome Launch Failure
- **Detection**: Chrome process exits or CDP endpoint unreachable
- **Diagnostics**: Auto-detect Chrome installations, show troubleshooting
- **Fallback**: Port conflicts detected, suggest `--port` flag

### Worker Timeout
- **Timeout**: 40s for `worker_ready` signal
- **Error**: `WorkerStartError` with code `READY_TIMEOUT`
- **Cleanup**: Worker process killed, session files removed

## Development Notes

### Adding New Commands

1. Define types in `src/ipc/commands.ts` (command registry)
2. Add worker handler in `src/daemon/worker.ts`
3. Add daemon forwarding in `src/daemon/ipcServer.ts`
4. Add client helper in `src/ipc/client.ts`
5. Add CLI command in `src/cli/commands/*.ts`

See `docs/BIDIRECTIONAL_IPC.md` for detailed pattern.

### Debugging Tips

**Enable verbose logging**:
```bash
# Watch daemon logs
tail -f ~/.bdg/daemon.log  # (if enabled)

# Watch worker stderr
ps aux | grep "node.*worker.js"
```

**Check process tree**:
```bash
ps aux | grep -E "node.*(daemon|worker)"
pstree -p $(cat ~/.bdg/daemon.pid)
```

**Monitor IPC traffic**:
```bash
# All IPC messages logged to daemon stderr
# Search for "[daemon] Raw frame:" in logs
```

**Test IPC manually**:
```bash
# Send handshake via socket
echo '{"type":"handshake_request","sessionId":"test"}' | nc -U ~/.bdg/daemon.sock
```

## Performance Optimizations

1. **Daemon persistence** - Reuse daemon across commands (no spawn overhead)
2. **Worker persistence** - Single worker handles entire session (no reconnects)
3. **Detached processes** - CLI exits immediately (UX improvement)
4. **Unix sockets** - Fast local IPC (no TCP overhead)
5. **JSONL streaming** - Efficient message framing
6. **CDP event filtering** - Only subscribe to needed events
7. **Response body optimization** - Skip non-text MIME types by default

## Related Documentation

- **IPC Architecture**: `docs/BIDIRECTIONAL_IPC.md`
- **Command Patterns**: `CLAUDE.md` (Adding New Commands section)
- **Chrome Setup**: `docs/CHROME_SETUP.md`
- **Session Management**: `src/session/README.md` (if exists)
