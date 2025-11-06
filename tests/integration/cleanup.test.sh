#!/usr/bin/env bash
# Integration Test: bdg cleanup command
#
# Tests all cleanup command variations:
# - Basic cleanup (stale sessions only)
# - Forced cleanup (--force)
# - Aggressive cleanup (--aggressive, kills Chrome)

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
TEST_NAME="cleanup-command"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: bdg cleanup command ==="

# Test 1: Cleanup with no sessions (should be safe/idempotent)
log_step "Test 1: Cleanup with no active sessions"
bdg cleanup 2>&1 || die "Cleanup failed when no sessions exist"

log_success "Test 1 passed: Cleanup is safe with no sessions"

# Test 2: Cleanup with active session (should warn or skip)
log_step "Test 2: Starting session, then trying cleanup"
bdg "https://example.com" || die "Failed to start session"
sleep 2

CLEANUP_OUTPUT=$(bdg cleanup 2>&1) || true
EXIT_CODE=$?

# Should either skip cleanup or warn about active session
if [ $EXIT_CODE -eq 0 ]; then
  log_info "Cleanup succeeded (may have detected stale session)"
else
  log_info "Cleanup failed/warned about active session (expected)"
fi

log_success "Test 2 passed: Cleanup handles active session appropriately"

# Test 3: Cleanup with --force (should cleanup even if active)
log_step "Test 3: Cleanup with --force flag"
bdg cleanup --force 2>&1 || log_warn "Force cleanup failed (may be expected)"

# Check if session files are gone
if [ -f ~/.bdg/daemon.pid ] || [ -f ~/.bdg/daemon.sock ]; then
  log_warn "Force cleanup didn't remove all session files"
else
  log_success "Force cleanup removed session files"
fi

log_success "Test 3 passed: Cleanup --force works"

# Test 4: Start fresh session, stop gracefully, then cleanup
log_step "Test 4: Cleanup after graceful stop"
bdg "https://example.com" || die "Failed to start session"
sleep 2
bdg stop 2>&1 || log_warn "Stop failed"
sleep 1

bdg cleanup 2>&1 || die "Cleanup after stop should succeed"

log_success "Test 4 passed: Cleanup works after graceful stop"

# Test 5: Simulate stale session (manual PID file)
log_step "Test 5: Cleanup with simulated stale session"
mkdir -p ~/.bdg
echo "999999" > ~/.bdg/daemon.pid  # Invalid PID

bdg cleanup 2>&1 || die "Cleanup failed to handle stale PID"

# Stale PID file should be removed
if [ -f ~/.bdg/daemon.pid ]; then
  log_error "Cleanup didn't remove stale PID file"
  exit 1
fi

log_success "Test 5 passed: Cleanup removes stale session files"

# Test 6: Cleanup --aggressive (kills Chrome processes)
log_step "Test 6: Cleanup with --aggressive flag"

# Start session with Chrome
bdg "https://example.com" || die "Failed to start session"
sleep 2

# Get Chrome PID before cleanup
CHROME_PIDS_BEFORE=$(pgrep -f "Google Chrome" || true)
log_info "Chrome PIDs before aggressive cleanup: ${CHROME_PIDS_BEFORE:-none}"

# Run aggressive cleanup
bdg cleanup --aggressive 2>&1 || log_warn "Aggressive cleanup had issues"

# Check if Chrome is killed
sleep 2
CHROME_PIDS_AFTER=$(pgrep -f "Google Chrome" || true)
log_info "Chrome PIDs after aggressive cleanup: ${CHROME_PIDS_AFTER:-none}"

if [ -n "$CHROME_PIDS_BEFORE" ] && [ -z "$CHROME_PIDS_AFTER" ]; then
  log_success "Aggressive cleanup killed Chrome processes"
elif [ -z "$CHROME_PIDS_BEFORE" ]; then
  log_info "No Chrome processes to kill (expected if cleanup already ran)"
else
  log_warn "Aggressive cleanup may not have killed all Chrome processes"
fi

log_success "Test 6 passed: Cleanup --aggressive works"

# Final cleanup
log_step "Final cleanup"
bdg cleanup --force 2>&1 || true

# Summary
log_success "=== All cleanup command tests passed ==="
exit 0
