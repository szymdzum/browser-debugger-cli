#!/usr/bin/env bash
# Integration Test: bdg peek command
#
# Tests all peek command variations:
# - Basic peek (last 10 items, compact)
# - Verbose peek (full URLs, emojis)
# - Filter options (--network, --console)
# - --last N option
# - JSON output
# - Invalid filter handling

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
TEST_NAME="peek-command"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: bdg peek command ==="

# Cleanup before starting
cleanup_sessions

# Test 1: Peek with no active session
log_step "Test 1: Peek with no active session"
set +e
PEEK_OUTPUT=$(bdg peek 2>&1)
EXIT_CODE=$?
set -e

# Should fail gracefully
if [ $EXIT_CODE -eq 0 ]; then
  log_error "Expected non-zero exit code when no session active"
  exit 1
fi

log_success "Test 1 passed: Peek fails gracefully with no session"

# Start session for remaining tests
log_step "Starting session for peek tests"
bdg "https://example.com" --headless || die "Failed to start session"
sleep 3  # Let some data accumulate

# Test 2: Basic peek (default: last 10, compact)
log_step "Test 2: Basic peek (default settings)"
PEEK_OUTPUT=$(bdg peek 2>&1) || die "Basic peek failed"

# Should show some output
[ -n "$PEEK_OUTPUT" ] || die "Peek output is empty"

log_success "Test 2 passed: Basic peek works"

# Test 3: Peek with --verbose
log_step "Test 3: Peek with --verbose"
VERBOSE_OUTPUT=$(bdg peek --verbose 2>&1) || die "Verbose peek failed"

# Verbose should have more detailed output
[ ${#VERBOSE_OUTPUT} -ge ${#PEEK_OUTPUT} ] || log_warn "Verbose output not noticeably different from compact"

log_success "Test 3 passed: Verbose peek works"

# Test 4: Peek with --last N
log_step "Test 4: Peek with --last 50"
LAST_OUTPUT=$(bdg peek --last 50 2>&1) || die "Peek --last failed"

log_success "Test 4 passed: Peek --last N works"

# Test 5: Peek with --network filter
log_step "Test 5: Peek with --network filter"
NETWORK_OUTPUT=$(bdg peek --network 2>&1) || die "Peek --network failed"

# Should show network requests
echo "$NETWORK_OUTPUT" | grep -qi "network\|request\|GET\|POST" || log_warn "Network filter may not be showing network data"

log_success "Test 5 passed: Peek --network filter works"

# Test 6: Peek with --console filter
log_step "Test 6: Peek with --console filter"
CONSOLE_OUTPUT=$(bdg peek --console 2>&1) || die "Peek --console failed"

# May be empty if no console messages, that's OK
log_success "Test 6 passed: Peek --console filter works"

# Test 7: Peek with --json
log_step "Test 7: Peek with --json"
JSON_OUTPUT=$(bdg peek --json 2>&1) || die "Peek --json failed"

# Validate JSON format
echo "$JSON_OUTPUT" | jq . > /dev/null 2>&1 || die "Peek --json output is not valid JSON"

# Validate JSON structure (peek uses .preview.data structure)
JSON_PREVIEW=$(echo "$JSON_OUTPUT" | jq '.preview' 2>&1) || die "JSON missing 'preview' field"
[ "$JSON_PREVIEW" != "null" ] || die "JSON preview field is null"

log_success "Test 7 passed: Peek --json produces valid JSON"

# Test 8: Peek with multiple filters
log_step "Test 8: Peek with --network --last 20 --json"
COMBO_OUTPUT=$(bdg peek --network --last 20 --json 2>&1) || die "Peek with combined flags failed"

# Should be valid JSON
echo "$COMBO_OUTPUT" | jq . > /dev/null 2>&1 || die "Combined flags output is not valid JSON"

log_success "Test 8 passed: Peek with multiple flags works"

# Test 9: Peek --last with invalid value
log_step "Test 9: Peek --last with invalid value (should fail)"
bdg peek --last 0 2>&1 && die "Peek --last 0 should have failed" || true
bdg peek --last -5 2>&1 && die "Peek --last -5 should have failed" || true

log_success "Test 9 passed: Peek validates --last argument"

# Cleanup
log_step "Cleaning up test session"
stop_session_gracefully

# Summary
log_success "=== All peek command tests passed ==="
exit 0
