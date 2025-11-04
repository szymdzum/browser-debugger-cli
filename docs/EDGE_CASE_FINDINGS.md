# Edge Case Test Findings

## Test Results Summary

**Date**: 2025-01-04  
**Test Suite**: scripts/test-edge-cases.sh  
**Results**: 12 passed, 4 failed, 7 warnings (23 total tests)

---

## Critical Failures (Must Fix)

### 1. Concurrent Session Starts - Race Condition ⚠️ CRITICAL
**Test**: 1.1 - Starting two sessions simultaneously  
**Result**: Both sessions started (should be one)  
**Severity**: High - Data corruption risk

**Root Cause**:
- Both sessions start their own daemons simultaneously
- No atomic lock acquisition during daemon startup
- Session lock is acquired AFTER daemon starts, not before

**Evidence**:
```
[bdg] Starting daemon...  # Session 1
[bdg] Starting daemon...  # Session 2 (both succeeded!)
```

**Impact**:
- Two worker processes collecting data simultaneously
- Undefined behavior, potential PID file corruption
- Session files could be overwritten

**Fix Required**:
1. Add atomic lock file for daemon startup (not just session)
2. Use `flock` or file-based mutex for daemon.pid creation
3. Second daemon startup should fail immediately if lock is held
4. Test: Verify only one daemon PID exists after concurrent starts

---

### 2. Stale Daemon PID Detection ⚠️ HIGH
**Test**: 2.3 - Stale daemon PID file  
**Result**: Did not detect stale PID (PID 99999 treated as valid)  
**Severity**: High - Blocks new sessions

**Root Cause**:
- `bdg status` does not validate if PID in daemon.pid is actually running
- Assumes PID file presence means daemon is alive

**Impact**:
- Stale daemon PIDs block new daemon starts
- User must manually delete files
- Poor UX after crash

**Fix Required**:
1. Add `isProcessAlive(daemonPid)` check in status command
2. Auto-cleanup stale daemon.pid if process is dead
3. Log: "Daemon not running (stale PID file cleaned up)"
4. Test: Verify detection of fake PID 99999

---

### 3. Rapid Connect/Disconnect Failures ⚠️ HIGH
**Test**: 4.3 - Rapid connect/disconnect cycles  
**Result**: 0/20 peek requests succeeded  
**Severity**: High - System becomes unresponsive under load

**Root Cause** (needs investigation):
- Possible socket exhaustion
- Daemon not handling rapid connections
- Connection pool or file descriptor issue

**Evidence**:
```bash
# All 20 rapid peeks failed
for i in {1..20}; do
  timeout 2 bdg peek > /dev/null 2>&1  # All timed out
done
```

**Impact**:
- System unusable under concurrent load
- Timeouts cascade
- Daemon may be blocking on first connection

**Fix Required**:
1. Investigate daemon connection handling
2. Check for blocking operations in socket accept loop
3. Add connection queue or thread pool
4. Test: Verify 15+/20 rapid peeks succeed

---

### 4. Negative lastN Validation Works ✅
**Test**: 6.2 - Negative lastN  
**Result**: Rejected correctly  
**Status**: Working as expected

---

## Warnings (Should Fix)

### 5. Corrupted Metadata Handling ⚠️ MEDIUM
**Test**: 3.2 - Corrupted session metadata  
**Result**: Status command succeeded despite corruption  
**Impact**: Silent failure, misleading status

**Recommendation**:
- Add JSON parse error detection
- Display warning: "Session metadata corrupted (cannot read details)"
- Include troubleshooting: "Run: bdg cleanup"

---

### 6. Worker Survival After Chrome Death ⚠️ MEDIUM
**Test**: 3.3 - Chrome killed but worker remains  
**Result**: Worker did not exit when Chrome died  
**Impact**: Zombie worker processes

**Recommendation**:
- Add CDP connection monitoring
- Exit worker when WebSocket closes unexpectedly
- Log: "Chrome connection lost, exiting"

---

### 7. Invalid URL Handling ⚠️ LOW
**Test**: 6.1 - Invalid URL  
**Result**: Unclear error handling  
**Impact**: Poor UX

**Recommendation**:
- Add URL validation before launching Chrome
- Error: "Invalid URL format: 'not-a-url'"
- Suggestion: "URLs must include protocol (http:// or https://)"

---

### 8. Large lastN Timeout ⚠️ LOW
**Test**: 6.2 - Peek with lastN=999999  
**Result**: Timeout  
**Impact**: Denial of service risk

**Recommendation**:
- Cap lastN at reasonable maximum (e.g., 1000)
- Return error: "lastN must be between 1 and 1000"

---

### 9. IPC Timeout Behavior ⚠️ LOW
**Test**: 4.4 - Worker suspended (SIGSTOP)  
**Result**: Timeout behavior unclear (completed in 0s)  
**Impact**: Unclear failure mode

**Recommendation**:
- Verify timeout actually triggers after 5s
- Add explicit timeout error message
- Log: "Worker response timeout (5s)"

---

### 10. Signal Handling - No Output Files ⚠️ LOW
**Tests**: 7.1, 7.2 - SIGTERM and SIGINT  
**Result**: No session.json written  
**Impact**: Data loss on graceful shutdown

**Recommendation**:
- Verify signal handlers write final output
- Test with actual Ctrl+C (not kill command)
- May be test artifact (worker exits too fast)

---

## Passed Tests ✅

1. ✅ New session starts after previous stops (race timing)
2. ✅ 5 concurrent peeks succeed
3. ✅ Client detects socket deletion
4. ✅ Dead worker process detected
5. ✅ Daemon survives malformed JSON
6. ✅ Large peek (1000 items) completes fast (106ms)
7. ✅ No file descriptor leaks
8. ✅ Memory stable (no leaks)
9. ✅ Cleanup removes stale files after crash
10. ✅ Negative lastN rejected
11. ✅ Long request IDs handled
12. ✅ Special characters in IDs handled

---

## Priority Fix List

### P0 - Critical (Blocks Production)
1. **Concurrent session/daemon startup race condition**
   - Implement atomic daemon lock
   - Ensure only one daemon per machine
   - Time: 2-3 hours

2. **Stale daemon PID detection**
   - Add process alive check
   - Auto-cleanup dead PIDs
   - Time: 1 hour

3. **Rapid connection failures**
   - Investigate daemon connection handling
   - Fix blocking behavior
   - Time: 2-4 hours (needs debugging)

### P1 - High (Should Fix Before Release)
4. Worker doesn't exit when Chrome dies (2 hours)
5. Corrupted metadata handling (1 hour)
6. Invalid URL validation (30 min)
7. Large lastN cap (30 min)

### P2 - Medium (Nice to Have)
8. IPC timeout behavior verification (1 hour)
9. Signal handling output file creation (1 hour)

---

## Next Actions

1. **Immediate**: Fix concurrent daemon startup (P0 #1)
2. **High**: Fix stale PID detection (P0 #2)
3. **Debug**: Investigate rapid connection failures (P0 #3)
4. **After P0**: Address P1 issues
5. **Re-test**: Run edge case suite again after fixes

---

## Estimated Time to Fix All P0 Issues

**Total**: 5-8 hours of focused work

- Daemon lock: 2-3 hours
- Stale PID: 1 hour
- Rapid connections: 2-4 hours (investigation + fix)

---

## Test Environment

- **OS**: macOS
- **Shell**: zsh 5.9
- **Node**: (version not captured)
- **Chrome**: Auto-launched version
- **Test Server**: http://localhost:8989

---

## Appendix: Full Test Log

See: `/tmp/edge-case-results.log`

Key findings logged at:
- Concurrent starts: `/tmp/session1.log`, `/tmp/session2.log`
- Rapid peeks: `/tmp/peek_1.log` through `/tmp/peek_5.log`
