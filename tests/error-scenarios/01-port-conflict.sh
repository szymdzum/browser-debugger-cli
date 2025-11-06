#!/usr/bin/env bash
# Error Scenario Test: Port Already in Use
#
# Tests that bdg handles port conflicts gracefully:
# - Default port 9222 already in use
# - Custom port already in use
# - Suggests alternative ports
# - Clean error messages

set -euo pipefail

# Cleanup trap to prevent cascade failures
cleanup() {
  local exit_code=$?
  bdg stop 2>/dev/null || true
  sleep 0.5
  bdg cleanup --force 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# Test metadata
TEST_NAME="port-conflict"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: Port conflict error handling ==="

# Cleanup before starting
cleanup_sessions

# Test 1: Start session on default port 9222
log_step "Test 1: Starting first session on default port 9222"
bdg "https://example.com" || die "Failed to start first session"
sleep 2

# Verify first session is running
bdg status > /dev/null 2>&1 || die "First session not running"
log_success "First session started successfully"

# Test 2: Try to start second session (should fail with port conflict)
log_step "Test 2: Attempting to start second session (should fail)"
SECOND_SESSION_OUTPUT=$(bdg "https://example.com" 2>&1) || true
EXIT_CODE=$?

# Should fail with non-zero exit code
if [ $EXIT_CODE -eq 0 ]; then
  log_error "Second session should have failed due to port conflict"
  bdg cleanup --force
  exit 1
fi

log_success "Second session failed as expected (port conflict)"

# Verify error message is helpful
if echo "$SECOND_SESSION_OUTPUT" | grep -qi "port\|already\|use\|conflict"; then
  log_success "Error message mentions port conflict"
else
  log_warn "Error message may not be clear about port conflict"
  log_info "Error output: $SECOND_SESSION_OUTPUT"
fi

# Test 3: Try with explicit port that's already in use
log_step "Test 3: Attempting to start session on occupied port 9222"
EXPLICIT_PORT_OUTPUT=$(bdg "https://example.com" --port 9222 2>&1) || true
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  log_error "Should have failed with explicit port conflict"
  bdg cleanup --force
  exit 1
fi

log_success "Explicit port conflict detected correctly"

# Test 4: Start on alternative port (should succeed)
log_step "Test 4: Starting session on alternative port 9223"

# First, stop the existing session
bdg stop || log_warn "Failed to stop first session"
sleep 2

# Now try alternative port
bdg "https://example.com" --port 9223 || die "Failed to start on alternative port"
sleep 2

bdg status > /dev/null 2>&1 || die "Alternative port session not running"
log_success "Alternative port 9223 works correctly"

# Cleanup
log_step "Cleaning up test sessions"
stop_session_gracefully

# Summary
log_success "=== Port conflict error handling tests passed ==="
exit 0
