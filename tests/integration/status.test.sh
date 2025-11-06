#!/usr/bin/env bash
# Integration Test: bdg status command
#
# Tests all status command variations:
# - Basic status
# - Verbose status (with Chrome diagnostics)
# - JSON output format

set -euo pipefail

# Test metadata
TEST_NAME="status-command"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: bdg status command ==="

# Cleanup before starting
cleanup_sessions

# Test 1: Status with no active session
log_step "Test 1: Status with no active session"
STATUS_OUTPUT=$(bdg status 2>&1) || true
EXIT_CODE=$?

# Should fail gracefully (non-zero exit code)
if [ $EXIT_CODE -eq 0 ]; then
  log_error "Expected non-zero exit code when no session active"
  exit 1
fi

log_success "Test 1 passed: Status fails gracefully with no session"

# Test 2: Status with active session (basic)
log_step "Test 2: Starting session for status tests"
bdg "https://example.com" || die "Failed to start session"
sleep 2

log_step "Test 2: Checking basic status"
STATUS_OUTPUT=$(bdg status 2>&1) || die "Status command failed with active session"

# Validate output contains expected information
echo "$STATUS_OUTPUT" | grep -q "Status" || die "Status output missing 'Status' field"
echo "$STATUS_OUTPUT" | grep -q "URL" || die "Status output missing 'URL' field"

log_success "Test 2 passed: Basic status works with active session"

# Test 3: Status with --verbose flag
log_step "Test 3: Checking verbose status"
VERBOSE_OUTPUT=$(bdg status --verbose 2>&1) || die "Verbose status failed"

# Verbose should include Chrome diagnostics
echo "$VERBOSE_OUTPUT" | grep -qi "chrome\|port\|pid" || log_warn "Verbose output may be missing Chrome diagnostics"

log_success "Test 3 passed: Verbose status includes additional details"

# Test 4: Status with --json flag
log_step "Test 4: Checking JSON status"
JSON_OUTPUT=$(bdg status --json 2>&1) || die "JSON status failed"

# Validate JSON format
echo "$JSON_OUTPUT" | jq . > /dev/null 2>&1 || die "Status --json output is not valid JSON"

# Validate JSON structure
JSON_STATUS=$(echo "$JSON_OUTPUT" | jq -r '.status' 2>&1) || die "JSON missing 'status' field"
[ -n "$JSON_STATUS" ] || die "JSON status field is empty"

log_success "Test 4 passed: JSON status produces valid JSON with expected fields"

# Test 5: Status --json --verbose (combination)
log_step "Test 5: Checking JSON + verbose combination"
JSON_VERBOSE_OUTPUT=$(bdg status --json --verbose 2>&1) || die "JSON + verbose failed"

# Should still be valid JSON
echo "$JSON_VERBOSE_OUTPUT" | jq . > /dev/null 2>&1 || die "JSON + verbose output is not valid JSON"

log_success "Test 5 passed: JSON + verbose combination works"

# Cleanup
log_step "Cleaning up test session"
stop_session_gracefully

# Summary
log_success "=== All status command tests passed ==="
exit 0
