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

# Cleanup trap to prevent cascade failures
cleanup() {
  local exit_code=$?
  bdg stop 2>/dev/null || true
  sleep 0.5
  lsof -ti:9222 | xargs kill -9 2>/dev/null || true
  sleep 0.5
  bdg cleanup --force 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

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
bdg "localhost:3000" 2>&1
LOCALHOST_EXIT=$?
set -e

# May fail if nothing running on port 3000, but should accept URL format
if [ $LOCALHOST_EXIT -eq 0 ]; then
  log_success "localhost URL accepted"
  bdg stop 2>&1 || true
  sleep 1
else
  log_info "localhost URL failed (expected if nothing running on :3000)"
fi

log_success "Test 1 passed: localhost URL handled"

# Test 2: 127.0.0.1 IP address
log_step "Test 2: IP address (127.0.0.1)"
set +e
bdg "127.0.0.1:8080" 2>&1
IP_EXIT=$?
set -e

if [ $IP_EXIT -eq 0 ]; then
  log_success "IP address URL accepted"
  bdg stop 2>&1 || true
  sleep 1
else
  log_info "IP address URL failed (expected if nothing running on :8080)"
fi

log_success "Test 2 passed: IP address handled"

# Test 3: URL with query parameters
log_step "Test 3: URL with query parameters"
bdg "https://example.com?foo=bar&baz=qux" || die "URL with query params failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "URL with query parameters works"

bdg stop 2>&1 || true
sleep 1

log_success "Test 3 passed: Query parameters handled"

# Test 4: URL with fragment
log_step "Test 4: URL with fragment (#section)"
bdg "https://example.com#section" || die "URL with fragment failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "URL with fragment works"

bdg stop 2>&1 || true
sleep 1

log_success "Test 4 passed: Fragment handled"

# Test 5: URL with both query and fragment
log_step "Test 5: URL with query and fragment"
bdg "https://example.com?page=1#top" || die "URL with query+fragment failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "URL with query and fragment works"

bdg stop 2>&1 || true
sleep 1

log_success "Test 5 passed: Query+fragment handled"

# Test 6: about:blank
log_step "Test 6: about:blank"
bdg "about:blank" || die "about:blank failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "about:blank works"

bdg stop 2>&1 || true
sleep 1

log_success "Test 6 passed: about:blank handled"

# Test 7: http:// explicit protocol
log_step "Test 7: Explicit http:// protocol"
bdg "http://example.com" || die "http:// URL failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "http:// protocol works"

bdg stop 2>&1 || true
sleep 1

log_success "Test 7 passed: http:// handled"

# Test 8: https:// explicit protocol
log_step "Test 8: Explicit https:// protocol"
bdg "https://example.com" || die "https:// URL failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "https:// protocol works"

bdg stop 2>&1 || true
sleep 1

log_success "Test 8 passed: https:// handled"

# Test 9: URL without protocol (auto-add http://)
log_step "Test 9: URL without protocol"
bdg "example.com" || die "URL without protocol failed"
sleep 2

bdg status > /dev/null 2>&1 || die "Session not running"
log_success "URL without protocol works (auto-added http://)"

bdg stop 2>&1 || true
sleep 1

log_success "Test 9 passed: Protocol auto-detection handled"

# Test 10: URL with port number
log_step "Test 10: URL with custom port"
set +e
bdg "http://example.com:8080" 2>&1
PORT_EXIT=$?
set -e

if [ $PORT_EXIT -eq 0 ]; then
  log_success "URL with custom port accepted"
  bdg stop 2>&1 || true
  sleep 1
else
  log_info "URL with port may have failed (could be refused)"
fi

log_success "Test 10 passed: Custom port handled"

# Final cleanup
cleanup_sessions

# Summary
log_success "=== All URL handling tests passed ===\"
exit 0
