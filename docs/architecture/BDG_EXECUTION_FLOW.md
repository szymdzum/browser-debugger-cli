# BDG Execution Flow

This document describes the complete execution flow when running `bdg <url>`.

## Overview

BDG uses a **2-process architecture**:
1. **CLI Process** - User command (exits after starting session)
2. **Daemon Process** - Long-running IPC server that *is* the session: it hosts Chrome, the CDP connection and telemetry in-process

The daemon's lifetime is the session's lifetime. Only `bdg <url>` spawns a daemon; every other command talks to an existing daemon and exits with code 83 ("No active session") when there is none.

## Execution Flow: `bdg localhost:3000`

### Phase 1: CLI Entry & Daemon Launch

**1. `src/index.ts` - Main entry point**
```
main()
  ├─ new Command() - Initialize Commander
  ├─ commandRegistry.forEach() - Register commands
  └─ program.parseAsync() - Parse CLI arguments
```

**2. `src/commands/start.ts` - Start command handler**
```
.action()
  └─ collectorAction()
      ├─ Normalize CLI options
      └─ startSessionViaDaemon()
```

**3. `src/commands/shared/startHelpers.ts` - Start helper**
```
startSessionViaDaemon()
  ├─ launchDaemon() - Ensure a daemon is running
  └─ sendStartSessionRequest(url, options) - Send IPC request
```

**4. `src/daemon/launcher.ts` - Daemon launcher**
```
launchDaemon()
  ├─ isDaemonAlive() - Probe ~/.bdg/daemon.sock; return if it accepts a connection
  ├─ spawn(process.execPath, ['dist/daemon.js']) - Spawn daemon (detached,
  │                                                stdout/stderr → ~/.bdg/daemon.log)
  └─ Poll socket until it accepts connections (max 5s)
      └─ If the spawned daemon exited, accept another daemon's socket
         (it may have lost a single-instance race)
```

**5. `src/daemon.ts` - Daemon entry point (separate process)**
```
main()
  ├─ new IPCServer()
  ├─ Register SIGINT/SIGTERM → server.shutdown()
  └─ server.start()
      └─ DAEMON_ALREADY_RUNNING → exit 0 (another daemon owns the socket)
```

**6. `src/daemon/ipcServer.ts` - IPC server initialization**
```
start()
  ├─ ensureSessionDir() - Create ~/.bdg/
  ├─ socketServer.start() - Claim ~/.bdg/daemon.sock (see SocketServer)
  ├─ writePidFile() - Write ~/.bdg/daemon.pid (informational only)
  └─ Start idle timer (10s) - Exit if no session was started
```

**7. `src/daemon/server/SocketServer.ts` - Single-instance socket claim**
```
start()
  ├─ listen() on private path ~/.bdg/daemon.sock.<pid>
  ├─ claim() - link() private path → ~/.bdg/daemon.sock
  │   ├─ EEXIST + socket alive → DaemonError(DAEMON_ALREADY_RUNNING)
  │   └─ EEXIST + socket stale → remove stale file, retry once
  └─ Remove private path
```

### Phase 2: IPC Request

**8. `src/ipc/client.ts` - IPC client**
```
startSession()
  ├─ Connect to ~/.bdg/daemon.sock
  ├─ Send JSONL: {"type": "start_session_request", ...}
  └─ Wait for response (45s default, BDG_IPC_TIMEOUT_MS)
```

### Phase 3: Daemon Handles Request

**9. `src/daemon/ipcServer.ts` - Daemon receives request**
```
handleConnection()
  └─ handleMessage()
      └─ route()
          └─ controller.startSession()
```

**10. `src/daemon/SessionController.ts` - Session controller**
```
startSession()
  ├─ Concurrency guard: session running or starting → error response
  │   (SESSION_ALREADY_RUNNING or SESSION_TARGET_MISMATCH)
  └─ Session.start(url, options, onEnded)
```

### Phase 4: In-Process Session Initialization

**11. `src/daemon/session/Session.ts` - Session start**
```
Session.start()
  ├─ validateUrl() - Validate target URL
  ├─ getSessionPort() - Explicit --port, saved port.txt, or first free port
  └─ launch()
      ├─ killOrphanedChrome() - Kill Chrome from chrome.pid if it is still a
      │                         bdg Chrome (skipped with --chrome-ws-url)
      └─ setupChromeConnection()
```

**12. `src/daemon/session/chromeConnection.ts` - Chrome setup**
```
setupChromeConnection()
  ├─ --chrome-ws-url: attach to external Chrome (no PID, never terminated)
  └─ Otherwise:
      ├─ launchChrome() - src/connection/launcher.ts
      ├─ writeChromePid() - Write ~/.bdg/chrome.pid
      └─ fetchCDPTargets() - Pick first page target
```

**13. `src/connection/launcher.ts` - Chrome launcher**
```
launchChrome()
  ├─ Auto-detect Chrome binary path (chrome-launcher)
  ├─ Spawn Chrome --remote-debugging-port=<port>
  ├─ Verify Chrome process is alive / CDP available
  └─ Return LaunchedChrome metadata
```

**14. `src/daemon/session/cdpSetup.ts` - CDP setup & navigation**
```
setupCDPAndNavigate()
  ├─ new CDPConnection().connect(webSocketDebuggerUrl)
  │   └─ onDisconnect → session.stop('crash')
  ├─ startTelemetryCollectors() - Activate collectors before navigation
  ├─ cdp.send('Page.navigate', { url })
  ├─ waitForPageReady()
  └─ Refresh target info (title/url) for launched Chrome
```

**15. `src/daemon/session/collectors.ts` - Telemetry plugins**
```
startTelemetryCollectors()
  ├─ dialogs, navigation (always)
  ├─ network, websocket (telemetry: 'network') - src/telemetry/network.ts
  ├─ console (telemetry: 'console') - src/telemetry/console.ts
  ├─ dom (telemetry: 'dom') - src/telemetry/dom.ts (enable domains only)
  └─ Return cleanup functions
```
See `TELEMETRY-PLUGIN.md` for the plugin contract.

**16. `src/connection/pageReadiness.ts` - Page readiness detection**
```
waitForPageReady()
  ├─ Wait for Page.loadEventFired
  ├─ Wait for network stability (200ms idle)
  └─ Wait for DOM stability (300ms idle)
  All within a 2s budget (DEFAULT_PAGE_READINESS_TIMEOUT_MS)
```

**17. `src/daemon/session/Session.ts` (continued)**
```
launch()
  ├─ writeSessionMetadata() - Write ~/.bdg/session.meta.json
  └─ If --timeout: schedule session.stop('timeout')
```

If any step fails, `teardownSession()` releases whatever was started and the error is returned to the CLI; the daemon then exits.

### Phase 5: Response & CLI Exit

**18. `src/daemon/SessionController.ts` - Daemon sends response**
```
startSession()
  ├─ Store Session reference
  └─ Return {"type": "start_session_response", "status": "ok", data: {...}}
      (workerPid is the daemon PID; chromePid, port, targetUrl, targetTitle)
```

**19. `src/commands/shared/startHelpers.ts` - Display info**
```
startSessionViaDaemon()
  ├─ Print landing page (or one line with --quiet)
  └─ process.exit(0) - CLI exits immediately
```

### Phase 6: Background Operation

**20. Daemon continues running in background**
```
Daemon Process (background)
  ├─ Listen for CDP events (network, console, navigation)
  ├─ Accumulate data in TelemetryStore
  ├─ Answer IPC requests directly via SessionController → Session.execute()
  └─ Exit when the session ends:
      ├─ bdg stop
      ├─ Chrome / CDP disconnect
      ├─ --timeout elapsed
      └─ SIGINT / SIGTERM
```

## Process Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Process                             │
│  (node dist/index.js localhost:3000)                           │
│                                                                 │
│  index.ts → start.ts → startHelpers.ts → launcher.ts           │
│                           │                                     │
│                           │ Unix Socket                         │
│                           │ ~/.bdg/daemon.sock                  │
│                           ▼                                     │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │       Daemon Process = Session (background)               │ │
│  │         (node dist/daemon.js, detached)                   │ │
│  │                                                           │ │
│  │  daemon.ts → ipcServer.ts → SessionController.ts         │ │
│  │                                  │                        │ │
│  │                                  │ in-process             │ │
│  │                                  ▼                        │ │
│  │  session/Session.ts → connection/launcher.ts → Chrome    │ │
│  │                     → connection/cdp.ts (WebSocket)       │ │
│  │                     → session/collectors.ts (plugins)     │ │
│  │                     → session/commandRegistry.ts          │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  CLI exits after starting session (exit code 0)                │
└─────────────────────────────────────────────────────────────────┘
```

## Key Files Reference

| File | Role | Process |
|------|------|---------|
| `src/index.ts` | CLI entry point | CLI |
| `src/commands/start.ts` | Start command handler | CLI |
| `src/commands/shared/startHelpers.ts` | Launch daemon + send start request | CLI |
| `src/ipc/client.ts` | IPC client | CLI |
| `src/daemon/launcher.ts` | Daemon spawner | CLI |
| `src/session/daemonSocket.ts` | Liveness probe (socket connectable) | CLI + Daemon |
| `src/daemon.ts` | Daemon entry point | Daemon |
| `src/daemon/ipcServer.ts` | IPC server, routing, shutdown | Daemon |
| `src/daemon/server/SocketServer.ts` | Exclusive socket claim | Daemon |
| `src/daemon/SessionController.ts` | Request handling for the session | Daemon |
| `src/daemon/session/Session.ts` | Session lifecycle | Daemon |
| `src/daemon/session/chromeConnection.ts` | Launch or attach to Chrome | Daemon |
| `src/daemon/session/cdpSetup.ts` | CDP connect, collectors, navigation | Daemon |
| `src/daemon/session/collectors.ts` | Telemetry plugin activation | Daemon |
| `src/daemon/session/commandRegistry.ts` | Session command handlers | Daemon |
| `src/daemon/session/teardown.ts` | Collector cleanup, CDP close, Chrome kill | Daemon |
| `src/connection/launcher.ts` | Chrome launcher | Daemon |
| `src/connection/cdp.ts` | CDP WebSocket client | Daemon |
| `src/connection/pageReadiness.ts` | Page load detection | Daemon |
| `src/telemetry/network.ts` | Network request collector | Daemon |
| `src/telemetry/console.ts` | Console message collector | Daemon |
| `src/telemetry/dom.ts` | DOM collector | Daemon |
| `src/session/cleanup/staleSession.ts` | Crash cleanup helpers | CLI + Daemon |

## Session Files

During execution, BDG creates these files in `~/.bdg/` (or `$BDG_SESSION_DIR`):

| File | Created By | Purpose |
|------|------------|---------|
| `daemon.sock` | Daemon | Unix socket for IPC; connectable = daemon alive |
| `daemon.pid` | Daemon | Daemon process ID (informational, never used for liveness) |
| `daemon.log` | CLI (launcher) | Daemon stdout/stderr |
| `session.meta.json` | Daemon | Session metadata (Chrome PID, port, target) |
| `chrome.pid` | Daemon | Launched Chrome PID; kept until Chrome is confirmed dead |
| `port.txt` | Daemon | Saved CDP port, reused by the next session if free |
| `chrome-profile/` | Daemon | Chrome user data directory |

When the session ends the daemon removes `daemon.sock`, `daemon.pid`, `session.meta.json` and the query cache. `chrome.pid` is cleared by teardown only once Chrome has exited.

## Communication Protocols

### IPC Protocol (CLI ↔ Daemon)

**Transport**: Unix domain socket (`~/.bdg/daemon.sock`)
**Format**: JSONL (newline-delimited JSON)

**Request Types**:
- `handshake_request` - Connection test
- `status_request` - Get daemon/session status
- `start_session_request` - Start new session
- `stop_session_request` - Stop session
- `peek_request` - Preview collected data
- `har_data_request` - Network requests for HAR export
- `<command>_request` - Session commands (`worker_details`, `cdp_call`, `dom_*`, ...)

**Response Types**:
- `<type>_response` with `status: 'ok' | 'error'`

Command keys such as `worker_peek` keep their historical names; they are now executed in-process by the daemon.

### CDP Protocol (Daemon ↔ Chrome)

**Transport**: WebSocket (`webSocketDebuggerUrl` of the page target, e.g. `ws://localhost:9222/devtools/page/<targetId>`)
**Format**: JSON-RPC 2.0

**Commands**:
- `Page.enable`, `Network.enable`, `Runtime.enable`, etc.

**Events**:
- `Network.requestWillBeSent`, `Runtime.consoleAPICalled`, etc.

## Timing Breakdown (Typical)

| Phase | Duration | Notes |
|-------|----------|-------|
| CLI startup | ~50ms | Node.js startup + Commander parsing |
| Daemon launch | ~100ms | Spawn + socket wait (5s max) |
| IPC request | ~10ms | Unix socket communication |
| Chrome launch | ~500-2000ms | Chrome startup (varies by system) |
| CDP connection | ~50-200ms | WebSocket handshake + target discovery |
| Collector activation | ~50ms | Enable CDP domains |
| Page readiness | ~100-2000ms | Load event + stability (2s budget) |
| **Total** | **~1-5 seconds** | Varies by page complexity |

## Error Handling

### Daemon Already Running
- **Check**: `SocketServer.claim()` - `link()` to `daemon.sock` fails with EEXIST and the socket is connectable
- **Behavior**: The new daemon exits 0; the launcher sees a live socket and the CLI talks to the existing daemon
- **Stale socket**: If nothing is listening, the file is removed and the claim retried once

### Session Already Running
- **Check**: `SessionController` already holds a session (or one is starting)
- **Response**: `IPCErrorCode.SESSION_ALREADY_RUNNING` (or `SESSION_TARGET_MISMATCH` if a different target was requested) with existing session details
- **Suggestions**: `bdg status` or `bdg stop && bdg <url>`

### No Active Session
- **Check**: Daemon socket not connectable (connection error in the IPC client)
- **Exit Code**: `EXIT_CODES.RESOURCE_NOT_FOUND` (83)
- **Note**: Commands other than `bdg <url>` never spawn a daemon

### Chrome Launch Failure
- **Detection**: Chrome process exits or CDP endpoint unreachable
- **Diagnostics**: Auto-detect Chrome installations, show troubleshooting
- **Response**: `IPCErrorCode.WORKER_START_FAILED`; the daemon tears down and exits

### Daemon Startup Failure
- **Timeout**: 5s for the daemon socket to accept connections
- **Error**: `DaemonStartupError` (`DAEMON_START_TIMEOUT`, `DAEMON_EXITED`, `DAEMON_SCRIPT_NOT_FOUND`)
- **Diagnostics**: See `~/.bdg/daemon.log`

### Crash Cleanup
A healthy daemon cleans up after itself. After a crash or SIGKILL, `src/session/cleanup/staleSession.ts` handles leftovers:
- `bdg status` removes a stale `daemon.sock` (file present, nothing listening)
- `bdg cleanup` removes stale daemon files and kills the Chrome in `chrome.pid`; `--force` also kills a live daemon
- The next session start kills the Chrome in `chrome.pid`
- Chrome is only killed if its command line contains the `--bdg-session-dir=<session dir>` marker bdg adds at launch, so a reused PID (or a user's own debugging Chrome) is never killed

## Development Notes

### Adding New Commands

1. Define request/response schemas in `src/ipc/protocol/commands.ts` (`COMMANDS`)
2. Add the handler in `src/daemon/session/commandRegistry.ts`
3. Add a client helper in `src/ipc/client.ts` (via `sendCommand`)
4. Add the CLI command in `src/commands/*.ts`

No daemon routing change is needed: `ipcServer.ts` routes every registered command to `SessionController.command()`.

See `BIDIRECTIONAL_IPC.md` for the detailed pattern.

### Debugging Tips

**Enable verbose logging**:
```bash
# Watch daemon logs
tail -f ~/.bdg/daemon.log

# Debug-level logging in the CLI
bdg status --debug
```

**Check process tree**:
```bash
ps aux | grep "node.*daemon.js"
pstree -p $(cat ~/.bdg/daemon.pid)
```

**Test IPC manually**:
```bash
# Send handshake via socket
echo '{"type":"handshake_request","sessionId":"test"}' | nc -U ~/.bdg/daemon.sock
```

## Performance Optimizations

1. **Daemon persistence** - One daemon serves every command for the session (no spawn overhead)
2. **In-process session** - Commands execute directly against the CDP connection (no extra IPC hop)
3. **Detached processes** - CLI exits immediately (UX improvement)
4. **Unix sockets** - Fast local IPC (no TCP overhead)
5. **JSONL streaming** - Efficient message framing
6. **CDP event filtering** - Only subscribe to needed events
7. **Response body optimization** - Skip non-text MIME types by default

## Related Documentation

- **IPC Architecture**: `docs/architecture/BIDIRECTIONAL_IPC.md`
- **Telemetry Plugins**: `docs/architecture/TELEMETRY-PLUGIN.md`
- **Migration Plan**: `docs/roadmap/DAEMON_SESSION_MIGRATION.md`
- **CLI Reference**: `docs/CLI_REFERENCE.md`
- **Command Patterns**: `CLAUDE.md`
