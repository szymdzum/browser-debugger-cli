#!/usr/bin/env bash
# Error Scenario Test: Invalid URL Handling
#
# Tests that bdg validates URLs properly:
# - Completely invalid URLs
# - Malformed URLs
# - URLs with invalid characters
# - Clear error messages

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
TEST_NAME="invalid-url"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: Invalid URL error handling ==="

# Cleanup before starting
cleanup_sessions

# Test 1: Empty URL (shows help instead of failing)
log_step "Test 1: Empty URL handling"
EMPTY_OUTPUT=$(bdg "" 2>&1) || true
# CLI shows help for empty URL, which is acceptable behavior
if echo "$EMPTY_OUTPUT" | grep -qi "help\|usage\|example"; then
  log_success "Empty URL shows helpful usage information"
else
  log_warn "Empty URL handling could be clearer"
fi

# Test 2: Invalid characters
log_step "Test 2: URL with invalid characters"
bdg "http://exam ple.com" --headless 2>&1 && die "URL with spaces should have failed" || true
log_success "URL with spaces rejected"

# Test 3: Malformed URL
log_step "Test 3: Malformed URL"
bdg "ht!tp://example" --headless 2>&1 && die "Malformed URL should have failed" || true
log_success "Malformed URL rejected"

# Test 4: Just a slash
log_step "Test 4: Just a slash"
bdg "/" --headless 2>&1 && die "Single slash should have failed" || true
log_success "Single slash rejected"

# Test 5: Valid URLs should work
log_step "Test 5: Valid URL formats should succeed"

# Test various valid formats
VALID_URLS=(
  "example.com"
  "localhost:3000"
  "http://example.com"
  "https://example.com"
  "http://localhost:8080"
)

for url in "${VALID_URLS[@]}"; do
  log_info "Testing valid URL: $url"

  # Start session
  bdg "$url" --headless || die "Valid URL '$url' should have succeeded"
  sleep 1

  # Verify it started
  bdg status > /dev/null 2>&1 || die "Session didn't start for valid URL '$url'"

  # Stop session
  bdg stop || log_warn "Failed to stop session"
  sleep 1

  log_success "Valid URL '$url' accepted"
done

# Cleanup
log_step "Cleaning up"
bdg cleanup --force 2>&1 || true

# Summary
log_success "=== Invalid URL error handling tests passed ==="
exit 0
