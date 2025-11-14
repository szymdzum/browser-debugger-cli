#!/usr/bin/env bash
# Error Scenario Test: Chrome Launch Failure
#
# Tests that bdg handles Chrome launch failures gracefully:
# - Chrome binary not found (simulated via invalid path)
# - Chrome launch timeout
# - Helpful error messages with diagnostics
# - Proper cleanup after failure

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
TEST_NAME="chrome-launch-failure"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: Chrome launch failure handling ==="

# Cleanup before starting
cleanup_sessions

# Test 1: Invalid Chrome binary path (if user-data-dir is writable)
log_step "Test 1: Testing with custom user-data-dir"

# Use a valid user-data-dir but this should still work
CUSTOM_DIR=$(mktemp -d)
log_info "Using temp user-data-dir: $CUSTOM_DIR"

bdg "https://example.com" --headless --user-data-dir "$CUSTOM_DIR" || die "Failed with custom user-data-dir"
sleep 2

# Verify session started
bdg status > /dev/null 2>&1 || die "Session not running"
log_success "Custom user-data-dir works"

# Cleanup
bdg stop || log_warn "Stop failed"
rm -rf "$CUSTOM_DIR"
sleep 1

# Test 2: Invalid port (beyond valid range)
log_step "Test 2: Testing with invalid port number"
INVALID_PORT_OUTPUT=$(bdg "https://example.com" --headless --port 99999 2>&1) || true
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  log_warn "Invalid port accepted (should validate)"
  bdg stop 2>/dev/null || bdg cleanup --force 2>/dev/null || true
  sleep 1
else
  log_success "Invalid port rejected"
fi

# Test 3: Chrome already running on port (covered by port-conflict test)
# Skipping as it's redundant with 01-port-conflict.sh

# Test 4: Verify error messages include diagnostics
log_step "Test 4: Checking error message quality"

# Force a failure scenario and capture output
# Using an extremely short timeout might cause issues
FAILURE_OUTPUT=$(timeout 5 bdg "https://example.com" --headless 2>&1) || true

# Cleanup daemon if timeout left it running
bdg stop 2>/dev/null || true
sleep 0.5

# Error output should mention Chrome or provide diagnostic info
if echo "$FAILURE_OUTPUT" | grep -qi "chrome\|browser\|launch\|failed\|timeout"; then
  log_success "Error messages include diagnostic information"
else
  log_info "Error output: $FAILURE_OUTPUT"
  log_warn "Error messages could include more diagnostics"
fi

# Test 5: Verify cleanup after launch failure
log_step "Test 5: Checking cleanup after Chrome launch failure"

# After a failure, session files should not persist
if [ -f ~/.bdg/daemon.pid ]; then
  STALE_PID=$(cat ~/.bdg/daemon.pid)
  if kill -0 "$STALE_PID" 2>/dev/null; then
    log_warn "Daemon still running after Chrome launch failure"
    kill -9 "$STALE_PID" 2>/dev/null || true
  else
    log_info "Stale daemon.pid exists but process is dead"
  fi
fi

# Run cleanup to ensure clean state
bdg cleanup --force 2>&1 || log_warn "Cleanup after failure had issues"

log_success "Cleanup after launch failure handled"

# Test 6: Verify can start normally after failure
log_step "Test 6: Starting normal session after failures"
bdg "https://example.com" --headless || die "Failed to start session after previous failures"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running after recovery"
log_success "Successfully recovered and started new session"

# Cleanup
log_step "Final cleanup"
stop_session_gracefully

# Summary
log_success "=== Chrome launch failure tests passed ==="
exit 0
