#!/usr/bin/env bash
# Master Test Runner
#
# Runs all test suites in order:
# 1. Agent benchmarks (E2E scenarios)
# 2. Integration tests (command testing)
# 3. Error scenario tests (edge cases)
#
# Usage:
#   ./run-all-tests.sh              # Run all tests
#   ./run-all-tests.sh --verbose    # Run all tests with real-time output
#   ./run-all-tests.sh --benchmark  # Only benchmarks
#   ./run-all-tests.sh --integration # Only integration
#   ./run-all-tests.sh --errors     # Only error scenarios

set -euo pipefail

# Configuration
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$TESTS_DIR/results"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
RUN_BENCHMARKS=true
RUN_INTEGRATION=true
RUN_ERRORS=true
RUN_EDGE_CASES=true
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --benchmark)
      RUN_INTEGRATION=false
      RUN_ERRORS=false
      shift
      ;;
    --integration)
      RUN_BENCHMARKS=false
      RUN_ERRORS=false
      shift
      ;;
    --errors)
      RUN_BENCHMARKS=false
      RUN_INTEGRATION=false
      RUN_EDGE_CASES=false
      shift
      ;;
    --edge-cases)
      RUN_BENCHMARKS=false
      RUN_INTEGRATION=false
      RUN_ERRORS=false
      shift
      ;;
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--benchmark|--integration|--errors|--verbose]"
      exit 1
      ;;
  esac
done

# Create results directory
mkdir -p "$RESULTS_DIR"

# Track results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
declare -a FAILED_TEST_NAMES

# Helper function to run test suite
run_test_suite() {
  local suite_name="$1"
  local suite_dir="$2"
  local pattern="${3:-*.sh}"

  echo ""
  echo -e "${BLUE}======================================"
  echo "  Running: $suite_name"
  echo -e "======================================${NC}"
  echo ""

  # Find all test scripts
  mapfile -t TESTS < <(find "$suite_dir" -name "$pattern" -type f | sort)

  if [ ${#TESTS[@]} -eq 0 ]; then
    echo -e "${YELLOW}No tests found in $suite_dir${NC}"
    return 0
  fi

  echo "Found ${#TESTS[@]} test(s)"
  echo ""

  # Run each test
  local test_index=0
  for test_script in "${TESTS[@]}"; do
    test_name=$(basename "$test_script" .sh)
    test_index=$((test_index + 1))
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    echo -e "${BLUE}[$test_index/${#TESTS[@]}] Running: $test_name${NC}"

    # Run test with or without verbose output
    if [ "$VERBOSE" = true ]; then
      # Verbose mode: show output in real-time AND save to log
      if bash "$test_script" 2>&1 | tee "$RESULTS_DIR/${test_name}.log"; then
        echo -e "${GREEN}       ✓ PASSED: $test_name${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
      else
        echo -e "${RED}       ✗ FAILED: $test_name${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        FAILED_TEST_NAMES+=("$test_name")
      fi
    else
      # Normal mode: save to log only, show summary with spinner
      {
        bash "$test_script" > "$RESULTS_DIR/${test_name}.log" 2>&1
      } &
      TEST_PID=$!
      
      # Spinner while test runs
      local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
      local i=0
      while kill -0 $TEST_PID 2>/dev/null; do
        i=$(( (i+1) %10 ))
        printf "\r       ${BLUE}${spin:$i:1} Testing...${NC}"
        sleep 0.1
      done
      
      # Clear spinner line
      printf "\r"
      
      # Check result
      if wait $TEST_PID; then
        echo -e "       ${GREEN}✓ PASSED: $test_name${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
      else
        echo -e "       ${RED}✗ FAILED: $test_name${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        FAILED_TEST_NAMES+=("$test_name")

        # Show last few lines of output
        echo -e "${YELLOW}       Last 10 lines of output:${NC}"
        tail -10 "$RESULTS_DIR/${test_name}.log" | sed 's/^/       /'
      fi
    fi

    echo ""

    # Add delay between tests to ensure cleanup completes
    # This prevents race conditions when tests run sequentially
    if [ $test_index -lt ${#TESTS[@]} ]; then
      sleep 1
    fi
  done
}

# Banner
echo -e "${BLUE}======================================"
echo "  Browser Debugger CLI Test Suite"
echo -e "======================================${NC}"
echo "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo ""

# Run test suites
if [ "$RUN_BENCHMARKS" = true ]; then
  run_test_suite "Agent Benchmarks (E2E)" "$TESTS_DIR/agent-benchmark/scenarios" "*.sh"
fi

if [ "$RUN_INTEGRATION" = true ]; then
  run_test_suite "Integration Tests (Commands)" "$TESTS_DIR/integration" "*.test.sh"
fi

if [ "$RUN_ERRORS" = true ]; then
  run_test_suite "Error Scenarios" "$TESTS_DIR/error-scenarios" "*.sh"
fi

if [ "$RUN_EDGE_CASES" = true ]; then
  run_test_suite "Edge Cases (URL Handling, etc.)" "$TESTS_DIR/edge-cases" "*.sh"
fi

# Summary
echo ""
echo -e "${BLUE}======================================"
echo "  Test Summary"
echo -e "======================================${NC}"
echo "Total tests:  $TOTAL_TESTS"
echo -e "${GREEN}Passed:       $PASSED_TESTS${NC}"
if [ $FAILED_TESTS -gt 0 ]; then
  echo -e "${RED}Failed:       $FAILED_TESTS${NC}"
else
  echo "Failed:       $FAILED_TESTS"
fi

PASS_RATE=$(awk "BEGIN {printf \"%.1f\", ($PASSED_TESTS / $TOTAL_TESTS) * 100}")
echo "Pass rate:    ${PASS_RATE}%"
echo ""

if [ $FAILED_TESTS -gt 0 ]; then
  echo -e "${RED}Failed tests:${NC}"
  for name in "${FAILED_TEST_NAMES[@]}"; do
    echo "  - $name (see $RESULTS_DIR/${name}.log)"
  done
  echo ""
fi

echo "Full logs available in: $RESULTS_DIR"
echo ""

# Exit with error if any tests failed
if [ $FAILED_TESTS -gt 0 ]; then
  exit 1
fi

echo -e "${GREEN}All tests passed!${NC}"
exit 0
