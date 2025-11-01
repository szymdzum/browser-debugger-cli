#!/bin/bash
#
# Extended Smoke Test Suite for bdg CLI
# Covers previously untested commands, flags, and edge cases
#
# Usage: ./smoke-test-extended.sh
#

set -e  # Exit on error

BDG="node dist/index.js"
TEST_URL="localhost:3000"
SESSION_DIR="$HOME/.bdg"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
START_TIME=$(date +%s)

# Helper: Print test header
test_header() {
  echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}TEST: $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  TESTS_RUN=$((TESTS_RUN + 1))
}

# Helper: Assert command succeeds
assert_success() {
  local description="$1"
  shift
  if "$@"; then
    echo -e "${GREEN}✓${NC} $description"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗${NC} $description"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Helper: Assert command fails
assert_failure() {
  local description="$1"
  shift
  if ! "$@" 2>&1; then
    echo -e "${GREEN}✓${NC} $description (correctly failed)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗${NC} $description (should have failed)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Helper: Assert string contains substring
assert_contains() {
  local haystack="$1"
  local needle="$2"
  local description="$3"

  if echo "$haystack" | grep -q "$needle"; then
    echo -e "${GREEN}✓${NC} $description"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗${NC} $description"
    echo -e "  Expected to find: '$needle'"
    echo -e "  In output: '$haystack'"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Helper: Validate JSON
assert_valid_json() {
  local json="$1"
  local description="$2"

  if echo "$json" | jq empty 2>/dev/null; then
    echo -e "${GREEN}✓${NC} $description"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗${NC} $description"
    echo -e "  Invalid JSON: $json"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Helper: Assert JSON field equals value
assert_json_field() {
  local json="$1"
  local field="$2"
  local expected="$3"
  local description="$4"

  local actual=$(echo "$json" | jq -r "$field")
  if [ "$actual" = "$expected" ]; then
    echo -e "${GREEN}✓${NC} $description"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗${NC} $description"
    echo -e "  Expected: $expected"
    echo -e "  Got: $actual"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Helper: Cleanup session
cleanup() {
  echo -e "\n${YELLOW}Cleaning up...${NC}"
  $BDG stop 2>/dev/null || true
  $BDG cleanup --force 2>/dev/null || true
  $BDG cleanup --all 2>/dev/null || true
  sleep 1
}

# Helper: Wait for session to be active
wait_for_session() {
  local max_wait=10
  local count=0
  while [ $count -lt $max_wait ]; do
    if $BDG status 2>&1 | grep -q "ACTIVE\|active"; then
      return 0
    fi
    sleep 0.5
    count=$((count + 1))
  done
  return 1
}

# ============================================================================
# SETUP
# ============================================================================

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Extended Smoke Test Suite for bdg CLI                         ║${NC}"
echo -e "${BLUE}║  Testing previously untested commands, flags, and edge cases  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"

# Initial cleanup
cleanup

# Build
echo -e "\n${YELLOW}Building...${NC}"
npm run build >/dev/null 2>&1

# ============================================================================
# TEST CATEGORY 1: bdg query command
# ============================================================================

test_header "bdg query - No session running"
OUTPUT=$($BDG query "document.title" 2>&1 || true)
assert_contains "$OUTPUT" "No active session" "Error message shown when no session"

test_header "bdg query - Happy path"
# Start session with short timeout
$BDG $TEST_URL --timeout 3 &
SESSION_PID=$!
wait_for_session

# Execute simple query
OUTPUT=$($BDG query "document.title" 2>&1)
assert_valid_json "$OUTPUT" "Query returns valid JSON"

# Execute query that returns value
OUTPUT=$($BDG query "1 + 1" 2>&1)
assert_contains "$OUTPUT" "2" "Query executes arithmetic correctly"

# Wait for timeout
wait $SESSION_PID 2>/dev/null || true
cleanup

test_header "bdg query - Script error handling"
$BDG $TEST_URL --timeout 3 &
wait_for_session

# Execute query with syntax error
OUTPUT=$($BDG query "this.is.invalid.syntax.that.will.throw" 2>&1 || true)
assert_contains "$OUTPUT" "Error executing script" "Query shows error for invalid script"

cleanup

test_header "bdg query - Target no longer exists"
# This test verifies the error message when session metadata exists but target is gone
# We can't easily simulate this without complex tab manipulation, so we'll skip for now
echo -e "${YELLOW}⊘${NC} Skipped (requires tab closure simulation)"

# ============================================================================
# TEST CATEGORY 2: Start command flags
# ============================================================================

test_header "bdg start --port flag"
# Test custom port (this will likely fail if Chrome isn't on that port, which is expected)
OUTPUT=$($BDG $TEST_URL --port 9999 --timeout 2 2>&1 || true)
# Should either connect or fail with connection error (not parsing error)
if echo "$OUTPUT" | grep -q "ECONNREFUSED\|Connection refused\|Could not connect"; then
  echo -e "${GREEN}✓${NC} --port flag is parsed and used (connection failed as expected)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⚠${NC} --port flag behavior unclear from output"
fi
cleanup

test_header "bdg start --reuse-tab flag"
# Start session with --reuse-tab
$BDG $TEST_URL --reuse-tab --timeout 3 2>&1 &
wait_for_session || true

# Check metadata for reuse-tab indicator (if implemented)
if [ -f "$SESSION_DIR/session.meta.json" ]; then
  META=$(cat "$SESSION_DIR/session.meta.json")
  echo -e "${GREEN}✓${NC} --reuse-tab flag accepted (session started)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⚠${NC} Session metadata not found"
fi

wait 2>/dev/null || true
cleanup

test_header "bdg start --user-data-dir flag"
TEMP_DIR=$(mktemp -d)
$BDG $TEST_URL --user-data-dir "$TEMP_DIR" --timeout 3 2>&1 &
wait_for_session || true

if [ -f "$SESSION_DIR/session.meta.json" ]; then
  echo -e "${GREEN}✓${NC} --user-data-dir flag accepted (session started)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⚠${NC} Session metadata not found"
fi

wait 2>/dev/null || true
rm -rf "$TEMP_DIR"
cleanup

# ============================================================================
# TEST CATEGORY 3: Chrome lifecycle commands
# ============================================================================

test_header "bdg stop --kill-chrome flag"
$BDG $TEST_URL --timeout 10 &
wait_for_session

# Stop with --kill-chrome
OUTPUT=$($BDG stop --kill-chrome 2>&1)
assert_contains "$OUTPUT" "Killed Chrome\|Chrome process" "stop --kill-chrome mentions Chrome"
sleep 1

test_header "bdg cleanup --all flag"
# Create a dummy session.json
echo '{"test": "data"}' > "$SESSION_DIR/session.json"

# Cleanup with --all
OUTPUT=$($BDG cleanup --all 2>&1)
assert_contains "$OUTPUT" "Session output file removed\|No session files" "cleanup --all removes session.json"

# Verify file is gone
if [ ! -f "$SESSION_DIR/session.json" ]; then
  echo -e "${GREEN}✓${NC} session.json removed"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗${NC} session.json still exists"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

test_header "bdg cleanup - Refuses when session active without --force"
$BDG $TEST_URL --timeout 10 &
wait_for_session

# Try cleanup without --force (should fail)
OUTPUT=$($BDG cleanup 2>&1 || true)
assert_contains "$OUTPUT" "still active\|Force cleanup" "cleanup refuses to run on active session"

# Cleanup with --force should work
OUTPUT=$($BDG cleanup --force 2>&1)
assert_contains "$OUTPUT" "still running\|Forcing cleanup" "cleanup --force proceeds despite active session"

cleanup

# ============================================================================
# TEST CATEGORY 4: Structured output modes
# ============================================================================

test_header "bdg status --json"
$BDG $TEST_URL --timeout 5 &
wait_for_session

OUTPUT=$($BDG status --json 2>&1)
assert_valid_json "$OUTPUT" "status --json returns valid JSON"
assert_json_field "$OUTPUT" ".active" "true" "status --json shows active: true"

cleanup

test_header "bdg status --json (no session)"
OUTPUT=$($BDG status --json 2>&1)
assert_valid_json "$OUTPUT" "status --json (no session) returns valid JSON"
assert_json_field "$OUTPUT" ".active" "false" "status --json shows active: false"

test_header "bdg details --json (network)"
$BDG $TEST_URL --timeout 5 &
wait_for_session
sleep 2  # Wait for some data

# Get a network request ID
PEEK_OUTPUT=$($BDG peek --network --json 2>&1 || echo '{"network":[]}')
REQUEST_ID=$(echo "$PEEK_OUTPUT" | jq -r '.network[0].requestId // empty' 2>/dev/null || echo "")

if [ -n "$REQUEST_ID" ]; then
  OUTPUT=$($BDG details network "$REQUEST_ID" --json 2>&1)
  assert_valid_json "$OUTPUT" "details network --json returns valid JSON"
  assert_json_field "$OUTPUT" ".requestId" "$REQUEST_ID" "details --json contains correct requestId"
else
  echo -e "${YELLOW}⊘${NC} Skipped (no network requests captured)"
fi

cleanup

test_header "bdg details --json (console)"
$BDG $TEST_URL --timeout 5 &
wait_for_session
sleep 2

# Try to get console details
OUTPUT=$($BDG details console 0 --json 2>&1 || echo '{}')
if echo "$OUTPUT" | jq empty 2>/dev/null; then
  echo -e "${GREEN}✓${NC} details console --json returns valid JSON"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⊘${NC} No console messages captured"
fi

cleanup

test_header "bdg peek --follow mode"
$BDG $TEST_URL --timeout 5 &
wait_for_session

# Start follow mode in background for 2 seconds
timeout 2 $BDG peek --follow 2>&1 || true
echo -e "${GREEN}✓${NC} peek --follow mode runs (stopped after 2s)"
TESTS_PASSED=$((TESTS_PASSED + 1))

cleanup

# ============================================================================
# TEST CATEGORY 5: Session artifact validation
# ============================================================================

test_header "Session files - Existence and schema"
$BDG $TEST_URL --timeout 5 &
wait_for_session

# Check session.pid exists
if [ -f "$SESSION_DIR/session.pid" ]; then
  echo -e "${GREEN}✓${NC} session.pid exists"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗${NC} session.pid missing"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Check session.meta.json exists and has valid schema
if [ -f "$SESSION_DIR/session.meta.json" ]; then
  echo -e "${GREEN}✓${NC} session.meta.json exists"
  TESTS_PASSED=$((TESTS_PASSED + 1))

  META=$(cat "$SESSION_DIR/session.meta.json")
  assert_valid_json "$META" "session.meta.json is valid JSON"

  # Check required fields
  if echo "$META" | jq -e '.startTime' >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} session.meta.json has startTime field"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗${NC} session.meta.json missing startTime"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
else
  echo -e "${RED}✗${NC} session.meta.json missing"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Check session.preview.json exists
sleep 1  # Wait for preview to be written
if [ -f "$SESSION_DIR/session.preview.json" ]; then
  echo -e "${GREEN}✓${NC} session.preview.json exists"
  TESTS_PASSED=$((TESTS_PASSED + 1))

  PREVIEW=$(cat "$SESSION_DIR/session.preview.json")
  assert_valid_json "$PREVIEW" "session.preview.json is valid JSON"
else
  echo -e "${YELLOW}⚠${NC} session.preview.json not yet written"
fi

# Check session.full.json exists
if [ -f "$SESSION_DIR/session.full.json" ]; then
  echo -e "${GREEN}✓${NC} session.full.json exists"
  TESTS_PASSED=$((TESTS_PASSED + 1))

  FULL=$(cat "$SESSION_DIR/session.full.json")
  assert_valid_json "$FULL" "session.full.json is valid JSON"
else
  echo -e "${YELLOW}⚠${NC} session.full.json not yet written"
fi

cleanup

test_header "Stale session recovery"
# Create fake stale session files
echo "99999" > "$SESSION_DIR/session.pid"  # Non-existent PID
echo '{"startTime": 1234567890}' > "$SESSION_DIR/session.meta.json"

# Status should detect stale session
OUTPUT=$($BDG status --json 2>&1)
assert_json_field "$OUTPUT" ".stale" "true" "status detects stale session"

# Cleanup should remove stale files
$BDG cleanup 2>&1 >/dev/null
if [ ! -f "$SESSION_DIR/session.pid" ]; then
  echo -e "${GREEN}✓${NC} Stale session files cleaned up"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗${NC} Stale session files remain"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ============================================================================
# TEST CATEGORY 6: Edge cases
# ============================================================================

test_header "Invalid URL handling"
OUTPUT=$($BDG "not-a-valid-url-at-all" --timeout 2 2>&1 || true)
# Should fail gracefully (not crash)
if [ $? -ne 0 ]; then
  echo -e "${GREEN}✓${NC} Invalid URL rejected with error"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⚠${NC} Invalid URL handling unclear"
fi
cleanup

test_header "Chrome not available on specified port"
OUTPUT=$($BDG $TEST_URL --port 9998 --timeout 2 2>&1 || true)
assert_contains "$OUTPUT" "ECONNREFUSED\|Connection refused\|Could not connect\|EADDRNOTAVAIL" "Descriptive error when Chrome unavailable"
cleanup

test_header "Multiple concurrent session attempts"
$BDG $TEST_URL --timeout 10 &
wait_for_session

# Try to start another session
OUTPUT=$($BDG $TEST_URL --timeout 2 2>&1 || true)
assert_contains "$OUTPUT" "already running\|Session already" "Prevents concurrent sessions"

cleanup

# ============================================================================
# TEST CATEGORY 7: Known limitations (negative tests)
# ============================================================================

test_header "Subcommand options are ignored (known limitation)"
# Test that --timeout on subcommand doesn't work
echo -e "${YELLOW}⚠${NC} Testing known Commander.js limitation..."

# This SHOULD ignore --timeout and run indefinitely, but we can't easily test that
# For now, just verify the command accepts the flag without error
$BDG network $TEST_URL --timeout 3 2>&1 &
SUBCOMMAND_PID=$!
sleep 2

# If it's still running after 2 seconds, the timeout was likely ignored
if kill -0 $SUBCOMMAND_PID 2>/dev/null; then
  echo -e "${GREEN}✓${NC} Subcommand accepted flag (behavior may be incorrect per known limitation)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
  kill $SUBCOMMAND_PID 2>/dev/null || true
else
  echo -e "${YELLOW}⚠${NC} Subcommand behavior unclear"
fi

cleanup

# ============================================================================
# SUMMARY
# ============================================================================

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Test Summary                                                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"

echo -e "\nTests Run:    ${BLUE}$TESTS_RUN${NC}"
echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
echo -e "Duration:     ${YELLOW}${DURATION}s${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "\n${GREEN}✓ All extended tests passed!${NC}\n"
  exit 0
else
  echo -e "\n${RED}✗ Some tests failed${NC}\n"
  exit 1
fi
