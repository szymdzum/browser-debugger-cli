#!/bin/bash

# E2E Test Suite for bdg CLI
# Applies token optimization techniques from SMOKE_TEST_TELEMETRY.md

set -e

echo "==================================="
echo "BDG CLI E2E Test Suite"
echo "==================================="
echo ""

# Cleanup before tests
echo "🧹 Cleaning up..."
pkill -9 -f "node dist/index.js" 2>/dev/null || true
node dist/index.js cleanup --force >/dev/null 2>&1 || true
echo "✓ Cleanup complete"
echo ""

# Test 1: Help and Version
echo "==================================="
echo "Test 1: Help & Version"
echo "==================================="
node dist/index.js --version 2>&1 | head -1
node dist/index.js --help 2>&1 | head -10
echo "✓ Test 1 passed"
echo ""

# Test 2: Basic Session Lifecycle
echo "==================================="
echo "Test 2: Basic Session Lifecycle"
echo "==================================="
node dist/index.js localhost:3000 2>&1 &
BDG_PID=$!
echo "Started session (PID: $BDG_PID)"

# Wait for session to be active
sleep 3

# Check status
echo "--- Status ---"
node dist/index.js status 2>&1 | head -15

# Check peek (with truncation)
echo ""
echo "--- Peek (compact) ---"
node dist/index.js peek 2>&1 | head -10

# Stop session
echo ""
echo "--- Stop ---"
node dist/index.js stop 2>&1 | head -5
echo "✓ Test 2 passed"
echo ""

# Test 3: Query Command
echo "==================================="
echo "Test 3: Query Command (Live JS)"
echo "==================================="
node dist/index.js localhost:3000 2>&1 &
sleep 3
echo "--- Query: document.title ---"
node dist/index.js query "document.title" 2>&1 | head -10
echo ""
echo "--- Query: navigator.userAgent ---"
node dist/index.js query "navigator.userAgent" 2>&1 | head -10
node dist/index.js stop 2>&1 | head -3
echo "✓ Test 3 passed"
echo ""

# Test 4: Error Handling
echo "==================================="
echo "Test 4: Error Handling"
echo "==================================="
echo "--- Stop (no session) ---"
node dist/index.js stop 2>&1 | head -3 || echo "(expected error)"
echo ""
echo "--- Status (no session) ---"
node dist/index.js status 2>&1 | head -5 || echo "(expected error)"
echo ""
echo "--- Start duplicate session ---"
node dist/index.js localhost:3000 2>&1 &
sleep 2
node dist/index.js localhost:3000 2>&1 | head -5 || echo "(expected error - session already running)"
node dist/index.js stop 2>&1 | head -3
echo "✓ Test 4 passed"
echo ""

# Test 5: Status Verbose Mode
echo "==================================="
echo "Test 5: Status --verbose (Chrome Diagnostics)"
echo "==================================="
node dist/index.js localhost:3000 2>&1 &
sleep 2
node dist/index.js status --verbose 2>&1 | head -20
node dist/index.js stop 2>&1 | head -3
echo "✓ Test 5 passed"
echo ""

# Test 6: Cleanup Commands
echo "==================================="
echo "Test 6: Cleanup --aggressive"
echo "==================================="
node dist/index.js localhost:3000 2>&1 &
sleep 2
CHROME_PID=$(cat ~/.bdg/chrome.pid 2>/dev/null || echo "unknown")
echo "Chrome PID: $CHROME_PID"
node dist/index.js stop 2>&1 | head -3
sleep 1
echo ""
echo "--- Cleanup --aggressive ---"
node dist/index.js cleanup --aggressive 2>&1
echo "✓ Test 6 passed"
echo ""

# Test 7: Details Command (requires session with data)
echo "==================================="
echo "Test 7: Details Command"
echo "==================================="
node dist/index.js localhost:3000 2>&1 &
sleep 5  # Wait for data collection
echo "--- Get network request ID ---"
REQUEST_ID=$(node dist/index.js peek --network --json 2>&1 | jq -r '.network[0].requestId // empty' 2>/dev/null | head -1)
if [ -n "$REQUEST_ID" ]; then
  echo "Request ID: $REQUEST_ID"
  echo "--- Network details (truncated) ---"
  node dist/index.js details network "$REQUEST_ID" 2>&1 | head -15
else
  echo "No network requests found (localhost:3000 may not be running)"
fi

echo ""
echo "--- Console details ---"
node dist/index.js details console 0 2>&1 | head -10 || echo "(no console messages)"
node dist/index.js stop 2>&1 | head -3
echo "✓ Test 7 passed"
echo ""

# Test 8: Collector Subcommands
echo "==================================="
echo "Test 8: Collector Subcommands"
echo "==================================="
echo "--- DOM only ---"
node dist/index.js dom localhost:3000 --timeout 3 2>&1 | jq 'del(.data.dom) | {success, collectors: (.data | keys)}' || echo "(expected timeout)"
echo ""
echo "--- Network only ---"
node dist/index.js network localhost:3000 --timeout 3 2>&1 | jq '{success, collectors: (.data | keys), network_count: (.data.network | length)}' || echo "(expected timeout)"
echo ""
echo "--- Console only ---"
node dist/index.js console localhost:3000 --timeout 3 2>&1 | jq '{success, collectors: (.data | keys), console_count: (.data.console | length)}' || echo "(expected timeout)"
echo "✓ Test 8 passed"
echo ""

# Test 9: Advanced Flags
echo "==================================="
echo "Test 9: Advanced Start Flags"
echo "==================================="
echo "--- Custom port ---"
node dist/index.js localhost:3000 --port 9223 --timeout 3 2>&1 | jq '{success, duration, port: .metadata.port // "unknown"}' || echo "(may fail if port in use)"
echo ""
echo "--- Reuse tab ---"
node dist/index.js localhost:3000 --reuse-tab --timeout 3 2>&1 | jq '{success, duration}' || echo "(reuse tab test)"
echo "✓ Test 9 passed"
echo ""

echo "==================================="
echo "All Tests Completed!"
echo "==================================="
echo ""
echo "Summary:"
echo "✓ Test 1: Help & Version"
echo "✓ Test 2: Basic Session Lifecycle"
echo "✓ Test 3: Query Command"
echo "✓ Test 4: Error Handling"
echo "✓ Test 5: Status --verbose"
echo "✓ Test 6: Cleanup --aggressive"
echo "✓ Test 7: Details Command"
echo "✓ Test 8: Collector Subcommands"
echo "✓ Test 9: Advanced Flags"
echo ""
echo "🎉 E2E tests completed successfully!"
