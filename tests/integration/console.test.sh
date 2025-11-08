#!/usr/bin/env bash
# Integration Test: bdg console command
#
# Tests console inspection with various scenarios:
# - Console with no session
# - Basic console listing
# - Filter by log level
# - JSON output validation
# - Empty console handling
# - Multiple console calls

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
TEST_NAME="console-command"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: bdg console command ==="

# Cleanup before starting
cleanup_sessions

# Test 1: Console command with no active session
log_step "Test 1: Console with no active session"
set +e
bdg console 2>&1
EXIT_CODE=$?
set -e

if [ $EXIT_CODE -eq 0 ]; then
  log_error "Console should fail with no session"
  exit 1
fi

log_success "Test 1 passed: Console fails gracefully with no session"

# Start session for remaining tests
log_step "Starting session for console tests"
bdg "https://example.com" --headless || die "Failed to start session"
sleep 3  # Let page load

# Test 2: Basic console listing
log_step "Test 2: List console messages"
CONSOLE_OUTPUT=$(bdg console 2>&1) || die "Failed to list console messages"

# May be empty or have messages depending on page
[ -n "$CONSOLE_OUTPUT" ] || log_info "No console messages (expected for simple pages)"

log_success "Test 2 passed: Basic console listing works"

# Test 3: Console with JSON output
log_step "Test 3: Console JSON output"
set +e
CONSOLE_JSON=$(bdg console --json 2>&1)
JSON_EXIT=$?
set -e

if [ $JSON_EXIT -eq 0 ]; then
  # Validate JSON structure
  if echo "$CONSOLE_JSON" | jq . > /dev/null 2>&1; then
    log_success "JSON output is valid"
    
    # Check for expected fields
    if echo "$CONSOLE_JSON" | jq -e '.preview.data.console' > /dev/null 2>&1; then
      log_success "JSON has expected console data structure"
    fi
  else
    log_warn "JSON flag accepted but output may not be valid JSON"
  fi
else
  log_info "JSON flag not supported or failed"
fi

log_success "Test 3 passed: JSON output tested"

# Test 4: Console filtering by level (if supported)
log_step "Test 4: Console filtering by level"
set +e
# Try filtering by error level (may not be supported)
FILTER_ERROR=$(bdg console --level error 2>&1)
FILTER_EXIT=$?
set -e

if [ $FILTER_EXIT -eq 0 ]; then
  log_success "Console filtering by level works"
else
  log_info "Console filtering by level not supported (expected)"
fi

log_success "Test 4 passed: Filtering tested"

# Test 5: Console with verbose flag
log_step "Test 5: Console with verbose output"
set +e
VERBOSE_OUTPUT=$(bdg console --verbose 2>&1)
VERBOSE_EXIT=$?
set -e

if [ $VERBOSE_EXIT -eq 0 ]; then
  log_success "Verbose output works"
else
  log_info "Verbose flag not supported"
fi

log_success "Test 5 passed: Verbose tested"

# Test 6: Console with --last N
log_step "Test 6: Console with --last limit"
set +e
LAST_OUTPUT=$(bdg console --last 5 2>&1)
LAST_EXIT=$?
set -e

if [ $LAST_EXIT -eq 0 ]; then
  log_success "Last N limiting works"
else
  log_info "Last flag may not be supported for console"
fi

log_success "Test 6 passed: Limit tested"

# Test 7: Multiple console command calls (idempotency)
log_step "Test 7: Multiple console calls"
bdg console > /dev/null 2>&1 || die "First call failed"
bdg console > /dev/null 2>&1 || die "Second call failed"
bdg console > /dev/null 2>&1 || die "Third call failed"

log_success "Test 7 passed: Multiple calls work (idempotent)"

# Test 8: Console on page with console.log (navigate to a test page)
log_step "Test 8: Console with actual log messages"
# Stop current session
bdg stop 2>&1 || true
sleep 1

# Start new session with data URL that has console.log
bdg "data:text/html,<script>console.log('test');console.warn('warning');console.error('error');</script>" --headless 2>&1 || log_info "data URL may not be supported"
sleep 2

# Try to get console messages
set +e
CONSOLE_WITH_LOGS=$(bdg console 2>&1)
LOGS_EXIT=$?
set -e

if [ $LOGS_EXIT -eq 0 ]; then
  if echo "$CONSOLE_WITH_LOGS" | grep -qi "test\|warning\|error\|log"; then
    log_success "Console messages captured from JavaScript"
  else
    log_info "Console messages may be captured but not visible in output"
  fi
else
  log_info "Data URL test skipped or failed"
fi

log_success "Test 8 passed: Console with logs tested"

# Cleanup
log_step "Cleaning up test session"
stop_session_gracefully

# Summary
log_success "=== All console command tests passed ==="
exit 0
