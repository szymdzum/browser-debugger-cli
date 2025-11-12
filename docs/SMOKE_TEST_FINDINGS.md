# Smoke Test Findings

This document lists the bugs discovered by smoke tests in commit 23a6444.

## Test Results Summary

- **11 tests total**
- **0 passing**
- **11 failing**
- **All failures represent real bugs**

## Critical Bugs Discovered

### 1. **`bdg stop` Silently Succeeds When No Session Exists**

**Bug**: The `stop` command returns exit code 0 (success) when there's no active session.

**Expected Behavior**: Should fail with a non-zero exit code and helpful error message.

**Actual Behavior**:
```bash
$ node dist/index.js stop
# (no output)
Exit code: 0
```

**Impact**: HIGH - Users and automation scripts can't distinguish between successful stop and no-op.

**Test**: `error-handling.smoke.test.ts` - "should fail with helpful message when trying to stop without session"

**Location**: `src/commands/stop.ts` - Missing validation check

---

### 2. **Exit Code 104 (Daemon Error) Used Instead of Semantic Exit Codes**

**Bug**: When errors occur during daemon/worker startup, the system returns exit code 104 instead of the appropriate semantic exit code.

**Cases**:
- Invalid URL → Returns 104, Expected 80 (INVALID_URL)
- Chrome launch failure → Returns 104, Expected 100 (CHROME_LAUNCH_FAILURE)
- General failures → Returns 104 instead of 1

**Expected Behavior**: Use semantic exit codes defined in `src/utils/exitCodes.ts`

**Actual Behavior**:
```bash
$ node dist/index.js not-a-valid-url
Error: Daemon error: Worker process exited...
Exit code: 104  # Should be 80 for INVALID_URL
```

**Impact**: HIGH - Breaks automation and error handling for agents/scripts

**Tests**:
- `error-handling.smoke.test.ts` - "should handle invalid URL gracefully"
- `error-handling.smoke.test.ts` - "should provide helpful error when Chrome fails to launch"

**Root Cause**: Daemon launcher catches worker errors and returns generic 104 code instead of propagating the worker's semantic exit code.

**Location**: `src/daemon/launcher.ts` or `src/index.ts` - Error handling in daemon startup

---

### 3. **Session Start Returns Exit Code 104 Instead of 0 on Success**

**Bug**: Starting a valid session returns exit code 104 instead of 0.

**Expected Behavior**: `bdg http://example.com` should return exit code 0 on successful start.

**Actual Behavior**:
```bash
$ node dist/index.js http://example.com
◆ Session Started
Target: https://example.com/
...
Exit code: 104  # Should be 0
```

**Impact**: CRITICAL - All sessions appear to fail even when successful

**Test**: `session-lifecycle.smoke.test.ts` - "should start session and create daemon"

**Root Cause**: Likely related to daemon detachment or process exit handling

---

### 4. **Daemon Processes Not Cleaning Up After Crashes**

**Bug**: After forcefully killing the daemon (SIGKILL), the process remains listed as "running" by helper functions.

**Expected Behavior**: `isDaemonRunning()` should return false after daemon is killed.

**Actual Behavior**: After `killDaemon('SIGKILL')`, the daemon is still detected as running.

**Impact**: HIGH - Prevents proper recovery from crashes, blocks new sessions

**Tests**:
- `error-handling.smoke.test.ts` - "should handle daemon crash during session"
- `session-lifecycle.smoke.test.ts` - "should cleanup daemon on stop"

**Root Cause**: 
- PID file not being cleaned up
- Race condition in kill/cleanup logic
- `isProcessAlive()` check timing issue

**Location**: `src/__testutils__/daemonHelpers.ts::killDaemon()` or `src/session/cleanup.ts`

---

### 5. **Stale Session Cleanup Not Working**

**Bug**: After killing daemon, starting a new session returns exit code 104 instead of auto-cleaning and succeeding.

**Expected Behavior**: New session should detect stale PID, cleanup automatically, and start successfully (exit code 0).

**Actual Behavior**:
```bash
$ # Kill daemon with SIGKILL
$ node dist/index.js http://example.com
Exit code: 104  # Should auto-cleanup and return 0
```

**Impact**: MEDIUM - Users must manually run `bdg cleanup --force` after crashes

**Test**: `error-handling.smoke.test.ts` - "should cleanup stale sessions automatically"

**Location**: `src/session/cleanup.ts::ensureNoStaleSession()` - Stale detection not working properly

---

### 6. **Peek Command Auto-Starts Daemon When None Running**

**Bug**: Running `bdg peek` when no daemon is running starts a new daemon instead of failing.

**Expected Behavior**: Should return exit code 83 (RESOURCE_NOT_FOUND) immediately.

**Actual Behavior**:
```bash
$ node dist/index.js peek
[bdg] Starting daemon...
[bdg] Daemon started successfully
Error: No active session found
Exit code: 83  # Correct code, but shouldn't auto-start daemon
```

**Impact**: MEDIUM - Unexpected behavior, creates daemon in bad state

**Test**: `error-handling.smoke.test.ts` - "should fail with helpful message when daemon not running"

**Location**: `src/index.ts` - Main entry point auto-launches daemon for all commands

---

### 7. **Concurrent Session Detection Not Working**

**Bug**: Starting a second session while one is active doesn't fail properly.

**Expected Behavior**: Second session attempt should fail with error about daemon already running.

**Actual Behavior**: Test shows unexpected behavior (needs investigation).

**Impact**: HIGH - Could corrupt session state

**Test**: `session-lifecycle.smoke.test.ts` - "should handle concurrent session attempts gracefully"

**Location**: `src/daemon/launcher.ts` or lock file logic in `src/session/lock.ts`

---

### 8. **Session Output Not Written on Stop**

**Bug**: After stopping a session, `session.json` is not being written or is null.

**Expected Behavior**: `~/.bdg/session.json` should exist with valid JSON structure.

**Actual Behavior**: `readSessionOutput()` returns null after stop.

**Impact**: CRITICAL - Users lose all collected data

**Test**: `session-lifecycle.smoke.test.ts` - "should write output on stop"

**Location**: `src/commands/stop.ts` - Output writing logic

---

## Secondary Issues

### URL Validation Too Permissive

**Observation**: "not-a-valid-url" is normalized to "http://not-a-valid-url/" and accepted.

**Impact**: LOW - Causes Chrome to fail later instead of early validation

**Recommendation**: Improve URL validation in `src/utils/url.ts`

---

## Root Cause Categories

1. **Exit Code Propagation** (Bugs #2, #3) - Daemon error handling loses semantic codes
2. **Process Lifecycle** (Bugs #4, #5) - Cleanup and kill logic has race conditions  
3. **Command Validation** (Bugs #1, #6) - Missing precondition checks before execution
4. **Session Locking** (Bug #7) - Concurrent access detection broken
5. **Output Writing** (Bug #8) - File I/O or timing issue

---

## Next Steps

1. Fix exit code propagation in daemon launcher
2. Fix process cleanup race conditions
3. Add command precondition validation
4. Verify session locking works
5. Debug output file writing
6. Run smoke tests again to verify fixes
