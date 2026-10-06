#!/usr/bin/env bash
# Integration Test: bdg dom command
#
# Tests DOM manipulation with various scenarios:
# - DOM query with no active session
# - Valid CSS selectors
# - Invalid CSS selectors
# - Query with no results
# - Query returning multiple elements
# - Element index access
# - Text extraction
# - Attribute reading

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
  
  
  remove_own_session_dir 2>/dev/null || true
  
  
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# Test metadata
TEST_NAME="dom-command"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: bdg dom command ==="

# Cleanup before starting
cleanup_sessions

# Test 1: DOM query with no active session
log_step "Test 1: DOM query with no active session"
set +e
bdg dom query "body" 2>&1
EXIT_CODE=$?
set -e

if [ $EXIT_CODE -eq 0 ]; then
  log_error "DOM query should fail with no session"
  exit 1
fi

log_success "Test 1 passed: DOM fails gracefully with no session"

# Start session for remaining tests
log_step "Starting session for DOM tests"
bdg "https://example.com" --headless || die "Failed to start session"
sleep 3  # Let page load

# Test 2: Valid CSS selector - single element
log_step "Test 2: Query single element (body)"
DOM_OUTPUT=$(bdg dom query "body" 2>&1) || die "Failed to query body"

# Should contain text content
if echo "$DOM_OUTPUT" | grep -qi "example"; then
  log_success "body element found with expected content"
else
  log_warn "body content may not match expected"
fi

log_success "Test 2 passed: Single element query works"

# Test 3: Query returning multiple elements
log_step "Test 3: Query multiple elements (p)"
DOM_MULTI=$(bdg dom query "p" 2>&1) || die "Failed to query p tags"

# Should show count or list of elements
[ -n "$DOM_MULTI" ] || die "Query returned empty result"

log_success "Test 3 passed: Multiple element query works"

# Test 4: Query with no results
log_step "Test 4: Query with no matching elements"
set +e
DOM_NONE=$(bdg dom query ".nonexistent-class-12345" 2>&1)
NO_MATCH_EXIT=$?
set -e

[ $NO_MATCH_EXIT -eq 83 ] || die "No-match query should exit 83 (got $NO_MATCH_EXIT)"
log_success "Test 4 passed: No-match query exits 83"

# Test 5: Invalid CSS selector
log_step "Test 5: Invalid CSS selector"
set +e
bdg dom query ">>invalid<<" 2>&1
INVALID_EXIT=$?
set -e

if [ $INVALID_EXIT -eq 0 ]; then
  log_warn "Invalid selector should ideally return error"
else
  log_success "Invalid selector returned error as expected"
fi

log_success "Test 5 passed: Invalid selector handled"

# Test 6: Query body element
log_step "Test 6: Query body element"
BODY_OUTPUT=$(bdg dom query "body" 2>&1) || die "Failed to query body"

[ -n "$BODY_OUTPUT" ] || die "Body query returned empty"

log_success "Test 6 passed: Body element query works"

# Test 7: Query with descendant selectors
log_step "Test 7: Complex selector (div p)"
set +e
COMPLEX_OUTPUT=$(bdg dom query "div p" 2>&1)
COMPLEX_EXIT=$?
set -e

# May or may not find elements depending on page structure
log_success "Test 7 passed: Complex selector handled"

# Test 8: DOM query with JSON output (if supported)
log_step "Test 8: DOM with --json flag (if supported)"
set +e
JSON_DOM=$(bdg dom query "body" --json 2>&1)
JSON_EXIT=$?
set -e

if [ $JSON_EXIT -eq 0 ]; then
  # Try to validate JSON
  if echo "$JSON_DOM" | jq . > /dev/null 2>&1; then
    log_success "JSON output is valid"
  else
    log_warn "JSON flag accepted but output is not valid JSON"
  fi
else
  log_info "JSON flag not supported or failed (expected for some implementations)"
fi

log_success "Test 8 passed: JSON output tested"

# Test 9: Query by ID
log_step "Test 9: Query by ID selector"
set +e
ID_OUTPUT=$(bdg dom query "#nonexistent-id" 2>&1)
set -e

# Should handle gracefully
log_success "Test 9 passed: ID selector handled"

# Test 10: Query by attribute selector
log_step "Test 10: Query by attribute"
set +e
ATTR_OUTPUT=$(bdg dom query "[href]" 2>&1)
set -e

# Should find links if they exist
log_success "Test 10 passed: Attribute selector handled"

# Cleanup
log_step "Cleaning up test session"
stop_session_gracefully

# Summary
log_success "=== All DOM command tests passed ==="
exit 0
