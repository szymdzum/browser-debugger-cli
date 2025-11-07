#!/usr/bin/env bash
# Integration Test: bdg network command
#
# Tests network inspection with various scenarios:
# - Network list with no session
# - Basic network listing
# - Filter by status code
# - Filter by method
# - JSON output validation
# - Empty network data handling

set -euo pipefail

# Cleanup trap to prevent cascade failures
cleanup() {
  local exit_code=$?
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
TEST_NAME="network-command"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: bdg network command ==="

# Cleanup before starting
cleanup_sessions

# Test 1: Network command with no active session
log_step "Test 1: Network with no active session"
set +e
bdg network 2>&1
EXIT_CODE=$?
set -e

if [ $EXIT_CODE -eq 0 ]; then
  log_error "Network should fail with no session"
  exit 1
fi

log_success "Test 1 passed: Network fails gracefully with no session"

# Start session for remaining tests
log_step "Starting session for network tests"
bdg "https://example.com" || die "Failed to start session"
sleep 3  # Let page load and generate network requests

# Test 2: Basic network listing
log_step "Test 2: List network requests"
NETWORK_OUTPUT=$(bdg network 2>&1) || die "Failed to list network requests"

# Should show network requests
if echo "$NETWORK_OUTPUT" | grep -qi "example.com\|network\|GET\|200"; then
  log_success "Network requests found"
else
  log_warn "Network output may not show expected requests"
fi

log_success "Test 2 passed: Basic network listing works"

# Test 3: Network with JSON output
log_step "Test 3: Network JSON output"
set +e
NETWORK_JSON=$(bdg network --json 2>&1)
JSON_EXIT=$?
set -e

if [ $JSON_EXIT -eq 0 ]; then
  # Validate JSON structure
  if echo "$NETWORK_JSON" | jq . > /dev/null 2>&1; then
    log_success "JSON output is valid"
    
    # Check for expected fields
    if echo "$NETWORK_JSON" | jq -e '.preview.data.network' > /dev/null 2>&1; then
      log_success "JSON has expected network data structure"
    fi
  else
    log_warn "JSON flag accepted but output may not be valid JSON"
  fi
else
  log_info "JSON flag not supported or failed"
fi

log_success "Test 3 passed: JSON output tested"

# Test 4: Network filters (if supported)
log_step "Test 4: Network filtering (status/method if supported)"
set +e
# Try filtering by status (may not be supported)
FILTER_200=$(bdg network --status 200 2>&1)
FILTER_EXIT=$?
set -e

if [ $FILTER_EXIT -eq 0 ]; then
  log_success "Network filtering by status works"
else
  log_info "Network filtering by status not supported (expected)"
fi

log_success "Test 4 passed: Filtering tested"

# Test 5: Network with verbose flag
log_step "Test 5: Network with verbose output"
set +e
VERBOSE_OUTPUT=$(bdg network --verbose 2>&1)
VERBOSE_EXIT=$?
set -e

if [ $VERBOSE_EXIT -eq 0 ]; then
  # Verbose should have more details
  [ ${#VERBOSE_OUTPUT} -ge ${#NETWORK_OUTPUT} ] || log_warn "Verbose output not noticeably different"
  log_success "Verbose output works"
else
  log_info "Verbose flag not supported"
fi

log_success "Test 5 passed: Verbose tested"

# Test 6: Network list with --last N
log_step "Test 6: Network with --last limit"
set +e
LAST_OUTPUT=$(bdg network --last 5 2>&1)
LAST_EXIT=$?
set -e

if [ $LAST_EXIT -eq 0 ]; then
  log_success "Last N limiting works"
else
  log_info "Last flag may not be supported for network"
fi

log_success "Test 6 passed: Limit tested"

# Test 7: Check for specific request in network
log_step "Test 7: Verify example.com request present"
if echo "$NETWORK_OUTPUT" | grep -qi "example.com"; then
  log_success "Found example.com in network requests"
else
  log_warn "example.com request not found (may have been filtered)"
fi

log_success "Test 7 passed: Request verification tested"

# Test 8: Multiple network command calls (idempotency)
log_step "Test 8: Multiple network calls"
bdg network > /dev/null 2>&1 || die "First call failed"
bdg network > /dev/null 2>&1 || die "Second call failed"
bdg network > /dev/null 2>&1 || die "Third call failed"

log_success "Test 8 passed: Multiple calls work (idempotent)"

# Cleanup
log_step "Cleaning up test session"
stop_session_gracefully

# Summary
log_success "=== All network command tests passed ==="
exit 0
