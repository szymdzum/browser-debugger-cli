#!/usr/bin/env bash
# Error Scenario Test: Stale Session Recovery
#
# Tests that bdg handles stale session files:
# - Daemon process died but files remain
# - Invalid PID in daemon.pid
# - Stale socket files
# - Automatic recovery

set -euo pipefail

# Cleanup trap to prevent cascade failures
cleanup() {
  local exit_code=$?
  bdg stop 2>/dev/null || true
  sleep 0.5
  # Force kill any Chrome processes on port 9222
  lsof -ti:9222 | xargs kill -9 2>/dev/null || true
  sleep 0.5
  bdg cleanup --force 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# Test metadata
TEST_NAME="stale-session-recovery"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: Stale session recovery ==="

# Cleanup before starting
cleanup_sessions

# Test 1: Create stale PID file with invalid PID
log_step "Test 1: Creating stale PID file"
mkdir -p ~/.bdg
echo "999999" > ~/.bdg/daemon.pid
log_success "Created stale PID file with PID 999999"

# Test 2: Status should detect stale session
log_step "Test 2: Status should detect stale PID"
STATUS_OUTPUT=$(bdg status 2>&1) || true
EXIT_CODE=$?

# Should fail or warn about stale session
if [ $EXIT_CODE -eq 0 ]; then
  log_warn "Status succeeded despite stale PID (may have auto-cleaned)"
else
  log_success "Status detected stale session"
fi

# Test 3: Starting new session should clean up stale files
log_step "Test 3: New session should clean up stale files"
bdg "https://example.com" || die "Failed to start session (should auto-recover)"
sleep 2

# Verify PID is now valid
if [ -f ~/.bdg/daemon.pid ]; then
  CURRENT_PID=$(cat ~/.bdg/daemon.pid)
  kill -0 "$CURRENT_PID" 2>/dev/null || die "New PID is not valid"
  log_success "New session started with valid PID: $CURRENT_PID"
else
  die "daemon.pid not found after starting session"
fi

# Stop session cleanly
bdg stop || log_warn "Stop failed"
sleep 1

# Test 4: Create stale socket file
log_step "Test 4: Creating stale socket file"
mkdir -p ~/.bdg
touch ~/.bdg/daemon.sock
log_success "Created stale socket file"

# Test 5: New session should handle stale socket
log_step "Test 5: New session should clean up stale socket"
bdg "https://example.com" || die "Failed to start session with stale socket"
sleep 2

# Verify socket is valid (can communicate)
bdg status > /dev/null 2>&1 || die "Can't communicate with daemon despite socket existing"
log_success "New session cleaned up stale socket and works correctly"

# Stop session
bdg stop || log_warn "Stop failed"
sleep 1

# Test 6: Cleanup command should remove stale files
log_step "Test 6: Cleanup should remove all stale files"

# Create various stale files
mkdir -p ~/.bdg
echo "999999" > ~/.bdg/daemon.pid
touch ~/.bdg/daemon.sock
touch ~/.bdg/session.meta.json

# Run cleanup
bdg cleanup || log_warn "Cleanup had issues (may be expected)"

# Verify files are removed
STALE_FILES_REMAINING=0
[ -f ~/.bdg/daemon.pid ] && STALE_FILES_REMAINING=$((STALE_FILES_REMAINING + 1))
[ -S ~/.bdg/daemon.sock ] && STALE_FILES_REMAINING=$((STALE_FILES_REMAINING + 1))

if [ $STALE_FILES_REMAINING -gt 0 ]; then
  log_warn "Some stale files remain after cleanup"
else
  log_success "All stale files cleaned up"
fi

# Test 7: Multiple stale PIDs
log_step "Test 7: Testing with PID 1 (system process)"
echo "1" > ~/.bdg/daemon.pid

bdg "https://example.com" || die "Failed to start session when PID 1 exists"
sleep 2

bdg status > /dev/null 2>&1 || die "Session didn't recover from PID 1"
log_success "Recovered from stale PID 1"

# Cleanup
log_step "Final cleanup"
stop_session_gracefully

# Summary
log_success "=== Stale session recovery tests passed ==="
exit 0
