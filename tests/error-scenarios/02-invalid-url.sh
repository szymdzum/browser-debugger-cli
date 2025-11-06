#!/bin/bash
# Error Scenario Test: Invalid URL Handling
#
# Tests that bdg validates URLs properly:
# - Completely invalid URLs
# - Malformed URLs
# - URLs with invalid characters
# - Clear error messages

set -euo pipefail

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

# Test 1: Empty URL
log_step "Test 1: Empty URL should fail"
bdg "" 2>&1 && die "Empty URL should have failed" || true
log_success "Empty URL rejected"

# Test 2: Invalid characters
log_step "Test 2: URL with invalid characters"
bdg "http://exam ple.com" 2>&1 && die "URL with spaces should have failed" || true
log_success "URL with spaces rejected"

# Test 3: Malformed URL
log_step "Test 3: Malformed URL"
bdg "ht!tp://example" 2>&1 && die "Malformed URL should have failed" || true
log_success "Malformed URL rejected"

# Test 4: Just a slash
log_step "Test 4: Just a slash"
bdg "/" 2>&1 && die "Single slash should have failed" || true
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
  bdg "$url" || die "Valid URL '$url' should have succeeded"
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
