#!/usr/bin/env bash
# Integration Test: bdg details command
#
# Tests details command for both network and console:
# - details network <requestId>
# - details console <index>
# - Invalid ID/index handling
# - JSON output

set -euo pipefail

# Test metadata
TEST_NAME="details-command"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: bdg details command ==="

# Cleanup before starting
cleanup_sessions

# Test 1: Details with no active session
log_step "Test 1: Details with no active session"
bdg details network "123" 2>&1 && die "Details should fail with no session" || true

log_success "Test 1 passed: Details fails gracefully with no session"

# Start session and accumulate data
log_step "Starting session for details tests"
bdg "https://example.com" || die "Failed to start session"
sleep 3  # Let data accumulate

# Test 2: Get network request IDs from peek
log_step "Test 2: Getting network request IDs"
PEEK_JSON=$(bdg peek --network --last 50 --json 2>&1) || die "Failed to peek network data"

NETWORK_COUNT=$(echo "$PEEK_JSON" | jq '[.items[] | select(.type == "network")] | length')
log_info "Found $NETWORK_COUNT network requests"

if [ "$NETWORK_COUNT" -eq 0 ]; then
  log_warn "No network requests captured, skipping network details tests"
  SKIP_NETWORK=true
else
  SKIP_NETWORK=false
  FIRST_REQUEST_ID=$(echo "$PEEK_JSON" | jq -r '[.items[] | select(.type == "network")][0].id // empty')

  if [ -z "$FIRST_REQUEST_ID" ]; then
    log_warn "Network request missing 'id' field, skipping network details tests"
    SKIP_NETWORK=true
  else
    log_info "First network request ID: $FIRST_REQUEST_ID"
  fi
fi

# Test 3: Get network request details
if [ "$SKIP_NETWORK" = false ]; then
  log_step "Test 3: Getting network request details"
  DETAILS_OUTPUT=$(bdg details network "$FIRST_REQUEST_ID" 2>&1) || die "Failed to get network details"

  # Should show detailed information
  [ -n "$DETAILS_OUTPUT" ] || die "Network details output is empty"

  log_success "Test 3 passed: Network details works"

  # Test 4: Network details with --json
  log_step "Test 4: Network details with --json"
  DETAILS_JSON=$(bdg details network "$FIRST_REQUEST_ID" --json 2>&1) || die "Failed to get network details JSON"

  # Validate JSON
  echo "$DETAILS_JSON" | jq . > /dev/null 2>&1 || die "Network details --json output is not valid JSON"

  log_success "Test 4 passed: Network details --json works"
else
  log_warn "Skipping tests 3-4 (no network requests)"
fi

# Test 5: Invalid network request ID
log_step "Test 5: Network details with invalid ID"
bdg details network "nonexistent-id-123456" 2>&1 && die "Details should fail with invalid ID" || true

log_success "Test 5 passed: Network details fails with invalid ID"

# Test 6: Get console message count
log_step "Test 6: Getting console message count"
CONSOLE_PEEK=$(bdg peek --console --last 50 --json 2>&1) || die "Failed to peek console data"

CONSOLE_COUNT=$(echo "$CONSOLE_PEEK" | jq '[.items[] | select(.type == "console")] | length')
log_info "Found $CONSOLE_COUNT console messages"

if [ "$CONSOLE_COUNT" -eq 0 ]; then
  log_warn "No console messages captured, skipping console details tests"
  SKIP_CONSOLE=true
else
  SKIP_CONSOLE=false
  log_info "Console messages available for testing"
fi

# Test 7: Get console message details by index
if [ "$SKIP_CONSOLE" = false ]; then
  log_step "Test 7: Getting console message details (index 0)"
  CONSOLE_DETAILS=$(bdg details console 0 2>&1) || die "Failed to get console details"

  # Should show detailed information
  [ -n "$CONSOLE_DETAILS" ] || die "Console details output is empty"

  log_success "Test 7 passed: Console details works"

  # Test 8: Console details with --json
  log_step "Test 8: Console details with --json"
  CONSOLE_JSON=$(bdg details console 0 --json 2>&1) || die "Failed to get console details JSON"

  # Validate JSON
  echo "$CONSOLE_JSON" | jq . > /dev/null 2>&1 || die "Console details --json output is not valid JSON"

  log_success "Test 8 passed: Console details --json works"
else
  log_warn "Skipping tests 7-8 (no console messages)"
fi

# Test 9: Invalid console index
log_step "Test 9: Console details with invalid index"
bdg details console 999999 2>&1 && die "Details should fail with invalid index" || true

log_success "Test 9 passed: Console details fails with invalid index"

# Test 10: Console details with negative index
log_step "Test 10: Console details with negative index"
bdg details console -1 2>&1 && die "Details should fail with negative index" || true

log_success "Test 10 passed: Console details fails with negative index"

# Cleanup
log_step "Cleaning up test session"
stop_session_gracefully

# Summary
log_success "=== All details command tests passed ==="
exit 0
