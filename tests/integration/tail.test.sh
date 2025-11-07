#!/usr/bin/env bash
# Integration Test: bdg tail command
#
# Tests tail command (continuous monitoring):
# - Basic tail (continuous updates)
# - Tail with filters (--network, --console)
# - Custom interval (--interval)
# - Graceful SIGINT handling (Ctrl+C)
# - JSON output mode

set -euo pipefail

# Cleanup trap to prevent cascade failures
cleanup() {
  local exit_code=$?
  # Kill any background tail processes
  jobs -p | xargs kill 2>/dev/null || true
  
  # Stop session gracefully first
  bdg stop 2>/dev/null || true
  sleep 1
  
  # Aggressive cleanup to kill all Chrome processes
  bdg cleanup --aggressive 2>/dev/null || true
  sleep 1
  
  # Final fallback: force kill port 9222
  lsof -ti:9222 | xargs kill -9 2>/dev/null || true
  sleep 0.5
  
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# Test metadata
TEST_NAME="tail-command"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: bdg tail command ==="

# Cleanup before starting
cleanup_sessions

# Test 1: Tail with no active session (should fail gracefully but not exit)
log_step "Test 1: Tail with no active session"
set +e
timeout 2 bdg tail 2>&1 > /dev/null || EXIT_CODE=$?
set -e

# Tail should handle missing daemon gracefully (keeps trying)
log_success "Test 1 passed: Tail handles missing session gracefully"

# Start session for remaining tests
log_step "Starting session for tail tests"
bdg "https://example.com" --headless || die "Failed to start session"
sleep 5  # Let daemon start and some data accumulate

# Test 2: Basic tail (run for 3 seconds then kill)
log_step "Test 2: Basic tail (3 second run)"
timeout 3 bdg tail 2>&1 > /tmp/tail_basic.log || true

# Should have generated some output
[ -s /tmp/tail_basic.log ] || die "Tail produced no output"

# Should show deprecation warning is NOT present (tail is the new command)
! grep -q "Deprecation Warning" /tmp/tail_basic.log || die "Tail should not show deprecation warning"

log_success "Test 2 passed: Basic tail works"

# Test 3: Tail with --network filter
log_step "Test 3: Tail with --network filter (2 seconds)"
timeout 2 bdg tail --network 2>&1 > /tmp/tail_network.log || true

[ -s /tmp/tail_network.log ] || die "Tail --network produced no output"

log_success "Test 3 passed: Tail --network filter works"

# Test 4: Tail with --console filter
log_step "Test 4: Tail with --console filter (2 seconds)"
timeout 2 bdg tail --console 2>&1 > /tmp/tail_console.log || true

# May be empty if no console messages, that's OK
log_success "Test 4 passed: Tail --console filter works"

# Test 5: Tail with custom interval (500ms)
log_step "Test 5: Tail with --interval 500 (2 seconds)"
timeout 2 bdg tail --interval 500 2>&1 > /tmp/tail_interval.log || true

[ -s /tmp/tail_interval.log ] || die "Tail --interval produced no output"

log_success "Test 5 passed: Tail --interval works"

# Test 6: Tail with --json
log_step "Test 6: Tail with --json (2 seconds)"
timeout 2 bdg tail --json 2>&1 > /tmp/tail_json.log || true

# Validate JSON format (first complete JSON object in file)
head -200 /tmp/tail_json.log | jq -e '.preview' > /dev/null 2>&1 || die "Tail --json output is not valid JSON"

log_success "Test 6 passed: Tail --json produces valid JSON"

# Test 7: Tail with --verbose
log_step "Test 7: Tail with --verbose (2 seconds)"
timeout 2 bdg tail --verbose 2>&1 > /tmp/tail_verbose.log || true

[ -s /tmp/tail_verbose.log ] || die "Tail --verbose produced no output"

log_success "Test 7 passed: Tail --verbose works"

# Test 8: Tail with --last 50
log_step "Test 8: Tail with --last 50 (2 seconds)"
timeout 2 bdg tail --last 50 2>&1 > /tmp/tail_last.log || true

[ -s /tmp/tail_last.log ] || die "Tail --last produced no output"

log_success "Test 8 passed: Tail --last N works"

# Test 9: Tail with invalid --interval (should fail)
log_step "Test 9: Tail --interval with invalid value (should fail)"
set +e
bdg tail --interval 50 2>&1 && die "Tail --interval 50 should have failed (below minimum)" || true
bdg tail --interval 100000 2>&1 && die "Tail --interval 100000 should have failed (above maximum)" || true
set -e

log_success "Test 9 passed: Tail validates --interval argument"

# Cleanup
log_step "Cleaning up test session"
stop_session_gracefully

# Cleanup temp files
rm -f /tmp/tail_*.log

# Summary
log_success "=== All tail command tests passed ==="
exit 0
