# P0 Critical Fixes - Implementation Summary

**Date**: 2025-01-04  
**Branch**: `refactor/ipc-streaming-data-access`  
**Status**: ✅ P0 #1 and #2 Implemented | ⏳ P0 #3 Requires Further Work

---

## Overview

This document summarizes the implementation of fixes for the three P0 (Priority 0) critical issues identified during comprehensive edge case testing. These issues were discovered in `scripts/test-edge-cases.sh` and documented in `docs/EDGE_CASE_FINDINGS.md`.

---

## ✅ P0 Fix #1: Daemon Startup Race Condition

### Problem
Two concurrent `bdg` commands could spawn 2 daemons simultaneously because there was no atomic lock for daemon startup - only session had lock protection.

### Root Cause
The daemon launcher checked for existing daemon PIDs but didn't use atomic file-based locking, creating a race window where multiple processes could all see "no daemon running" and spawn their own.

### Solution Implemented

#### 1. Added Daemon Lock Infrastructure
**File**: `src/session/paths.ts`
- Added `DAEMON_LOCK: 'daemon.lock'` to SESSION_FILES constant

**File**: `src/session/lock.ts`
- Added `acquireDaemonLock()` function - atomic lock acquisition using exclusive file creation (`wx` flag)
- Added `releaseDaemonLock()` function - cleanup after daemon startup
- Uses same proven pattern as session lock (stale lock detection via PID validation)

#### 2. Updated Daemon Launcher
**File**: `src/daemon/launcher.ts`
- Added lock acquisition at start of `launchDaemon()`
- Wrapped daemon startup in try/finally to ensure lock is released on error
- Lock is held until daemon writes its PID file (prevents race window)

```typescript
// Acquire daemon lock atomically to prevent concurrent daemon starts (P0 Fix #1)
if (!acquireDaemonLock()) {
  throw new Error('Daemon startup already in progress. Wait a moment and try again.');
}

try {
  // ... spawn daemon ...
} catch (error) {
  releaseDaemonLock(); // Always release lock on error
  throw error;
}
```

#### 3. Daemon Releases Lock After Startup
**File**: `src/daemon/ipcServer.ts`
- Added `releaseDaemonLock()` call in `writePidFile()` method
- Lock is released immediately after daemon PID is written to file
- This signals other waiters that daemon is ready

#### 4. Cleanup Integration
**File**: `src/session/cleanup.ts`
- Updated `cleanupStaleSession()` to also remove `daemon.lock` file
- Added `cleanupStaleDaemonPid()` function to clean up all daemon artifacts (PID, socket, lock)

### Expected Behavior After Fix
```bash
# Terminal 1
$ bdg localhost:3000 &
[launcher] Acquiring daemon lock...
[launcher] Starting daemon...

# Terminal 2 (immediately)
$ bdg localhost:3000 &
[launcher] Acquiring daemon lock...
Error: Daemon startup already in progress. Wait a moment and try again.
```

Only one daemon should exist after concurrent starts.

---

## ✅ P0 Fix #2: Stale Daemon PID Detection

### Problem
Fake or stale daemon PIDs (e.g., PID 99999 from crashed process) were treated as valid, blocking new daemon starts and confusing the `bdg status` command.

### Root Cause
The `bdg status` command didn't validate if the daemon PID process was actually alive - it just checked for file existence.

### Solution Implemented

#### 1. Auto-Cleanup in Status Command
**File**: `src/cli/commands/status.ts`
- Added `cleanupStaleDaemonPid()` import and call in error handler
- When daemon connection fails (ENOENT/ECONNREFUSED), automatically cleanup stale daemon PID
- Provides helpful feedback: "Daemon not running (stale PID cleaned up)"

```typescript
// P0 Fix #2: Auto-cleanup stale daemon PID if it exists
const cleaned = cleanupStaleDaemonPid();
if (cleaned) {
  console.error('Daemon not running (stale PID cleaned up). Start it with: bdg <url>');
} else {
  console.error('Daemon not running. Start it with: bdg <url>');
}
```

#### 2. New Cleanup Function
**File**: `src/session/cleanup.ts`
- Added `cleanupStaleDaemonPid()` function
- Validates daemon PID with `isProcessAlive()` before removal
- Cleans up: daemon PID, socket, and lock files
- Logs detailed cleanup actions for transparency

### Expected Behavior After Fix
```bash
# Create fake daemon PID
$ echo "99999" > ~/.bdg/daemon.pid

# Check status - should auto-cleanup
$ bdg status
[cleanup] Daemon not running (stale PID 99999), cleaning up...
[cleanup] Removed stale daemon PID file
Daemon not running (stale PID cleaned up). Start it with: bdg <url>

# Verify cleanup
$ ls ~/.bdg/daemon.pid
ls: ~/.bdg/daemon.pid: No such file or directory
```

---

## ⏳ P0 Fix #3: Rapid Connection Failures (TODO)

### Problem
Under rapid concurrent load (20 simultaneous peek requests), the daemon becomes unresponsive:
- 0/20 peek requests succeeded during testing
- System appears to block or hang
- Likely socket exhaustion or event loop blocking

### Root Cause (Hypothesis - Needs Investigation)
1. **Socket Handling**: Daemon may be blocking on first connection, preventing others from being accepted
2. **Sync I/O**: Potential synchronous file reads on hot path blocking event loop
3. **No Backpressure**: No connection queuing or rate limiting under load
4. **Resource Exhaustion**: File descriptors or socket buffers being exhausted

### Proposed Solution (Not Yet Implemented)

#### High-Level Approach
1. **Add Connection Queueing**: Implement backpressure with max concurrent connections
2. **Async Everything**: Ensure all I/O on hot path is fully async
3. **Preview Caching**: Cache session preview data in memory to avoid disk thrash
4. **Connection Timeouts**: Add read/write timeouts to prevent hung connections
5. **Client Retry Logic**: CLI automatically retries on "server busy" errors

#### Detailed Implementation Plan
See TODO list above for step-by-step implementation:
- Lightweight IPC diagnostics (debug mode)
- Async backpressure with concurrency limiter
- Fully async handleConnection with robust framing
- Coalesced in-memory PreviewCache
- CLI retry logic on "server busy"
- Hardening: timeouts, socket options, error containment

#### Estimated Effort
- Investigation: 1-2 hours
- Implementation: 2-3 hours
- Testing & Validation: 1 hour
- **Total**: 4-6 hours

---

## Files Modified

### Core Infrastructure Changes
1. **src/session/paths.ts** - Added DAEMON_LOCK file path
2. **src/session/lock.ts** - Added daemon lock functions
3. **src/session/cleanup.ts** - Added daemon cleanup functions

### Daemon Changes
4. **src/daemon/launcher.ts** - Integrated daemon lock acquisition
5. **src/daemon/ipcServer.ts** - Added lock release after PID write

### CLI Changes
6. **src/cli/commands/status.ts** - Added stale PID auto-cleanup

### Build Output
- ✅ TypeScript compilation successful
- ✅ No type errors
- ✅ Ready for testing

---

## Testing Recommendations

### Smoke Tests for P0 #1 (Daemon Lock)
```bash
# Test concurrent daemon starts
bdg localhost:3000 > /tmp/s1.log 2>&1 &
bdg localhost:3000 > /tmp/s2.log 2>&1 &
sleep 5

# Verify only one daemon
ps aux | grep daemon.js | grep -v grep | wc -l  # Should be 1

# Check second log
cat /tmp/s2.log  # Should contain "Daemon startup already in progress"
```

### Smoke Tests for P0 #2 (Stale PID Cleanup)
```bash
# Create fake daemon PID
echo "99999" > ~/.bdg/daemon.pid

# Run status - should auto-cleanup
bdg status  # Should show "stale PID cleaned up"

# Verify cleanup
test ! -f ~/.bdg/daemon.pid && echo "✓ Cleanup successful"
```

### Stress Test for P0 #3 (TODO - After Implementation)
```bash
# Start session
bdg localhost:3000 &
sleep 2

# Concurrent peek stress (3 rounds of 20 parallel requests)
for i in 1 2 3; do
  echo "Round $i:"
  seq 1 20 | xargs -n1 -P 20 -I{} sh -c 'bdg peek >/dev/null 2>>/tmp/peek.err || echo fail' | wc -l
done

# Expected: 0 failures per round after fix
```

---

## Next Steps

1. **Test P0 #1 and #2**: Run smoke tests to verify fixes work correctly
2. **Baseline P0 #3**: Reproduce rapid connection failures to establish baseline
3. **Implement P0 #3**: Follow the detailed implementation plan above
4. **Re-test All**: Run comprehensive edge case test suite again
5. **Update Documentation**: Document new daemon lock behavior and IPC changes

---

## Notes

- All changes maintain backward compatibility
- No breaking changes to CLI interface
- Lock files are automatically cleaned up on daemon exit
- Stale lock detection prevents indefinite blocking
- Comments explain WHY, not WHAT (per project guidelines)

---

## Related Documents

- `docs/EDGE_CASE_FINDINGS.md` - Original test results and issue discovery
- `docs/PROCESS_CLEANUP_FLOW.md` - Process lifecycle and cleanup documentation
- `scripts/test-edge-cases.sh` - Comprehensive edge case test suite
