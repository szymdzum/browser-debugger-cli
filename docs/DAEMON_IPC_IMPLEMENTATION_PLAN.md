# Daemon + IPC Implementation Plan

**Document Version**: 1.0
**Last Updated**: 2025-11-03
**Status**: Planning
**Related Documents**:
- [DAEMON_IPC_ARCHITECTURE.md](./DAEMON_IPC_ARCHITECTURE.md) - Architecture specification
- [DAEMON_IPC_ARCHITECTURE_REVIEW.md](./DAEMON_IPC_ARCHITECTURE_REVIEW.md) - Critical fixes
- [BDG_CDP_OPTIMIZATION_OPPORTUNITIES.md](./BDG_CDP_OPTIMIZATION_OPPORTUNITIES.md) - CDP research

---

## Overview

This document provides a detailed, step-by-step implementation plan for the daemon + IPC architecture. Each phase builds on the previous one, with clear objectives and validation steps.

**Implementation Strategy**:
1. Build foundation first (CDP enhancements, IPC protocol)
2. Implement core daemon infrastructure
3. Refactor existing commands to use IPC
4. Add logging and debugging tools
5. Remove file-based IPC fallback
6. Add optional advanced features

**Key Principles**:
- Each phase should be testable independently
- Maintain backward compatibility until Phase 5
- Use feature flags to toggle daemon mode during development
- Write comprehensive tests at each phase

---

## Phase 0: Foundation - CDP Enhancements

**Objective**: Add critical CDP event monitoring and resource management to prevent daemon hangs and memory issues.

**Why First**: These enhancements are prerequisites for a stable daemon. Without Inspector.detached monitoring, the daemon will hang when Chrome crashes or DevTools opens.

### Step 0.1: Add Inspector Domain Event Monitoring

**File**: `src/session/BdgSession.ts`

**Changes**:

1. Import Inspector event types in `src/types.ts`:
```typescript
export interface CDPInspectorDetachedParams {
  reason: string; // 'target_closed' | 'replaced_with_devtools' | 'render_process_gone'
}

export interface CDPTargetCrashedParams {
  targetId: string;
  status: string;
  errorMessage: string;
}
```

2. Add emergency shutdown method to BdgSession:
```typescript
private async emergencyStop(reason: string): Promise<void> {
  console.error(`Emergency stop triggered: ${reason}`);

  try {
    // Attempt to collect final state
    const output = this.buildOutput();

    // Write emergency output file
    const emergencyPath = path.join(os.homedir(), '.bdg', 'emergency.json');
    await fs.writeFile(emergencyPath, JSON.stringify(output, null, 2));

    console.error(`Emergency data saved to: ${emergencyPath}`);
  } catch (err) {
    console.error(`Failed to save emergency data: ${err}`);
  }

  // Cleanup collectors
  await this.stopAllCollectors();
}
```

3. Add Inspector.detached monitoring in `connect()` method:
```typescript
// After successful CDP connection, before collectors start
this.cdp.on('Inspector.detached', async (params: CDPInspectorDetachedParams) => {
  console.error(`CDP connection detached: ${params.reason}`);

  await this.emergencyStop(params.reason);

  // Exit process if in daemon mode
  if (process.env.BDG_WORKER === '1') {
    process.exit(1);
  }
});
```

4. Add Target.targetCrashed monitoring:
```typescript
this.cdp.on('Target.targetCrashed', async (params: CDPTargetCrashedParams) => {
  if (params.targetId === this.target.id) {
    console.error(`Target crashed: ${params.errorMessage}`);
    await this.emergencyStop(`target_crashed: ${params.status}`);

    if (process.env.BDG_WORKER === '1') {
      process.exit(1);
    }
  }
});
```

**Validation**:
- Build and test: `npm run build`
- Manually kill Chrome while bdg is running
- Verify emergency.json is written
- Verify process exits with code 1

### Step 0.2: Add Page Lifecycle Awareness

**File**: `src/session/BdgSession.ts`

**Changes**:

1. Add lifecycle event type to `src/types.ts`:
```typescript
export interface CDPPageLifecycleEventParams {
  frameId: string;
  loaderId: string;
  name: string; // 'init' | 'firstPaint' | 'firstContentfulPaint' | 'firstImagePaint' | 'firstMeaningfulPaintCandidate' | 'load' | 'DOMContentLoaded' | 'networkIdle' | 'networkAlmostIdle'
  timestamp: number;
}
```

2. Add method to wait for page ready state:
```typescript
private async waitForPageReady(timeoutMs: number = 10000): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (handlerId) {
        this.cdp.off('Page.lifecycleEvent', handlerId);
      }
      resolve(); // Timeout is not fatal, proceed anyway
    }, timeoutMs);

    let handlerId: number | undefined;

    const handler = (params: CDPPageLifecycleEventParams) => {
      if (params.name === 'networkIdle' || params.name === 'load') {
        clearTimeout(timeout);
        if (handlerId) {
          this.cdp.off('Page.lifecycleEvent', handlerId);
        }
        resolve();
      }
    };

    handlerId = this.cdp.on('Page.lifecycleEvent', handler);
  });
}
```

3. Enable lifecycle events in `connect()`:
```typescript
// After CDP connection, before starting collectors
await this.cdp.send('Page.enable');
await this.cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });

// Wait for page to be ready before starting collection
await this.waitForPageReady();

console.error('Page ready, starting collectors...');
```

**Validation**:
- Test with slow-loading page
- Verify collectors start after networkIdle event
- Check logs show "Page ready, starting collectors..."

### Step 0.3: Add Browser Metadata Collection

**File**: `src/session/BdgSession.ts`

**Changes**:

1. Add browser version types to `src/types.ts`:
```typescript
export interface BrowserVersion {
  protocolVersion: string;
  product: string; // e.g., "Chrome/120.0.6099.109"
  revision: string; // e.g., "@4c8c4b7c5e8d8e7e8f9e0a1b2c3d4e5f6a7b8c9d"
  userAgent: string;
  jsVersion: string; // e.g., "12.0.267.17"
}
```

2. Add browserVersion field to session state:
```typescript
private browserVersion?: BrowserVersion;
```

3. Fetch browser version in `connect()`:
```typescript
// After CDP connection
this.browserVersion = await this.cdp.send('Browser.getVersion') as BrowserVersion;
console.error(`Connected to ${this.browserVersion.product}`);
```

4. Include in session metadata:
```typescript
// Update getTarget() or add getBrowserVersion() getter
public getBrowserVersion(): BrowserVersion | undefined {
  return this.browserVersion;
}
```

**Validation**:
- Verify browser version appears in logs
- Check metadata includes protocolVersion and product

### Step 0.4: Add Network Buffer Limits

**File**: `src/collectors/network.ts`

**Changes**:

1. Update `startNetworkCollection()` to set buffer limits:
```typescript
await cdp.send('Network.enable', {
  maxTotalBufferSize: 100 * 1024 * 1024,     // 100MB total limit
  maxResourceBufferSize: 10 * 1024 * 1024,   // 10MB per resource
  maxPostDataSize: 1024 * 1024                // 1MB POST bodies
});
```

**Validation**:
- Test with high-traffic site
- Monitor memory usage over 5+ minutes
- Verify memory stabilizes below 200MB

### Step 0.5: Phase 0 Completion Checklist

- [x] Inspector.detached event handler added (`src/session/BdgSession.ts`)
- [x] Target.targetCrashed event handler added (`src/session/BdgSession.ts`)
- [x] Emergency shutdown logic implemented with `emergency.json` persistence (`src/session/BdgSession.ts`)
- [x] Page lifecycle awareness added via `waitForPageReady()` (`src/session/BdgSession.ts`)
- [x] Browser version collection added and exposed (`src/session/BdgSession.ts`)
- [x] Network buffer limits enforced in `startNetworkCollection()` (`src/collectors/network.ts`)
- [ ] Broader validation sweep (long-run traffic soak + structured test notes)
- [x] Process exits gracefully on disconnection (verified through emergency shutdown path)

---

## Phase 1: Core IPC Infrastructure

**Objective**: Implement the Unix domain socket IPC protocol with critical stream framing fixes.

### Step 1.1: Create IPC Protocol Types ✅

- Implemented in `src/ipc/protocol.ts`; shared request/response/handshake/status/peek contracts are stable.
- Keep `npm run build` in CI to guard for accidental divergence.

### Step 1.2: Implement IPC Server with Buffered JSONL Parsing ✅

- `src/ipc/server.ts` handles socket lifecycle, buffered parsing, and request routing (ping/status/peek/details/stop).
- Future work, if any, should focus on richer error codes or streaming responses.

### Step 1.3: Implement IPC Client with Buffered JSONL Parsing ✅

- `src/ipc/client.ts` mirrors the server framing, tracks pending requests with timeouts, and cleans up on disconnect.
- Consider reconnect/backoff extensions only after daemon lifecycle matures.

### Step 1.4: Implement Session Cleanup Utilities

**Status**: Partially complete. Core helpers live in `src/utils/session.ts`, but planned robustness gaps remain.

**Outstanding work**:
- Introduce a lock-aware `cleanupStaleSession()` that avoids races and removes orphaned socket/metadata files when the worker dies unexpectedly.
- Reconcile naming (`readPid`/`writePid`) with planned `getSessionPid`/`writeSessionPid` helpers or update the plan to the current API.
- Add unit coverage or smoke CLI checks that exercise stale session cleanup before spawning a new daemon.

### Step 1.5: Create Daemon Launcher ✅

- Implemented in `src/daemon/launcher.ts`; handles lock cleanup, worker spawn, handshake wait, metadata persistence, PID write, and log capture.
- Future improvement: integrate the planned stale-session cleanup once Step 1.4 lands.

### Step 1.6: Create Worker Process ✅

- Implemented in `src/daemon/worker.ts`; boots the IPC server before CDP connect, starts collectors, sends handshake, and tails logs.
- Open follow-ups: introduce graceful shutdown hooks once Step 1.4 cleanup and Phase 4 lifecycle tasks are completed.

### Step 1.7: Phase 1 Completion Checklist

- [x] IPC protocol types created
- [x] IPC server with buffered JSONL parsing implemented
- [x] IPC client with buffered JSONL parsing implemented
- [ ] Session cleanup utilities hardened (pending Step 1.4 follow-up)
- [x] Daemon launcher implemented
- [x] Worker process implemented
- [ ] Handshake protocol formally tested (manual smoke only)
- [ ] Lock file prevents concurrent sessions (requires Step 1.4 locking work)
- [x] Logs captured correctly (launcher + worker log piping)
- [ ] All unit tests pass (add coverage for new IPC utilities)

---

## Phase 2: Session Management

**Objective**: Update session file structure and integrate daemon mode with existing commands.

### Step 2.1: Update Session File Structure ✅

- `src/utils/session.ts` now persists the expanded `SessionMetadata` (socket path, target info, collectors, browser version).
- `writeSessionMetadata` is invoked by both foreground and daemon paths; `readSessionMetadata` backs the IPC commands.
- Follow-up: switch foreground runs to populate `socketPath` once daemon fallback is removed (Phase 5).

### Step 2.2: Add Daemon Detection to Main Entry Point

**Status**: Not started. `src/index.ts` still delegates directly to Commander without checking for a running daemon.

**Required changes**:
- Parse `process.argv` early to detect `--daemon-worker` and route to worker entry without Commander.
- Before launching a new session, consult session metadata + PID to inform the user that a daemon is already running.
- Provide helpful error messaging and exit codes aligned with CLI expectations.

### Step 2.3: Phase 2 Completion Checklist

- [x] Session metadata type defined
- [x] Metadata read/write functions implemented
- [ ] Daemon worker detection added to entry point
- [ ] Worker options parser implemented
- [ ] Both daemon and CLI modes tested (document scenarios)
- [x] Session files created correctly (metadata + PID)

---

## Phase 3: Command Refactoring for IPC

**Objective**: Update all commands to use IPC when daemon is running, fall back to file-based when foreground.

### Step 3.1: Update `bdg status` Command ✅

- Implemented in `src/cli/commands/status.ts`. Command now reads metadata, verifies PID, connects via `IPCClient`, and reports live stats.
- Remaining work: add automated smoke test that exercises the IPC path once daemon lifecycle tests (Phase 6) exist.

### Step 3.2: Update `bdg peek` Command ✅

- `src/cli/commands/peek.ts` attempts IPC first (`PeekData`) and falls back to file reads when the daemon is unavailable.
- TODO: revisit fallback once Phase 5 removes file-based output.

### Step 3.3: Update `bdg details` Command ✅

- `src/cli/commands/details.ts` now requires an active daemon and fetches detail payloads via IPC.
- Future enhancement: richer error messaging when network/console indices fall out of range.

### Step 3.4: Update `bdg stop` Command ✅

- `src/cli/commands/stop.ts` performs an IPC stop request when possible, then falls back to SIGKILL and cleanup utilities.
- Remaining gap: tighten Chrome kill logic once session metadata consistently tracks Chrome PID in daemon mode.

### Step 3.5: Update `bdg <url>` to Auto-Daemonize ✅

- Default path (`src/cli/commands/start.ts`) now launches daemon mode unless `--foreground` is provided.
- TODO: once Phase 5 removes file outputs, drop the fallback code paths that still reference `PreviewWriter`.

### Step 3.6: Phase 3 Completion Checklist

- [x] `bdg status` updated with IPC
- [x] `bdg peek` updated with IPC
- [x] `bdg details` updated with IPC
- [x] `bdg stop` updated with IPC
- [x] `bdg <url>` auto-daemonizes by default
- [x] `--foreground` flag preserves old behavior
- [ ] All commands tested with running daemon (document scenarios + add scripts)
- [ ] Error handling for disconnected daemon hardened (user-friendly messaging, retries)

---

## Phase 4: Logging & Debugging Infrastructure

**Objective**: Add comprehensive logging and debugging tools.

### Step 4.1: Add `bdg logs` Command

**File**: `src/index.ts`

**Changes**:

1. Add logs command:
```typescript
program
  .command('logs')
  .description('View worker logs')
  .option('--follow', 'Follow logs (tail -f style)')
  .option('--pid <pid>', 'View logs for specific PID')
  .action(async (options) => {
    const logDir = path.join(os.homedir(), '.bdg', 'logs');

    try {
      let logFile: string;

      if (options.pid) {
        logFile = path.join(logDir, `worker-${options.pid}.log`);
      } else {
        // Find most recent log file
        const metadata = await readSessionMetadata();
        if (metadata) {
          logFile = path.join(logDir, `worker-${metadata.pid}.log`);
        } else {
          // Find most recent
          const files = await fs.readdir(logDir);
          const logFiles = files
            .filter(f => f.startsWith('worker-') && f.endsWith('.log'))
            .sort()
            .reverse();

          if (logFiles.length === 0) {
            console.error('No log files found');
            process.exit(1);
          }

          logFile = path.join(logDir, logFiles[0]);
        }
      }

      if (options.follow) {
        // Use tail -f
        const { spawn } = require('node:child_process');
        const tail = spawn('tail', ['-f', logFile]);

        tail.stdout.on('data', (data: Buffer) => {
          process.stdout.write(data);
        });

        tail.on('error', (err: Error) => {
          console.error(`Failed to tail logs: ${err.message}`);
          process.exit(1);
        });

        // Cleanup on Ctrl+C
        process.on('SIGINT', () => {
          tail.kill();
          process.exit(0);
        });
      } else {
        // Cat entire file
        const content = await fs.readFile(logFile, 'utf-8');
        console.log(content);
      }
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });
```

**Validation**:
- Test logs command
- Test --follow mode
- Test --pid flag

### Step 4.2: Add Chrome Error Log Tailing

**File**: `src/daemon/launcher.ts`

**Changes**:

1. Update setupLogCapture to include chrome-err.log:
```typescript
function setupLogCapture(worker: ChildProcess): void {
  const logDir = path.join(os.homedir(), '.bdg', 'logs');
  const chromeLogDir = path.join(os.homedir(), '.bdg', 'chrome-profile');

  fs.mkdir(logDir, { recursive: true }).then(() => {
    const logFile = path.join(logDir, `worker-${worker.pid}.log`);
    const logStream = require('node:fs').createWriteStream(logFile, { flags: 'a' });

    // Worker stderr/stdout
    worker.stderr?.pipe(logStream);
    worker.stdout?.pipe(logStream);

    // Also tail chrome-err.log if exists
    const chromeErrLog = path.join(chromeLogDir, 'chrome-err.log');
    fs.access(chromeErrLog, fs.constants.F_OK).then(() => {
      const chromeStream = require('node:fs').createReadStream(chromeErrLog);
      chromeStream.pipe(logStream, { end: false });
    }).catch(() => {
      // Chrome error log doesn't exist yet, that's fine
    });

    // Cleanup
    worker.on('exit', () => {
      logStream.end();
    });

    // Rotate old logs
    rotateOldLogs(logDir, 5).catch(() => {});
  });
}
```

**Validation**:
- Verify chrome-err.log included in worker logs
- Test with Chrome crash

### Step 4.3: Phase 4 Completion Checklist

- [ ] `bdg logs` command implemented
- [ ] --follow flag works
- [ ] --pid flag works
- [ ] Chrome error logs included
- [ ] Log rotation works (keeps last 5)
- [ ] Logs are readable and useful

---

## Phase 5: IPC-Only Architecture Migration

**Objective**: Remove file-based intermediate dumps, rely solely on IPC for live queries.

### Step 5.1: Remove File-Based Output Functions

**File**: `src/utils/session.ts`

**Changes**:

1. Remove or comment out:
```typescript
// DELETE these functions:
// - writePartialOutputAsync()
// - writeFullOutputAsync()
// - readPartialOutput()
// - readFullOutput()
```

2. Keep only final output write:
```typescript
// KEEP this function (called only on stop):
export async function writeFinalOutput(data: BdgOutput): Promise<void> {
  const outputPath = path.join(os.homedir(), '.bdg', 'session.json');
  await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
}
```

**Validation**:
- Verify no intermediate files written during collection
- Verify final session.json written on stop

### Step 5.2: Update Collectors to Not Write During Collection

**Files**: `src/collectors/network.ts`, `src/collectors/console.ts`, `src/collectors/dom.ts`

**Changes**:

1. Remove any file I/O operations during collection
2. Keep only in-memory data accumulation

**Validation**:
- Verify no disk writes during collection
- Monitor disk I/O with `iostat` or similar

### Step 5.3: Update Session Management

**File**: `src/session/BdgSession.ts`

**Changes**:

1. Remove intermediate write calls:
```typescript
// DELETE these calls from run() loop:
// await writePartialOutputAsync(...)
// await writeFullOutputAsync(...)
```

2. Keep only final write in stop():
```typescript
async stop(): Promise<BdgOutput> {
  // ... stop collectors ...

  const output = this.buildOutput();

  // Write final output
  await writeFinalOutput(output);

  return output;
}
```

**Validation**:
- Test full daemon lifecycle
- Verify only final session.json written

### Step 5.4: Update Documentation

**Files**: `README.md`, `CLAUDE.md`

**Changes**:

1. Update workflow examples to show daemon mode
2. Remove references to intermediate files
3. Update session management section

### Step 5.5: Phase 5 Completion Checklist

- [ ] Intermediate write functions removed
- [ ] Collectors don't write during collection
- [ ] Final session.json written on stop only
- [ ] No preview.json or full.json files created
- [ ] Documentation updated
- [ ] All tests passing
- [ ] Disk I/O reduced to near zero during collection

---

## Phase 6: Testing & Validation

**Objective**: Comprehensive testing to ensure daemon stability and correctness.

### Step 6.1: Unit Tests for IPC Protocol

**File**: `tests/ipc/protocol.test.ts` (new file)

**Tests**:

1. Test JSONL serialization/deserialization
2. Test request/response matching by ID
3. Test error responses
4. Test invalid JSON handling

### Step 6.2: Integration Tests for Stream Framing

**File**: `tests/ipc/framing.test.ts` (new file)

**CRITICAL - Write These Tests During Phase 1**:
These tests must be written alongside the IPC implementation, not deferred. They catch subtle bugs in buffered JSONL parsing that will cause production hangs and crashes if missed.

**Tests**:

1. **Chunked handshake test**:
   - Send handshake JSON in 2-3 chunks (simulates slow stdout write)
   - Verify launcher waits for complete message before proceeding
   - Verify parsing succeeds with buffered line

2. **Concatenated IPC responses test**:
   - Send multiple responses in single write (`{...}\n{...}\n`)
   - Verify all messages parsed and dispatched correctly
   - Verify no responses are dropped

3. **Split IPC response test**:
   - Send response split across multiple writes (partial JSON)
   - Verify buffering accumulates until `\n` appears
   - Verify no premature parsing attempts

4. **Stderr blocking test**:
   - Fill stderr pipe (64KB+) without consuming
   - Verify worker doesn't hang (proper pipe consumption)
   - Verify log capture handles backpressure

### Step 6.3: Session Lifecycle Tests

**File**: `tests/session/lifecycle.test.ts` (new file)

**CRITICAL - Write Lock File Tests During Phase 1**:
Lock file contention tests must be written during session cleanup implementation (Step 1.4) to verify atomicity. These catch race conditions that lead to multiple daemons running.

**Tests**:

1. Full daemon launch → IPC query → stop workflow
2. Crash recovery (kill worker, verify cleanup)
3. Concurrent session detection (process alive check)
4. Handshake timeout handling (worker hangs/crashes before handshake)
5. **Lock file racing** (start 10 sessions simultaneously, only 1 succeeds):
   - Verify atomic lock acquisition
   - Verify losers get error message with PID of winner
   - Verify no race conditions in cleanup path

### Step 6.4: Manual Testing Scenarios

**Test 1: Basic Workflow**
```bash
bdg localhost:3000
bdg peek
bdg status
bdg stop
```

**Test 2: Crash Recovery**
```bash
bdg localhost:3000
kill -9 <PID>
bdg status  # Should detect crash
bdg cleanup
bdg localhost:3000  # Should start fresh
```

**Test 3: Foreground Mode**
```bash
bdg localhost:3000 --foreground
# Should show logs, Ctrl+C stops immediately
```

**Test 4: Follow Mode**
```bash
bdg localhost:3000
bdg peek --follow
# Should update every second
# Ctrl+C exits cleanly
```

### Step 6.5: Phase 6 Completion Checklist

- [ ] Unit tests written and passing
- [ ] Stream framing tests passing
- [ ] Session lifecycle tests passing
- [ ] Manual test scenarios verified
- [ ] No memory leaks detected
- [ ] No hanging processes
- [ ] Crash recovery works
- [ ] Lock file prevents concurrent sessions

---

## Phase 7: Optional Advanced Features

**Objective**: Add nice-to-have features for power users.

### Step 7.1: Pause/Resume Commands

**Files**: `src/index.ts`, `src/ipc/protocol.ts`, `src/ipc/server.ts`

**Changes**:

1. Add pause/resume to IPC protocol:
```typescript
export interface IPCRequest {
  // ... existing fields
  command: 'peek' | 'details' | 'stop' | 'status' | 'ping' | 'pause' | 'resume';
}
```

2. Add handler in IPC server:
```typescript
case 'pause':
  await this.session.pause();
  return { message: 'Collection paused' };

case 'resume':
  await this.session.resume();
  return { message: 'Collection resumed' };
```

3. Add pause/resume methods to BdgSession:
```typescript
async pause(): Promise<void> {
  await this.cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  console.error('Collection paused (page frozen)');
}

async resume(): Promise<void> {
  await this.cdp.send('Page.setWebLifecycleState', { state: 'active' });
  console.error('Collection resumed (page active)');
}
```

4. Add CLI commands:
```typescript
program
  .command('pause')
  .description('Pause collection (freeze page)')
  .action(async () => {
    // ... IPC request to pause
  });

program
  .command('resume')
  .description('Resume collection (unfreeze page)')
  .action(async () => {
    // ... IPC request to resume
  });
```

### Step 7.2: Stream Mode for Real-Time Output

**File**: `src/index.ts`

**Changes**:

1. Add --stream flag:
```typescript
program
  .argument('<url>', 'Target URL')
  .option('--stream', 'Stream events to stdout in real-time (JSONL)')
  .action(async (url, options) => {
    if (options.stream) {
      await runStreamMode(url, options);
    } else {
      // Normal daemon mode
    }
  });

async function runStreamMode(url: string, options: any): Promise<void> {
  // Run in foreground but stream events to stdout
  const session = new BdgSession(url, options);

  // Hook into collectors to stream events
  session.on('network', (event) => {
    console.log(JSON.stringify({ type: 'network', data: event }));
  });

  session.on('console', (event) => {
    console.log(JSON.stringify({ type: 'console', data: event }));
  });

  await session.connect();
  await session.run();
}
```

### Step 7.3: Multi-Session Support

**Changes**:

1. Add --session flag to all commands:
```typescript
program
  .argument('<url>', 'Target URL')
  .option('--session <name>', 'Session name (default: "default")')
  .action(async (url, options) => {
    const sessionName = options.session || 'default';
    // Use different files: session-<name>.pid, session-<name>.sock, etc.
  });
```

2. Update file paths to include session name:
```typescript
const sessionDir = path.join(os.homedir(), '.bdg', sessionName);
```

### Step 7.4: Windows Named Pipe Support

**File**: `src/ipc/server.ts`

**Changes**:

1. Detect platform and use appropriate IPC mechanism:
```typescript
constructor(session: BdgSession) {
  this.session = session;

  if (process.platform === 'win32') {
    this.socketPath = '\\\\.\\pipe\\bdg-session';
  } else {
    this.socketPath = path.join(os.homedir(), '.bdg', 'session.sock');
  }
}
```

### Step 7.5: Phase 7 Completion Checklist

- [ ] Pause/resume commands implemented
- [ ] Stream mode implemented
- [ ] Multi-session support implemented
- [ ] Windows named pipes implemented
- [ ] All features tested on target platforms
- [ ] Documentation updated

---

## Implementation Best Practices

### Code Organization

1. **Keep modules focused**: Each file should have a single responsibility
2. **Use absolute imports**: Leverage `@/` path mapping
3. **Type everything**: No `any` types without good reason
4. **Document public APIs**: JSDoc comments for all exported functions
5. **Type overlap**: Consolidate protocol types in `src/types.ts` vs. `src/ipc/protocol.ts` early to avoid diverging definitions. IPC-specific types should live in `src/ipc/protocol.ts`, while shared domain types go in `src/types.ts`

### Error Handling

1. **Always log errors**: Use stderr for error messages
2. **Provide context**: Include what failed and why
3. **Suggest fixes**: Tell user what to do next
4. **Exit with codes**: 0 = success, 1 = error

### Testing Strategy

1. **Test early**: Write tests as you implement
2. **Test boundaries**: Edge cases and error conditions
3. **Test integration**: Full workflows, not just units
4. **Test concurrency**: Race conditions, lock files
5. **Testing debt**: Integration tests for chunked IPC messages, lock-file contention, and lifecycle waits should be written alongside implementation, not deferred
6. **Critical IPC tests**: Must verify buffered JSONL parsing handles chunked handshakes, concatenated responses, and split messages

### Git Workflow

1. **One phase per PR**: Keep PRs focused and reviewable
2. **Test before commit**: Run `npm run check:enhanced`
3. **Write good messages**: Follow Conventional Commits
4. **Include validation**: Show test results in PR description

---

## Rollback Plan

If critical issues arise, rollback procedure:

### Phase 0-2 Rollback

1. Remove daemon code, keep existing foreground mode
2. No breaking changes to user workflow

### Phase 3-4 Rollback

1. Keep daemon mode behind `--daemon` flag
2. Make foreground mode the default
3. IPC code remains but not used by default

### Phase 5 Rollback

1. Re-enable intermediate file writes
2. Update IPC commands to read from files as fallback
3. Keep both IPC and file-based modes

---

## Success Criteria

Phase 0: ✅ CDP events monitored, emergency shutdown works
Phase 1: ✅ IPC server/client working, handshake succeeds
Phase 2: ✅ Session management robust, lock files prevent races
Phase 3: ✅ All commands use IPC, daemon is default mode
Phase 4: ✅ Logs accessible, debugging is easy
Phase 5: ✅ Zero disk I/O during collection
Phase 6: ✅ All tests passing, no crashes or hangs
Phase 7: ✅ Advanced features working (optional)

**Final Validation**:
- [ ] Run daemon for 1 hour on busy site, no crashes
- [ ] Memory usage stable below 200MB
- [ ] IPC queries return in <10ms
- [ ] Crash recovery works reliably
- [ ] All commands work as expected
- [ ] Documentation is accurate and complete

---

## Next Steps

After completing this implementation plan:

1. **Alpha Release** (v0.1.0-alpha): Daemon mode available behind flag
2. **Beta Release** (v0.2.0-beta): Daemon mode is default, thoroughly tested
3. **Stable Release** (v1.0.0): Production-ready daemon + IPC architecture

**Related Work**:
- Update docs to reflect new architecture
- Create migration guide for users
- Add telemetry to track adoption and issues
- Consider remote IPC for distributed debugging

---

**Document Status**: Planning
**Last Updated**: 2025-11-03
**Next Review**: After Phase 0 completion
