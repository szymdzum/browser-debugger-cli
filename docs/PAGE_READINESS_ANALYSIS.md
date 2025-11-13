# Page Readiness Blocking Analysis

## Executive Summary

**Problem**: The CLI returns control to the agent immediately after the worker sends its "ready" signal, but this happens BEFORE page readiness detection completes. This causes race conditions where agents try to interact with pages that aren't fully loaded.

**Root Cause**: The "worker_ready" signal is sent too early in the worker lifecycle - right after `waitForPageReady()` completes, but the CLI considers this the end of the session start process.

## Current Flow

### 1. Command Entry Point (`src/index.ts`)
```
User runs: bdg http://localhost:3000
  ↓
main() → ensureDaemonRunning() → program.parse()
  ↓
Daemon is already running, command is routed
```

### 2. Start Command (`src/commands/start.ts`)
```typescript
registerStartCommands(program)
  ↓
collectorAction(url, options)
  ↓
startSessionViaDaemon(url, sessionOptions, telemetry)
```

### 3. IPC Client Request (`src/commands/shared/daemonSessionController.ts`)
```typescript
startSessionViaDaemon():
  1. sendStartSessionRequest(url, options) // IPC call to daemon
  2. Wait for response
  3. If successful: display landing page
  4. process.exit(0) ← CLI EXITS HERE
```

**KEY ISSUE**: CLI exits as soon as it gets a successful response from the daemon, assuming the session is fully ready.

### 4. Daemon Session Start (`src/daemon/ipcServer.ts`)
```typescript
handleStartSessionRequest():
  1. Check for existing session
  2. await this.workerManager.launch(url, options)
  3. Send start_session_response to client
     ↓
     CLI receives response and exits immediately
```

### 5. Worker Launch (`src/daemon/startSession.ts`)
```typescript
launchSessionInWorker():
  1. Spawn worker process
  2. Wait for "worker_ready" signal on stdout
  3. Return metadata to daemon
     ↓
     Daemon sends response to CLI
```

**CRITICAL TIMING**: The daemon resolves the launch() promise as soon as it receives "worker_ready", which happens at line 238 in worker.ts.

### 6. Worker Process (`src/daemon/worker.ts`)

**Current sequence** (lines 210-245):
```typescript
main():
  // Lines 210-226: Setup (config, telemetry store, PID files)
  // Lines 227-230: Launch Chrome or connect to external Chrome
  // Lines 231-234: Connect CDP
  // Lines 235-237: Activate telemetry collectors
  // Lines 238-241: Navigate to URL
  
  // Line 242: THIS IS WHERE PAGE READINESS HAPPENS
  await waitForPageReady(cdp, {
    maxWaitMs: DEFAULT_PAGE_READINESS_TIMEOUT_MS,
  });
  console.error(`[worker] Page ready`); // Line 245
  
  // Lines 246-253: Update target metadata (get final URL/title)
  
  // Lines 254-262: Write session metadata
  
  // Line 264: SEND READY SIGNAL ← DAEMON SEES THIS
  sendReadySignal(config);
  
  // Lines 266+: Setup IPC listener, signal handlers, timeout
```

### 7. Page Readiness Detection (`src/connection/pageReadiness.ts`)

**What it does**:
```typescript
waitForPageReady():
  Phase 1: Wait for load event (window.onload)
  Phase 2: Wait for network stability (200ms idle, no active requests)
  Phase 3: Wait for DOM stability (300ms no mutations)
  
  All phases have adaptive detection and timeout handling
```

**Timeout**: 5 seconds by default, configurable via `DEFAULT_PAGE_READINESS_TIMEOUT_MS` (30s)

## The Race Condition

### Timeline

```
T+0ms:   CLI sends start_session_request to daemon
T+5ms:   Daemon spawns worker process
T+100ms: Worker launches Chrome
T+200ms: Worker connects CDP
T+300ms: Worker navigates to URL
T+400ms: Worker starts waitForPageReady()
         ↓
         Phase 1: Load event (completes at ~T+800ms)
         Phase 2: Network stable (completes at ~T+1200ms)  
         Phase 3: DOM stable (completes at ~T+1500ms)
         ↓
T+1600ms: Worker logs "[worker] Page ready"
T+1650ms: Worker sends "worker_ready" signal ← DAEMON SEES THIS
T+1700ms: Daemon resolves launch() promise
T+1750ms: Daemon sends start_session_response to CLI
T+1800ms: CLI displays landing page and exits ← AGENT REGAINS CONTROL

Result: Agent can immediately run next command (e.g., bdg peek)
```

### Why This Is Wrong

**The worker IS waiting for page readiness** (line 242 in worker.ts), but:
1. The worker sends its "ready" signal AFTER page readiness completes
2. The daemon sees this signal and immediately tells the CLI "session started"
3. The CLI exits and returns control to the agent
4. **BUT**: The worker hasn't finished writing metadata or setting up IPC yet!

**The gap** (lines 264-266):
```typescript
sendReadySignal(config);  // Line 264 - daemon sees this

setupStdinListener();     // Line 266 - IPC not ready yet!
```

If an agent runs `bdg peek` immediately after `bdg start` exits, there's a small window where:
- The worker exists
- The session metadata exists
- **But the worker's IPC stdin listener isn't set up yet**

This is typically only 10-50ms, but under load or slow systems it could be longer.

## Where Page Readiness IS Working

✅ **Worker correctly waits** for page readiness before sending ready signal  
✅ **Page readiness detection** works as designed (3-phase adaptive)  
✅ **Worker blocks** until page is actually ready  

## Where Page Readiness ISN'T Working

❌ **CLI exits too early** - doesn't wait for worker to finish initialization  
❌ **IPC listener setup** happens AFTER ready signal  
❌ **No guarantee** that worker is ready to receive commands when CLI exits  

## Solution Options

### Option 1: Move setupStdinListener() Before sendReadySignal() (RECOMMENDED)

**Change in worker.ts**:
```typescript
// Line 264: Setup IPC BEFORE sending ready signal
setupStdinListener();

// Line 266: NOW send ready signal
sendReadySignal(config);
```

**Why this works**:
- Worker is fully initialized before daemon sees "ready"
- No race condition for immediate peek/status commands
- Minimal code change
- No timeout changes needed

**Trade-off**: None - this is strictly better ordering

### Option 2: Add "worker_initialized" Second Signal

**Add new signal type**:
```typescript
// After setupStdinListener():
sendInitializedSignal(); // New signal type
```

**Daemon waits for BOTH signals**:
```typescript
launchSessionInWorker():
  1. Wait for "worker_ready" (page loaded, telemetry active)
  2. Wait for "worker_initialized" (IPC listener ready)
  3. Return to CLI
```

**Why this works**:
- Explicit separation of "page ready" vs "worker ready to receive commands"
- More robust for future enhancements
- Clear semantics

**Trade-off**: More complex, requires changes to daemon and IPC types

### Option 3: Delay CLI Exit (NOT RECOMMENDED)

**Add artificial delay in CLI**:
```typescript
// In daemonSessionController.ts after displaying landing page:
await new Promise(resolve => setTimeout(resolve, 100));
process.exit(0);
```

**Why this could work**:
- Gives worker time to set up IPC listener
- No changes to worker/daemon

**Why this is BAD**:
- Hacky
- Arbitrary timeout (what if system is slow?)
- Doesn't actually solve the race condition
- Poor user experience (unexplained delay)

## Recommended Implementation

### Step 1: Reorder Worker Initialization

**File**: `src/daemon/worker.ts`  
**Change**: Move `setupStdinListener()` before `sendReadySignal()`

```typescript
// OLD (lines 264-266):
sendReadySignal(config);

setupStdinListener();

// NEW:
setupStdinListener();

sendReadySignal(config);
```

### Step 2: Add Debug Logging

**Verify timing**:
```typescript
console.error('[worker] IPC stdin listener ready');
setupStdinListener();

console.error('[worker] Sending ready signal to daemon');
sendReadySignal(config);
```

### Step 3: Update Worker Launch Timeout

**File**: `src/daemon/startSession.ts`  
**Current**: 40 second timeout (includes 30s page readiness + 10s buffer)

**Consideration**: Timeout is already generous, no change needed.

### Step 4: Test Race Condition Fix

**Test scenario**:
```bash
# Start session
bdg http://localhost:3000 &
SESSION_PID=$!

# Wait for CLI to exit
wait $SESSION_PID

# Immediately try to peek (this currently has a race condition)
bdg peek
```

**Expected**: `bdg peek` should always succeed because IPC listener is ready before CLI exits.

## Files to Modify

1. **src/daemon/worker.ts** (lines 264-266)
   - Move `setupStdinListener()` before `sendReadySignal()`
   - Add debug logging to verify ordering

2. **No other changes needed** for Option 1

## Testing Checklist

- [ ] Start session and immediately run `bdg peek` (no delay)
- [ ] Start session and immediately run `bdg status` (no delay)
- [ ] Verify worker stderr shows correct log order:
  - `[worker] IPC stdin listener ready`
  - `[worker] Sending ready signal to daemon`
- [ ] Run smoke tests to ensure no regression
- [ ] Test with slow system/network (Docker container with CPU throttling)

## Summary

**Current State**: Page readiness detection works perfectly, but the worker signals "ready" to the daemon before its IPC listener is set up, creating a small race condition window.

**Fix**: Simply reorder two lines in worker.ts to ensure IPC listener is ready before signaling to daemon.

**Impact**: Eliminates race condition, no performance penalty, no semantic changes to "readiness".
