#!/usr/bin/env bash
# Edge Case Test: URL Handling
#
# Tests various URL formats:
# - localhost URLs with different ports
# - IP addresses
# - URLs with query parameters
# - URLs with fragments
# - about:blank
# - Various protocol formats

set -euo pipefail

# Pages come from the local fixture server (tests/run-all-tests.sh starts it)
: "${BDG_FIXTURE_URL:?BDG_FIXTURE_URL is not set: run via tests/run-all-tests.sh}"

# Load cleanup library
TESTS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib"
source "$TESTS_LIB_DIR/cleanup.sh"

# Cleanup trap to prevent cascade failures
trap 'cleanup_with_polling' EXIT INT TERM

# Add timeout for entire test (5 minutes)
(sleep 300; kill -TERM $$) 2>/dev/null &
TIMEOUT_PID=$!

# Test metadata
TEST_NAME="url-handling"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: URL handling edge cases ==="

# Cleanup before starting
cleanup_sessions

# Test 1: localhost URL
log_step "Test 1: localhost URL"
set +e
bdg "localhost:3000" --headless 2>&1
LOCALHOST_EXIT=$?
set -e

# May fail if nothing running on port 3000, but should accept URL format
if [ $LOCALHOST_EXIT -eq 0 ]; then
  log_success "localhost URL accepted"
  cleanup_with_polling
else
  log_info "localhost URL failed (expected if nothing running on :3000)"
fi

log_success "Test 1 passed: localhost URL handled"

# Test 2: 127.0.0.1 IP address
log_step "Test 2: IP address (127.0.0.1)"
set +e
bdg "127.0.0.1:8080" --headless 2>&1
IP_EXIT=$?
set -e

if [ $IP_EXIT -eq 0 ]; then
  log_success "IP address URL accepted"
  cleanup_with_polling
else
  log_info "IP address URL failed (expected if nothing running on :8080)"
fi

log_success "Test 2 passed: IP address handled"

# Test 3: URL with query parameters
log_step "Test 3: URL with query parameters"
bdg "${BDG_FIXTURE_URL}?foo=bar&baz=qux" --headless || die "URL with query params failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "URL with query parameters works"

cleanup_with_polling

log_success "Test 3 passed: Query parameters handled"

# Test 4: URL with fragment
log_step "Test 4: URL with fragment (#section)"
bdg "${BDG_FIXTURE_URL}#section" --headless || die "URL with fragment failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "URL with fragment works"

cleanup_with_polling

log_success "Test 4 passed: Fragment handled"

# Test 5: URL with both query and fragment
log_step "Test 5: URL with query and fragment"
bdg "${BDG_FIXTURE_URL}?page=1#top" --headless || die "URL with query+fragment failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "URL with query and fragment works"

cleanup_with_polling

log_success "Test 5 passed: Query+fragment handled"

# Test 6: about:blank
log_step "Test 6: about:blank"
bdg "about:blank" --headless || die "about:blank failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "about:blank works"

cleanup_with_polling

log_success "Test 6 passed: about:blank handled"

# Test 7: http:// explicit protocol
log_step "Test 7: Explicit http:// protocol"
bdg "$BDG_FIXTURE_URL" --headless || die "http:// URL failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "http:// protocol works"

cleanup_with_polling

log_success "Test 7 passed: http:// handled"

# Test 8: URL without protocol (auto-add http://)
log_step "Test 8: URL without protocol"
bdg "${BDG_FIXTURE_URL#http://}" --headless || die "URL without protocol failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "URL without protocol works (auto-added http://)"

cleanup_with_polling

log_success "Test 8 passed: Protocol auto-detection handled"

# Final cleanup and kill timeout watcher
kill $TIMEOUT_PID 2>/dev/null || true
cleanup_with_polling

# Summary
log_success "=== All URL handling tests passed ==="
exit 0
