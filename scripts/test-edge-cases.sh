#!/usr/bin/env bash
#
# Edge Case Test Suite - IPC Protocol & Daemon Robustness
#
# Tests strange scenarios, race conditions, and protocol edge cases
# to ensure the daemon and IPC system handle all failure modes gracefully.

set -u  # Unset variables are errors (but NOT -e, we want to test failures)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
PASSED=0
FAILED=0
WARNINGS=0

# Test result functions
pass() {
  echo -e "${GREEN}✓${NC} $1"
  ((PASSED++))
}

fail() {
  echo -e "${RED}✗${NC} $1"
  ((FAILED++))
}

warn() {
  echo -e "${YELLOW}⚠${NC} $1"
  ((WARNINGS++))
}

section() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

cleanup() {
  echo ""
  echo "Cleaning up..."
  bdg stop > /dev/null 2>&1
  pkill -f "bdg http" > /dev/null 2>&1
  pkill -f daemon > /dev/null 2>&1
  sleep 2
  rm -f ~/.bdg/session.* ~/.bdg/daemon.* ~/.bdg/chrome.pid 2>/dev/null
}

# Cleanup before starting
cleanup

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}IPC EDGE CASE TEST SUITE${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "Testing protocol robustness, race conditions, and failure modes"
echo ""

# ============================================================================
section "1. CONCURRENT SESSION STARTS"
# ============================================================================

# Test 1.1: Two simultaneous session starts (race condition)
echo "Test 1.1: Starting two sessions simultaneously..."
bdg http://localhost:8989 > /tmp/session1.log 2>&1 &
PID1=$!
bdg http://localhost:8989 > /tmp/session2.log 2>&1 &
PID2=$!
sleep 5

# Check if only one session is running
SESSION_COUNT=$(ps -p $PID1,$PID2 2>/dev/null | grep -c "bdg")
if [ "$SESSION_COUNT" -eq 1 ]; then
  pass "Only one session started (race condition handled)"
else
  fail "Both sessions started (race condition NOT handled)"
fi

# Check error message in the failed session
if grep -q "already running" /tmp/session1.log /tmp/session2.log 2>/dev/null; then
  pass "Second session got 'already running' error"
else
  fail "No clear error message for concurrent start"
fi

cleanup

# Test 1.2: Start session while previous is stopping
echo ""
echo "Test 1.2: Starting new session while previous is stopping..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3
bdg stop > /dev/null 2>&1 &
sleep 0.5  # Race: start new session while stop is in progress
bdg http://localhost:8989 > /tmp/race.log 2>&1 &
sleep 5

if bdg status 2>&1 | grep -q "ACTIVE"; then
  pass "New session started after stop"
else
  warn "New session failed to start (might be timing-dependent)"
fi

cleanup

# ============================================================================
section "2. DAEMON LIFECYCLE EDGE CASES"
# ============================================================================

# Test 2.1: Multiple clients connecting simultaneously
echo "Test 2.1: Multiple clients connecting to daemon..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

# Fire off 5 concurrent peek requests
for i in {1..5}; do
  bdg peek > /tmp/peek_$i.log 2>&1 &
done
wait

# Check if all peeks succeeded
PEEK_SUCCESS=0
for i in {1..5}; do
  if grep -q "PREVIEW" /tmp/peek_$i.log 2>/dev/null; then
    ((PEEK_SUCCESS++))
  fi
done

if [ "$PEEK_SUCCESS" -eq 5 ]; then
  pass "All 5 concurrent peeks succeeded"
elif [ "$PEEK_SUCCESS" -ge 3 ]; then
  warn "Only $PEEK_SUCCESS/5 peeks succeeded (acceptable)"
else
  fail "Most concurrent peeks failed ($PEEK_SUCCESS/5)"
fi

cleanup

# Test 2.2: Daemon socket file corruption
echo ""
echo "Test 2.2: Daemon socket file deleted while running..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

# Delete socket file while daemon is running
rm -f ~/.bdg/daemon.sock 2>/dev/null

# Try to connect
if bdg peek 2>&1 | grep -q -E "(cannot connect|ENOENT|not running)"; then
  pass "Client detected socket deletion"
else
  warn "Client behavior unclear when socket deleted"
fi

cleanup

# Test 2.3: Stale daemon PID file (process dead but PID file exists)
echo ""
echo "Test 2.3: Stale daemon PID file..."
echo "99999" > ~/.bdg/daemon.pid  # Fake PID

if bdg status 2>&1 | grep -q "Daemon not running"; then
  pass "Detected stale daemon PID"
else
  fail "Did not detect stale daemon PID"
fi

rm -f ~/.bdg/daemon.pid
cleanup

# ============================================================================
section "3. SESSION LIFECYCLE EDGE CASES"
# ============================================================================

# Test 3.1: Kill worker process but leave daemon running
echo "Test 3.1: Worker process killed unexpectedly..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

WORKER_PID=$(cat ~/.bdg/session.pid 2>/dev/null)
if [ -n "$WORKER_PID" ]; then
  kill -9 $WORKER_PID 2>/dev/null
  sleep 2
  
  # Try to peek after worker died
  if bdg peek 2>&1 | grep -q -E "(No active|Error|not running)"; then
    pass "Detected dead worker process"
  else
    warn "Peek behavior unclear after worker death"
  fi
else
  warn "Could not find worker PID"
fi

cleanup

# Test 3.2: Session metadata file corrupted
echo ""
echo "Test 3.2: Corrupted session metadata..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

# Corrupt the metadata file
echo "INVALID JSON{{{" > ~/.bdg/session.meta.json

# Try to get status
if bdg status 2>&1 | grep -q -E "(Error|corrupted|invalid)"; then
  pass "Handled corrupted metadata gracefully"
else
  warn "Status command succeeded despite corrupted metadata"
fi

cleanup

# Test 3.3: Chrome process killed but worker still running
echo ""
echo "Test 3.3: Chrome killed but worker remains..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 5

CHROME_PID=$(ps aux | grep -i "chrome.*remote-debugging" | grep -v grep | awk '{print $2}' | head -1)
if [ -n "$CHROME_PID" ]; then
  kill -9 $CHROME_PID 2>/dev/null
  sleep 2
  
  # Worker should detect Chrome death and exit
  WORKER_PID=$(cat ~/.bdg/session.pid 2>/dev/null)
  if [ -n "$WORKER_PID" ] && ! ps -p $WORKER_PID > /dev/null 2>&1; then
    pass "Worker detected Chrome death and exited"
  else
    warn "Worker still running after Chrome death"
  fi
else
  warn "Could not find Chrome process"
fi

cleanup

# ============================================================================
section "4. IPC PROTOCOL EDGE CASES"
# ============================================================================

# Test 4.1: Malformed IPC messages
echo "Test 4.1: Sending malformed JSON to daemon..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

# Send invalid JSON via socket
echo "INVALID_JSON{{{" | nc -U ~/.bdg/daemon.sock 2>/dev/null
sleep 1

# Daemon should still be alive
DAEMON_PID=$(cat ~/.bdg/daemon.pid 2>/dev/null)
if [ -n "$DAEMON_PID" ] && ps -p $DAEMON_PID > /dev/null 2>&1; then
  pass "Daemon survived malformed message"
else
  fail "Daemon crashed on malformed message"
fi

cleanup

# Test 4.2: Very large peek request (stress test)
echo ""
echo "Test 4.2: Large peek request (1000 items)..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

# Generate lots of console logs
for i in {1..100}; do
  bdg query "console.log('test $i')" > /dev/null 2>&1
done
sleep 2

# Try to peek all items
START=$(date +%s%N)
bdg peek --last 1000 > /dev/null 2>&1
END=$(date +%s%N)
DURATION=$(( (END - START) / 1000000 ))

if [ "$DURATION" -lt 5000 ]; then
  pass "Large peek completed in ${DURATION}ms"
else
  warn "Large peek slow: ${DURATION}ms"
fi

cleanup

# Test 4.3: Rapid connect/disconnect cycles
echo ""
echo "Test 4.3: Rapid connect/disconnect cycles..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

# Open and close 20 connections rapidly
SUCCESS=0
for i in {1..20}; do
  if timeout 2 bdg peek > /dev/null 2>&1; then
    ((SUCCESS++))
  fi
done

if [ "$SUCCESS" -ge 15 ]; then
  pass "Rapid connections handled ($SUCCESS/20 succeeded)"
elif [ "$SUCCESS" -ge 10 ]; then
  warn "Some rapid connections failed ($SUCCESS/20)"
else
  fail "Most rapid connections failed ($SUCCESS/20)"
fi

cleanup

# Test 4.4: IPC timeout (worker not responding)
echo ""
echo "Test 4.4: IPC request timeout..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

# Suspend worker process to simulate hang
WORKER_PID=$(cat ~/.bdg/session.pid 2>/dev/null)
if [ -n "$WORKER_PID" ]; then
  kill -STOP $WORKER_PID 2>/dev/null
  
  # Try peek (should timeout)
  START=$(date +%s)
  timeout 10 bdg peek 2>&1 | grep -q "timeout" && TIMEOUT_DETECTED=1 || TIMEOUT_DETECTED=0
  END=$(date +%s)
  
  # Resume worker
  kill -CONT $WORKER_PID 2>/dev/null
  
  if [ "$TIMEOUT_DETECTED" -eq 1 ]; then
    pass "IPC timeout detected and handled"
  else
    DURATION=$((END - START))
    if [ "$DURATION" -ge 5 ] && [ "$DURATION" -le 7 ]; then
      pass "Timeout occurred after ${DURATION}s (expected ~5s)"
    else
      warn "Timeout behavior unclear (took ${DURATION}s)"
    fi
  fi
else
  warn "Could not find worker PID for timeout test"
fi

cleanup

# ============================================================================
section "5. CLEANUP & RESOURCE MANAGEMENT"
# ============================================================================

# Test 5.1: File descriptor leaks
echo "Test 5.1: File descriptor leak check..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

DAEMON_PID=$(cat ~/.bdg/daemon.pid 2>/dev/null)
if [ -n "$DAEMON_PID" ]; then
  FD_COUNT_BEFORE=$(lsof -p $DAEMON_PID 2>/dev/null | wc -l)
  
  # Generate 50 peek requests
  for i in {1..50}; do
    bdg peek > /dev/null 2>&1
  done
  
  FD_COUNT_AFTER=$(lsof -p $DAEMON_PID 2>/dev/null | wc -l)
  FD_DIFF=$((FD_COUNT_AFTER - FD_COUNT_BEFORE))
  
  if [ "$FD_DIFF" -le 5 ]; then
    pass "No significant FD leak (diff: $FD_DIFF)"
  else
    fail "Potential FD leak detected (diff: $FD_DIFF)"
  fi
else
  warn "Could not find daemon PID for FD leak test"
fi

cleanup

# Test 5.2: Memory leak check (simple version)
echo ""
echo "Test 5.2: Memory usage stability..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

WORKER_PID=$(cat ~/.bdg/session.pid 2>/dev/null)
if [ -n "$WORKER_PID" ]; then
  MEM_BEFORE=$(ps -o rss= -p $WORKER_PID 2>/dev/null)
  
  # Generate lots of data
  for i in {1..100}; do
    bdg query "console.log('test $i')" > /dev/null 2>&1
    bdg peek > /dev/null 2>&1
  done
  
  MEM_AFTER=$(ps -o rss= -p $WORKER_PID 2>/dev/null)
  MEM_DIFF=$((MEM_AFTER - MEM_BEFORE))
  MEM_DIFF_MB=$((MEM_DIFF / 1024))
  
  if [ "$MEM_DIFF_MB" -le 50 ]; then
    pass "Memory stable (grew ${MEM_DIFF_MB}MB)"
  else
    warn "Memory grew significantly (${MEM_DIFF_MB}MB)"
  fi
else
  warn "Could not find worker PID for memory test"
fi

cleanup

# Test 5.3: Cleanup after crash
echo ""
echo "Test 5.3: Cleanup after crash..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

# Kill worker brutally
WORKER_PID=$(cat ~/.bdg/session.pid 2>/dev/null)
if [ -n "$WORKER_PID" ]; then
  kill -9 $WORKER_PID 2>/dev/null
  sleep 2
  
  # Try bdg cleanup
  bdg cleanup > /dev/null 2>&1
  
  # Check if files are cleaned up
  FILES_REMAINING=0
  [ -f ~/.bdg/session.pid ] && ((FILES_REMAINING++))
  [ -f ~/.bdg/session.meta.json ] && ((FILES_REMAINING++))
  
  if [ "$FILES_REMAINING" -eq 0 ]; then
    pass "Cleanup removed stale files"
  else
    warn "Some files remain after cleanup ($FILES_REMAINING files)"
  fi
else
  warn "Could not find worker PID for cleanup test"
fi

cleanup

# ============================================================================
section "6. EDGE CASE INPUTS"
# ============================================================================

# Test 6.1: Invalid URLs
echo "Test 6.1: Starting session with invalid URL..."
if bdg "not-a-url" 2>&1 | grep -q -E "(Error|Invalid|malformed)"; then
  pass "Invalid URL rejected"
else
  warn "Invalid URL handling unclear"
fi

# Test 6.2: Peek with extreme lastN values
echo ""
echo "Test 6.2: Peek with extreme lastN values..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

# Very large lastN
if timeout 5 bdg peek --last 999999 > /dev/null 2>&1; then
  pass "Large lastN handled"
else
  warn "Large lastN caused timeout or error"
fi

# Negative lastN
if bdg peek --last -1 2>&1 | grep -q -E "(Error|Invalid|positive)"; then
  pass "Negative lastN rejected"
else
  warn "Negative lastN not validated"
fi

cleanup

# Test 6.3: Details with non-existent IDs
echo ""
echo "Test 6.3: Details with extreme IDs..."

bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

# Very long ID
LONG_ID=$(printf 'x%.0s' {1..10000})
if timeout 5 bdg details network "$LONG_ID" 2>&1 | grep -q -E "(not found|Error)"; then
  pass "Long ID handled gracefully"
else
  warn "Long ID handling unclear"
fi

# Special characters in ID
if bdg details network "';DROP TABLE requests;--" 2>&1 | grep -q -E "(not found|Error)"; then
  pass "Special characters in ID handled"
else
  warn "Special characters handling unclear"
fi

cleanup

# ============================================================================
section "7. SIGNAL HANDLING"
# ============================================================================

# Test 7.1: SIGTERM to worker
echo "Test 7.1: SIGTERM to worker..."
bdg http://localhost:8989 > /dev/null 2>&1 &
sleep 3

WORKER_PID=$(cat ~/.bdg/session.pid 2>/dev/null)
if [ -n "$WORKER_PID" ]; then
  kill -TERM $WORKER_PID 2>/dev/null
  sleep 2
  
  # Check if output file was written
  if [ -f ~/.bdg/session.json ]; then
    pass "Worker wrote output on SIGTERM"
  else
    warn "No output file after SIGTERM"
  fi
else
  warn "Could not find worker PID"
fi

cleanup

# Test 7.2: SIGINT to CLI process
echo ""
echo "Test 7.2: SIGINT to CLI process..."
bdg http://localhost:8989 > /dev/null 2>&1 &
SESSION_PID=$!
sleep 3

kill -INT $SESSION_PID 2>/dev/null
sleep 2

# Check if graceful shutdown occurred
if [ -f ~/.bdg/session.json ]; then
  pass "Graceful shutdown on SIGINT"
else
  warn "No output file after SIGINT"
fi

cleanup

# ============================================================================
section "TEST SUMMARY"
# ============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results:"
echo "  Passed:   $PASSED"
echo "  Failed:   $FAILED"
echo "  Warnings: $WARNINGS"
echo "  Total:    $((PASSED + FAILED + WARNINGS))"
echo ""

if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}✓ All critical tests passed!${NC}"
  echo ""
  if [ "$WARNINGS" -gt 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS warnings - review recommended${NC}"
  fi
  exit 0
else
  echo -e "${RED}✗ $FAILED critical failures detected${NC}"
  echo ""
  exit 1
fi
