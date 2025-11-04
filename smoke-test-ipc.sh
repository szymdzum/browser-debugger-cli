#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
log_test() {
  echo -e "${YELLOW}[TEST $((TESTS_RUN + 1))]${NC} $1"
  TESTS_RUN=$((TESTS_RUN + 1))
}

log_pass() {
  echo -e "${GREEN}✓ PASS:${NC} $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

log_fail() {
  echo -e "${RED}✗ FAIL:${NC} $1"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

log_info() {
  echo -e "${YELLOW}ℹ${NC} $1"
}

cleanup() {
  log_info "Cleaning up test environment..."

  # Stop daemon if running
  if [ -f ~/.bdg/daemon.pid ]; then
    DAEMON_PID=$(cat ~/.bdg/daemon.pid 2>/dev/null || echo "")
    if [ -n "$DAEMON_PID" ]; then
      kill -9 "$DAEMON_PID" 2>/dev/null || true
    fi
  fi

  # Stop any active session
  if [ -f ~/.bdg/session.pid ]; then
    SESSION_PID=$(cat ~/.bdg/session.pid 2>/dev/null || echo "")
    if [ -n "$SESSION_PID" ]; then
      kill -9 "$SESSION_PID" 2>/dev/null || true
    fi
  fi

  # Clean up session files
  rm -f ~/.bdg/daemon.pid
  rm -f ~/.bdg/daemon.sock
  rm -f ~/.bdg/session.*

  # Kill any lingering Chrome processes from tests
  pkill -f "chrome.*remote-debugging-port" 2>/dev/null || true

  log_info "Cleanup complete"
}

# Trap to ensure cleanup on exit
trap cleanup EXIT

# Start fresh
log_info "Starting IPC smoke tests..."
cleanup

# Build the project first
log_info "Building project..."
npm run build > /dev/null 2>&1

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  SMOKE TEST SUITE: IPC Architecture"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ============================================================================
# TEST 1: Daemon lifecycle - Start daemon
# ============================================================================
log_test "Daemon lifecycle - Start daemon"

# Start daemon in background
node dist/daemon.js > /tmp/daemon-stdout.log 2> /tmp/daemon-stderr.log &
DAEMON_PID=$!
sleep 2

# Check if daemon is running
if ps -p $DAEMON_PID > /dev/null 2>&1; then
  log_pass "Daemon started successfully (PID: $DAEMON_PID)"
else
  log_fail "Daemon failed to start"
  cat /tmp/daemon-stderr.log
  exit 1
fi

# Check if socket file exists
if [ -S ~/.bdg/daemon.sock ]; then
  log_pass "Daemon socket created at ~/.bdg/daemon.sock"
else
  log_fail "Daemon socket not found"
  exit 1
fi

# Check if PID file exists
if [ -f ~/.bdg/daemon.pid ]; then
  STORED_PID=$(cat ~/.bdg/daemon.pid)
  if [ "$STORED_PID" == "$DAEMON_PID" ]; then
    log_pass "Daemon PID file correct ($STORED_PID)"
  else
    log_fail "Daemon PID mismatch (expected: $DAEMON_PID, got: $STORED_PID)"
  fi
else
  log_fail "Daemon PID file not created"
fi

echo ""

# ============================================================================
# TEST 2: IPC handshake
# ============================================================================
log_test "IPC handshake protocol"

# Create test client script
cat > /tmp/test-handshake.js << 'EOF'
const net = require('net');
const socket = net.createConnection({ path: process.env.HOME + '/.bdg/daemon.sock' });

socket.on('connect', () => {
  const request = { type: 'handshake_request', sessionId: 'test-123' };
  socket.write(JSON.stringify(request) + '\n');
});

socket.on('data', (data) => {
  const response = JSON.parse(data.toString());
  console.log(JSON.stringify(response, null, 2));
  socket.end();
});

socket.on('error', (err) => {
  console.error('Socket error:', err.message);
  process.exit(1);
});
EOF

# Run handshake test
HANDSHAKE_RESULT=$(node /tmp/test-handshake.js 2>&1)
if echo "$HANDSHAKE_RESULT" | grep -q '"status": "ok"'; then
  log_pass "Handshake successful"
  if echo "$HANDSHAKE_RESULT" | grep -q '"sessionId": "test-123"'; then
    log_pass "Session ID echoed correctly"
  else
    log_fail "Session ID not echoed in response"
  fi
else
  log_fail "Handshake failed"
  echo "$HANDSHAKE_RESULT"
fi

echo ""

# ============================================================================
# TEST 3: Status request (no active session)
# ============================================================================
log_test "Status request - No active session"

cat > /tmp/test-status.js << 'EOF'
const net = require('net');
const socket = net.createConnection({ path: process.env.HOME + '/.bdg/daemon.sock' });

socket.on('connect', () => {
  const request = { type: 'status_request', sessionId: 'status-test-1' };
  socket.write(JSON.stringify(request) + '\n');
});

socket.on('data', (data) => {
  const response = JSON.parse(data.toString());
  console.log(JSON.stringify(response, null, 2));
  socket.end();
});

socket.on('error', (err) => {
  console.error('Socket error:', err.message);
  process.exit(1);
});
EOF

STATUS_RESULT=$(node /tmp/test-status.js 2>&1)
if echo "$STATUS_RESULT" | grep -q '"status": "ok"'; then
  log_pass "Status request successful"

  if echo "$STATUS_RESULT" | grep -q '"daemonPid"'; then
    log_pass "Daemon PID included in status"
  else
    log_fail "Daemon PID missing from status"
  fi

  if echo "$STATUS_RESULT" | grep -q '"socketPath"'; then
    log_pass "Socket path included in status"
  else
    log_fail "Socket path missing from status"
  fi

  # Should NOT have sessionPid since no session is running
  if ! echo "$STATUS_RESULT" | grep -q '"sessionPid"'; then
    log_pass "No session PID (expected - no active session)"
  else
    log_fail "Unexpected session PID in response"
  fi
else
  log_fail "Status request failed"
  echo "$STATUS_RESULT"
fi

echo ""

# ============================================================================
# TEST 4: Start session via IPC
# ============================================================================
log_test "Start session via IPC"

cat > /tmp/test-start-session.js << 'EOF'
const net = require('net');
const socket = net.createConnection({ path: process.env.HOME + '/.bdg/daemon.sock' });

socket.on('connect', () => {
  const request = {
    type: 'start_session_request',
    sessionId: 'start-test-1',
    url: 'http://example.com',
    port: 9222,
    collectors: ['network', 'console'],
    includeAll: false
  };
  socket.write(JSON.stringify(request) + '\n');
});

let buffer = '';
socket.on('data', (data) => {
  buffer += data.toString();

  // Look for complete JSON response
  const lines = buffer.split('\n');
  for (const line of lines) {
    if (line.trim() && line.includes('start_session_response')) {
      const response = JSON.parse(line);
      console.log(JSON.stringify(response, null, 2));
      socket.end();
      process.exit(0);
    }
  }
});

socket.on('error', (err) => {
  console.error('Socket error:', err.message);
  process.exit(1);
});

// Timeout after 45 seconds (Chrome launch + CDP connection can be slow)
setTimeout(() => {
  console.error('Timeout waiting for start_session_response');
  process.exit(1);
}, 45000);
EOF

log_info "Starting session (this may take 30-45 seconds for Chrome launch)..."
START_RESULT=$(node /tmp/test-start-session.js 2>&1)

if echo "$START_RESULT" | grep -q '"status": "ok"'; then
  log_pass "Session started successfully"

  if echo "$START_RESULT" | grep -q '"workerPid"'; then
    WORKER_PID=$(echo "$START_RESULT" | grep -o '"workerPid": [0-9]*' | grep -o '[0-9]*')
    log_pass "Worker PID received: $WORKER_PID"
  else
    log_fail "Worker PID missing from response"
  fi

  if echo "$START_RESULT" | grep -q '"chromePid"'; then
    CHROME_PID=$(echo "$START_RESULT" | grep -o '"chromePid": [0-9]*' | grep -o '[0-9]*')
    log_pass "Chrome PID received: $CHROME_PID"
  else
    log_fail "Chrome PID missing from response"
  fi

  if echo "$START_RESULT" | grep -q '"targetUrl"'; then
    log_pass "Target URL included in response"
  else
    log_fail "Target URL missing from response"
  fi
else
  log_fail "Session start failed"
  echo "$START_RESULT"
  exit 1
fi

# Give worker time to stabilize
sleep 3

echo ""

# ============================================================================
# TEST 5: Status request (with active session)
# ============================================================================
log_test "Status request - With active session"

STATUS_WITH_SESSION=$(node /tmp/test-status.js 2>&1)

if echo "$STATUS_WITH_SESSION" | grep -q '"status": "ok"'; then
  log_pass "Status request successful"

  if echo "$STATUS_WITH_SESSION" | grep -q '"sessionPid"'; then
    SESSION_PID=$(echo "$STATUS_WITH_SESSION" | grep -o '"sessionPid": [0-9]*' | grep -o '[0-9]*')
    log_pass "Session PID included: $SESSION_PID"

    # Verify the process is actually running
    if ps -p $SESSION_PID > /dev/null 2>&1; then
      log_pass "Session process is running"
    else
      log_fail "Session process not found (PID: $SESSION_PID)"
    fi
  else
    log_fail "Session PID missing from status"
  fi

  if echo "$STATUS_WITH_SESSION" | grep -q '"sessionMetadata"'; then
    log_pass "Session metadata included in status"
  else
    log_fail "Session metadata missing from status"
  fi
else
  log_fail "Status request failed"
  echo "$STATUS_WITH_SESSION"
fi

echo ""

# ============================================================================
# TEST 6: Peek request (preview session data)
# ============================================================================
log_test "Peek request - Preview session data"

# Wait for preview data to be written (worker writes every 5 seconds)
log_info "Waiting 6 seconds for preview data to be written..."
sleep 6

cat > /tmp/test-peek.js << 'EOF'
const net = require('net');
const socket = net.createConnection({ path: process.env.HOME + '/.bdg/daemon.sock' });

socket.on('connect', () => {
  const request = { type: 'peek_request', sessionId: 'peek-test-1' };
  socket.write(JSON.stringify(request) + '\n');
});

let buffer = '';
socket.on('data', (data) => {
  buffer += data.toString();

  // Look for complete JSON response
  const lines = buffer.split('\n');
  for (const line of lines) {
    if (line.trim() && line.includes('peek_response')) {
      const response = JSON.parse(line);
      console.log(JSON.stringify(response, null, 2));
      socket.end();
      process.exit(0);
    }
  }
});

socket.on('error', (err) => {
  console.error('Socket error:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('Timeout waiting for peek_response');
  process.exit(1);
}, 10000);
EOF

PEEK_RESULT=$(node /tmp/test-peek.js 2>&1)

if echo "$PEEK_RESULT" | grep -q '"status": "ok"'; then
  log_pass "Peek request successful"

  if echo "$PEEK_RESULT" | grep -q '"preview"'; then
    log_pass "Preview data included in response"

    if echo "$PEEK_RESULT" | grep -q '"version"'; then
      log_pass "Preview includes version info"
    fi

    if echo "$PEEK_RESULT" | grep -q '"target"'; then
      log_pass "Preview includes target info"
    fi
  else
    log_fail "Preview data missing from response"
  fi
else
  log_fail "Peek request failed"
  echo "$PEEK_RESULT"
fi

echo ""

# ============================================================================
# TEST 7: Error case - Start session while one is already running
# ============================================================================
log_test "Error case - Start session while one is running"

START_DUPLICATE=$(node /tmp/test-start-session.js 2>&1)

if echo "$START_DUPLICATE" | grep -q '"status": "error"'; then
  log_pass "Error returned for duplicate session start"

  if echo "$START_DUPLICATE" | grep -q '"errorCode": "SESSION_ALREADY_RUNNING"'; then
    log_pass "Correct error code: SESSION_ALREADY_RUNNING"
  else
    log_fail "Wrong error code in response"
  fi
else
  log_fail "Should have returned error for duplicate session"
  echo "$START_DUPLICATE"
fi

echo ""

# ============================================================================
# TEST 8: Stop session via IPC
# ============================================================================
log_test "Stop session via IPC"

cat > /tmp/test-stop-session.js << 'EOF'
const net = require('net');
const socket = net.createConnection({ path: process.env.HOME + '/.bdg/daemon.sock' });

socket.on('connect', () => {
  const request = { type: 'stop_session_request', sessionId: 'stop-test-1' };
  socket.write(JSON.stringify(request) + '\n');
});

socket.on('data', (data) => {
  const response = JSON.parse(data.toString());
  console.log(JSON.stringify(response, null, 2));
  socket.end();
});

socket.on('error', (err) => {
  console.error('Socket error:', err.message);
  process.exit(1);
});
EOF

STOP_RESULT=$(node /tmp/test-stop-session.js 2>&1)

if echo "$STOP_RESULT" | grep -q '"status": "ok"'; then
  log_pass "Session stopped successfully"

  if echo "$STOP_RESULT" | grep -q '"chromePid"'; then
    log_pass "Chrome PID included in stop response"
  fi

  # Wait for cleanup
  sleep 2

  # Verify session files are cleaned up
  if [ ! -f ~/.bdg/session.pid ]; then
    log_pass "Session PID file cleaned up"
  else
    log_fail "Session PID file still exists"
  fi

  if [ ! -f ~/.bdg/session.preview.json ]; then
    log_pass "Session preview file cleaned up"
  else
    log_fail "Session preview file still exists"
  fi
else
  log_fail "Session stop failed"
  echo "$STOP_RESULT"
fi

echo ""

# ============================================================================
# TEST 9: Error case - Stop when no session is running
# ============================================================================
log_test "Error case - Stop when no session is running"

STOP_NO_SESSION=$(node /tmp/test-stop-session.js 2>&1)

if echo "$STOP_NO_SESSION" | grep -q '"status": "error"'; then
  log_pass "Error returned when no session is running"

  if echo "$STOP_NO_SESSION" | grep -q '"errorCode": "NO_SESSION"'; then
    log_pass "Correct error code: NO_SESSION"
  else
    log_fail "Wrong error code in response"
  fi
else
  log_fail "Should have returned error for stop with no session"
  echo "$STOP_NO_SESSION"
fi

echo ""

# ============================================================================
# TEST 10: Peek when no session is running
# ============================================================================
log_test "Error case - Peek when no session is running"

PEEK_NO_SESSION=$(node /tmp/test-peek.js 2>&1)

if echo "$PEEK_NO_SESSION" | grep -q '"status": "error"'; then
  log_pass "Error returned when no session is running"

  if echo "$PEEK_NO_SESSION" | grep -q "No active session found"; then
    log_pass "Correct error message"
  fi
else
  log_fail "Should have returned error for peek with no session"
  echo "$PEEK_NO_SESSION"
fi

echo ""

# ============================================================================
# TEST 11: Daemon shutdown
# ============================================================================
log_test "Daemon shutdown and cleanup"

# Kill daemon
kill -TERM $DAEMON_PID 2>/dev/null || kill -9 $DAEMON_PID 2>/dev/null
sleep 1

# Check if daemon stopped
if ! ps -p $DAEMON_PID > /dev/null 2>&1; then
  log_pass "Daemon stopped successfully"
else
  log_fail "Daemon still running after SIGTERM"
fi

# Check if socket file is cleaned up
if [ ! -S ~/.bdg/daemon.sock ]; then
  log_pass "Daemon socket cleaned up"
else
  log_fail "Daemon socket still exists"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  TEST SUMMARY"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Total tests run: $TESTS_RUN"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}✗ Some tests failed${NC}"
  exit 1
fi
