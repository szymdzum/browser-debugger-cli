# Shell Test Hardening

Guide to making shell tests reliable and non-brittle.

## The Problem: Test Brittleness

Shell tests were failing ~15% of the time in CI due to:

1. **Fixed sleep timers** - `sleep 0.5` doesn't verify cleanup is complete
2. **No resource verification** - Assumed ports/files were cleaned up
3. **Cascade failures** - One test's mess breaks the next test
4. **Race conditions** - 2-second delays insufficient between tests
5. **Environment variability** - CI machines are slower than local

## The Solution: Polling-Based Cleanup

### Before (Brittle)

```bash
cleanup() {
  bdg stop 2>/dev/null || true
  sleep 0.5
  lsof -ti:9222 | xargs kill -9 2>/dev/null || true
  sleep 0.5
  bdg cleanup --force 2>/dev/null || true
}
trap cleanup EXIT
```

**Problems:**
- Fixed 0.5s delays may be too short
- No verification that cleanup succeeded
- Silent failures in CI

### After (Robust)

```bash
source "$TESTS_LIB_DIR/cleanup.sh"
trap 'cleanup_with_polling 9222' EXIT INT TERM
```

**Benefits:**
- Polls until port is released (up to 10s)
- Verifies PID file removed
- Verifies socket file removed
- Force cleanup if polling times out
- Works in any environment

## Implementation

### 1. Polling-Based Cleanup

The `tests/lib/cleanup.sh` utility:

```bash
cleanup_with_polling() {
  local port="${1:-9222}"
  local max_wait=10
  local poll_interval=0.5
  
  # Stop daemon
  bdg stop 2>/dev/null || true
  sleep 1
  
  # Poll for port release
  local elapsed=0
  while lsof -ti:$port >/dev/null 2>&1; do
    if (( $(echo "$elapsed >= $max_wait" | bc -l) )); then
      lsof -ti:$port | xargs kill -9 2>/dev/null || true
      break
    fi
    sleep "$poll_interval"
    elapsed=$(echo "$elapsed + $poll_interval" | bc -l)
  done
  
  # Poll for PID file removal
  # Poll for socket file removal
  # Force cleanup if needed
}
```

### 2. Test Timeouts

Prevent infinite hangs:

```bash
# Add at start of test
(sleep 300; kill -TERM $$) 2>/dev/null &
TIMEOUT_PID=$!

# Kill at end of test
kill $TIMEOUT_PID 2>/dev/null || true
```

### 3. Dynamic Port Allocation

Avoid port conflicts:

```bash
# Before: Hard-coded port
bdg localhost:3000 --port 9223

# After: Random port
allocatedPort=$((9222 + $RANDOM % 100))
bdg localhost:3000 --port $allocatedPort
```

### 4. Enhanced Daemon Readiness

Don't just check PID, verify socket is connectable:

```typescript
// Before
if (isDaemonRunning()) { /* assume ready */ }

// After
const isReady = await waitForDaemon(10000, verifyHandshake = true);
```

Checks:
1. PID exists and process is alive
2. Socket file exists
3. Socket is connectable (via `net.createConnection`)
4. Optionally: IPC handshake succeeds

## Hardening Checklist

For each shell test:

- [ ] Use `cleanup_with_polling` in trap
- [ ] Add test-level timeout (5-10 minutes)
- [ ] Use dynamic port allocation (if applicable)
- [ ] Replace all `bdg stop; sleep 1` with `cleanup_with_polling`
- [ ] Verify no hard-coded ports (9223-9231 bad)
- [ ] Test passes individually
- [ ] Test passes in batch (`./tests/run-all-tests.sh`)

## Test Results

### Before Hardening
- **Pass Rate:** 89% (17/19)
- **Failures:** 1 (04-concurrent-session-prevention)
- **Hangs:** 1 (url-handling.test)

### After Hardening
- **Pass Rate:** 100% (19/19)
- **Failures:** 0
- **Hangs:** 0

## Hardened Tests

✅ `tests/error-scenarios/04-concurrent-session-prevention.sh`
- Replaced manual cleanup with `cleanup_with_polling`
- Now passes in batch runs

✅ `tests/edge-cases/url-handling.test.sh`
- Replaced all 10 `bdg stop; sleep 1` with `cleanup_with_polling`
- Added 5-minute test timeout
- Now completes without hanging

## Remaining Tests

The other 17 shell tests still use old cleanup patterns but currently pass. They would benefit from hardening to prevent future brittleness:

**Agent Benchmarks (4):**
- `tests/agent-benchmark/scenarios/00-golden-cdp-workflow.sh`
- `tests/agent-benchmark/scenarios/00-hn-top-stories.sh`
- `tests/agent-benchmark/scenarios/01-github-trending.sh`
- `tests/agent-benchmark/scenarios/02-wikipedia-summary.sh`

**Integration (8):**
- `tests/integration/cdp.test.sh`
- `tests/integration/console.test.sh`
- `tests/integration/details.test.sh`
- `tests/integration/dom.test.sh`
- `tests/integration/network.test.sh`
- `tests/integration/peek.test.sh`
- `tests/integration/status.test.sh`
- `tests/integration/tail.test.sh`

**Error Scenarios (5):**
- `tests/error-scenarios/01-port-conflict.sh`
- `tests/error-scenarios/02-invalid-url.sh`
- `tests/error-scenarios/03-stale-session-recovery.sh`
- `tests/error-scenarios/05-daemon-crash-recovery.sh`
- `tests/error-scenarios/06-chrome-launch-failure.sh`

## Future Improvements (Optional)

1. **Retry Wrappers** - Automatically retry flaky operations
2. **Graceful Shutdown** - SIGTERM before SIGKILL
3. **Resource Locks** - Atomic port reservation per test
4. **Parallel Execution** - Run tests concurrently with isolated resources

## Related Documentation

- [TEST_GUIDE.md](./TEST_GUIDE.md) - Complete testing guide
- [tests/README.md](../../tests/README.md) - Shell test details
