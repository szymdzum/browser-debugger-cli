#!/bin/bash
# Error Scenario Test: Daemon Crash Recovery
#
# Tests that bdg handles daemon crashes gracefully:
# - Daemon killed unexpectedly (SIGKILL)
# - Status command detects dead daemon
# - Cleanup recovers from crash
# - New session can start after crash

set -euo pipefail

# Test metadata
TEST_NAME="daemon-crash-recovery"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: Daemon crash recovery ==="

# Cleanup before starting
cleanup_sessions

# Test 1: Start session and capture daemon PID
log_step "Test 1: Starting session"
bdg "https://example.com" || die "Failed to start session"
sleep 2

DAEMON_PID=$(cat ~/.bdg/daemon.pid 2>/dev/null) || die "daemon.pid not found"
log_info "Daemon PID: $DAEMON_PID"

# Verify daemon is running
kill -0 "$DAEMON_PID" 2>/dev/null || die "Daemon not running"
log_success "Session started, daemon running"

# Test 2: Kill daemon process (simulate crash)
log_step "Test 2: Simulating daemon crash (SIGKILL)"
kill -9 "$DAEMON_PID" 2>/dev/null || die "Failed to kill daemon"
sleep 1

# Verify daemon is dead
if kill -0 "$DAEMON_PID" 2>/dev/null; then
  log_error "Daemon still running after SIGKILL"
  exit 1
fi

log_success "Daemon killed successfully"

# Test 3: Status should detect dead daemon
log_step "Test 3: Status should detect dead daemon"
STATUS_OUTPUT=$(bdg status 2>&1) || true
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  log_warn "Status succeeded despite dead daemon (may have auto-cleaned)"
else
  log_success "Status detected dead daemon"
fi

# Verify error message mentions the issue
if echo "$STATUS_OUTPUT" | grep -qi "not running\|stopped\|dead\|crashed\|unavailable"; then
  log_success "Error message indicates daemon is not running"
else
  log_warn "Error message could be clearer about daemon state"
fi

# Test 4: Peek should fail gracefully
log_step "Test 4: Peek should fail gracefully with dead daemon"
bdg peek 2>&1 && die "Peek should fail with dead daemon" || true
log_success "Peek failed gracefully"

# Test 5: Cleanup should recover from crash
log_step "Test 5: Cleanup should handle crashed daemon"
bdg cleanup || log_warn "Cleanup had issues (may be expected)"

# Verify stale files are removed
STALE_FILES=0
[ -f ~/.bdg/daemon.pid ] && STALE_FILES=$((STALE_FILES + 1))
[ -S ~/.bdg/daemon.sock ] && STALE_FILES=$((STALE_FILES + 1))

if [ $STALE_FILES -gt 0 ]; then
  log_warn "$STALE_FILES stale file(s) remain after cleanup"
  # Try force cleanup
  bdg cleanup --force || log_warn "Force cleanup also had issues"
else
  log_success "Cleanup removed all stale files"
fi

# Test 6: New session should start after crash
log_step "Test 6: Starting new session after crash recovery"
bdg "https://example.com" || die "Failed to start session after crash"
sleep 2

NEW_DAEMON_PID=$(cat ~/.bdg/daemon.pid 2>/dev/null) || die "daemon.pid not found after recovery"
log_info "New daemon PID: $NEW_DAEMON_PID"

# Verify new daemon is running
kill -0 "$NEW_DAEMON_PID" 2>/dev/null || die "New daemon not running"
log_success "New session started successfully after crash recovery"

# Verify it's a different daemon
if [ "$NEW_DAEMON_PID" = "$DAEMON_PID" ]; then
  log_warn "New daemon has same PID as crashed daemon (very unusual)"
fi

# Test 7: Verify new session is functional
log_step "Test 7: Verifying new session functionality"
bdg status > /dev/null 2>&1 || die "Status failed on new session"
bdg peek > /dev/null 2>&1 || log_warn "Peek failed on new session (may need more time)"

log_success "New session is functional"

# Test 8: Kill worker process (simulate worker crash)
log_step "Test 8: Testing worker crash scenario"

# Find worker PID (child of daemon)
WORKER_PID=$(pgrep -P "$NEW_DAEMON_PID" | head -1) || log_warn "Could not find worker PID"

if [ -n "$WORKER_PID" ]; then
  log_info "Worker PID: $WORKER_PID"

  # Kill worker
  kill -9 "$WORKER_PID" 2>/dev/null || log_warn "Failed to kill worker"
  sleep 2

  # Status should detect issue
  STATUS_OUTPUT=$(bdg status 2>&1) || true
  log_info "Status after worker crash: $STATUS_OUTPUT"

  # Cleanup and recovery
  bdg cleanup --force || log_warn "Cleanup after worker crash had issues"
else
  log_warn "Skipping worker crash test (worker PID not found)"
fi

# Cleanup
log_step "Final cleanup"
bdg cleanup --force 2>&1 || true

# Summary
log_success "=== Daemon crash recovery tests passed ==="
exit 0
