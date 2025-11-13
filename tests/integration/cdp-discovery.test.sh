#!/usr/bin/env bash
# Integration Test: bdg cdp discovery features
#
# Tests CDP protocol introspection:
# - List all domains (--list)
# - List domain methods (Domain --list)
# - Describe methods (Method --describe)
# - Search methods (--search)
# - Case-insensitive input
# - Error handling for invalid inputs

set -euo pipefail

# Test metadata
TEST_NAME="cdp-discovery"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"

log_info "=== Testing: bdg cdp discovery features ==="

SUCCESS=0
FAILED=0

# Helper function to test a command
test_cmd() {
  local desc="$1"
  local cmd="$2"
  local expected_exit="${3:-0}"
  
  log_step "Testing: $desc"
  
  if output=$(eval "$cmd" 2>&1); then
    actual_exit=0
  else
    actual_exit=$?
  fi
  
  if [ "$actual_exit" -eq "$expected_exit" ]; then
    log_success "✅ $desc"
    ((SUCCESS++))
    return 0
  else
    log_error "❌ $desc (exit code: expected $expected_exit, got $actual_exit)"
    echo "  Command: $cmd"
    echo "  Output: ${output:0:200}"
    ((FAILED++))
    return 1
  fi
}

# ==============================================================================
# Mode 1: List All Domains
# ==============================================================================

log_info "Mode 1: List All Domains"

test_cmd "List all domains" \
  "bdg cdp --list | jq -e '.count == 53'" 

test_cmd "Verify domains array exists" \
  "bdg cdp --list | jq -e '.domains | length == 53'"

test_cmd "Check first domain structure" \
  "bdg cdp --list | jq -e '.domains[0] | has(\"name\") and has(\"commands\")'"

# ==============================================================================
# Mode 2: List Domain Methods
# ==============================================================================

log_info "Mode 2: List Domain Methods"

# Test popular domains
DOMAINS=("Network" "Runtime" "DOM" "Page" "Console" "Debugger")

for domain in "${DOMAINS[@]}"; do
  test_cmd "List $domain methods" \
    "bdg cdp $domain --list | jq -e '.domain == \"$domain\" and .count > 0'"
done

# Test case-insensitive
test_cmd "List network methods (lowercase)" \
  "bdg cdp network --list | jq -e '.domain == \"Network\"'"

test_cmd "List RUNTIME methods (uppercase)" \
  "bdg cdp RUNTIME --list | jq -e '.domain == \"Runtime\"'"

# ==============================================================================
# Mode 3: Describe Methods
# ==============================================================================

log_info "Mode 3: Describe Methods"

test_cmd "Describe Network.getCookies" \
  "bdg cdp Network.getCookies --describe | jq -e '.name == \"Network.getCookies\"'"

test_cmd "Describe Runtime.evaluate" \
  "bdg cdp Runtime.evaluate --describe | jq -e '.parameters | length > 0'"

test_cmd "Describe Page.captureScreenshot" \
  "bdg cdp Page.captureScreenshot --describe | jq -e '.returns | length > 0'"

# Test case-insensitive
test_cmd "Describe network.getcookies (lowercase)" \
  "bdg cdp network.getcookies --describe | jq -e '.name == \"Network.getCookies\"'"

test_cmd "Describe RUNTIME.EVALUATE (uppercase)" \
  "bdg cdp RUNTIME.EVALUATE --describe | jq -e '.name == \"Runtime.evaluate\"'"

# Test describe domain only
test_cmd "Describe Network domain" \
  "bdg cdp Network --describe | jq -e '.type == \"domain\" and .domain == \"Network\"'"

# ==============================================================================
# Mode 4: Search Methods
# ==============================================================================

log_info "Mode 4: Search Methods"

test_cmd "Search for 'cookie'" \
  "bdg cdp --search cookie | jq -e '.count > 0 and .query == \"cookie\"'"

test_cmd "Search for 'screenshot'" \
  "bdg cdp --search screenshot | jq -e '.methods | length > 0'"

test_cmd "Search for 'evaluate'" \
  "bdg cdp --search evaluate | jq -e '.count > 0'"

test_cmd "Search returns structured results" \
  "bdg cdp --search cookie | jq -e '.methods[0] | has(\"name\") and has(\"domain\")'"

# ==============================================================================
# Mode 5: Error Cases
# ==============================================================================

log_info "Mode 5: Error Cases"

test_cmd "Invalid domain returns 81" \
  "bdg cdp InvalidDomain --list" 81

test_cmd "Invalid method returns 81" \
  "bdg cdp Network.invalidMethod --describe" 81

test_cmd "No arguments returns 81" \
  "bdg cdp" 81

# ==============================================================================
# Mode 6: Schema Validation
# ==============================================================================

log_info "Mode 6: Schema Validation"

test_cmd "Methods have examples" \
  "bdg cdp Network --list | jq -e '.methods[0].example != null'"

test_cmd "Parameters have types" \
  "bdg cdp Network.getCookies --describe | jq -e '.parameters[0].type != null'"

test_cmd "Returns have types" \
  "bdg cdp Runtime.evaluate --describe | jq -e '.returns[0].type != null'"

test_cmd "Domains with experimental flag" \
  "bdg cdp --list | jq -e '[.domains[] | select(.experimental == true)] | length > 0'"

# ==============================================================================
# Summary
# ==============================================================================

log_info "Summary"
echo "✅ Passed: $SUCCESS"
echo "❌ Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
  log_success "=== All CDP discovery tests passed ==="
  exit 0
else
  log_error "=== Some CDP discovery tests failed ==="
  exit 1
fi
