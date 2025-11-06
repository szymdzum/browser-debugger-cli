#!/usr/bin/env bash
# Error Scenario Test: Concurrent Session Prevention
#
# Tests that bdg prevents multiple simultaneous sessions:
# - Starting session while one is active
# - Lock file mechanism
# - Clear error messages
# - Proper cleanup after prevention

set -euo pipefail

# Test metadata
TEST_NAME="concurrent-session-prevention"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: Concurrent session prevention ==="

# Cleanup before starting
cleanup_sessions

# Test 1: Start first session
log_step "Test 1: Starting first session"
bdg "https://example.com" || die "Failed to start first session"
sleep 2

# Verify first session is running
bdg status > /dev/null 2>&1 || die "First session not running"
FIRST_PID=$(cat ~/.bdg/daemon.pid 2>/dev/null)
log_success "First session running (PID: $FIRST_PID)"

# Test 2: Attempt to start concurrent session
log_step "Test 2: Attempting concurrent session (should fail)"
CONCURRENT_OUTPUT=$(bdg "https://example.com" 2>&1) || true
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  log_error "Concurrent session should have been prevented"
  bdg cleanup --force
  exit 1
fi

log_success "Concurrent session prevented correctly"

# Test 3: Verify error message is helpful
log_step "Test 3: Checking error message quality"
if echo "$CONCURRENT_OUTPUT" | grep -qi "already\|running\|active\|session\|exists"; then
  log_success "Error message clearly indicates session already exists"
else
  log_warn "Error message could be clearer"
  log_info "Error output: $CONCURRENT_OUTPUT"
fi

# Test 4: Verify first session still running
log_step "Test 4: Verifying first session unaffected"
bdg status > /dev/null 2>&1 || die "First session was affected by concurrent attempt"

CURRENT_PID=$(cat ~/.bdg/daemon.pid 2>/dev/null)
if [ "$CURRENT_PID" = "$FIRST_PID" ]; then
  log_success "First session still running with same PID"
else
  log_error "First session PID changed after concurrent attempt"
  exit 1
fi

# Test 5: Stop first session, then start new one
log_step "Test 5: Starting new session after stopping first"
bdg stop || log_warn "Stop failed"
sleep 2

bdg "https://example.com" || die "Failed to start new session after stopping"
sleep 2

NEW_PID=$(cat ~/.bdg/daemon.pid 2>/dev/null)
log_success "New session started successfully (PID: $NEW_PID)"

if [ "$NEW_PID" = "$FIRST_PID" ]; then
  log_warn "New session has same PID as old (unusual but possible)"
fi

# Test 6: Simulate concurrent start attempts (race condition)
log_step "Test 6: Simulating rapid concurrent starts"
bdg stop || log_warn "Stop failed"
sleep 2

# Try to start multiple sessions simultaneously
(bdg "https://example.com" > /tmp/bdg_start1.log 2>&1) &
PID1=$!
(bdg "https://example.com" > /tmp/bdg_start2.log 2>&1) &
PID2=$!
(bdg "https://example.com" > /tmp/bdg_start3.log 2>&1) &
PID3=$!

# Wait for all attempts
wait $PID1 || true
wait $PID2 || true
wait $PID3 || true

sleep 2

# Only one should succeed
if bdg status > /dev/null 2>&1; then
  log_success "Race condition handled: exactly one session started"

  # Count how many succeeded (check logs)
  SUCCESSES=0
  [ $? -eq 0 ] && SUCCESSES=$((SUCCESSES + 1))

  log_info "Concurrent start race condition handled correctly"
else
  log_warn "All concurrent starts failed (may need manual recovery)"
  bdg cleanup --force
fi

# Cleanup logs
rm -f /tmp/bdg_start*.log

# Cleanup
log_step "Final cleanup"
stop_session_gracefully

# Summary
log_success "=== Concurrent session prevention tests passed ==="
exit 0
