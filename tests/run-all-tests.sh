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
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--benchmark|--integration|--errors]"
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
  for test_script in "${TESTS[@]}"; do
    test_name=$(basename "$test_script" .sh)
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    echo -e "${BLUE}Running: $test_name${NC}"

    # Run test and capture exit code
    if bash "$test_script" > "$RESULTS_DIR/${test_name}.log" 2>&1; then
      echo -e "${GREEN}✓ PASSED: $test_name${NC}"
      PASSED_TESTS=$((PASSED_TESTS + 1))
    else
      echo -e "${RED}✗ FAILED: $test_name${NC}"
      FAILED_TESTS=$((FAILED_TESTS + 1))
      FAILED_TEST_NAMES+=("$test_name")

      # Show last few lines of output
      echo -e "${YELLOW}Last 10 lines of output:${NC}"
      tail -10 "$RESULTS_DIR/${test_name}.log"
    fi

    echo ""
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
  run_test_suite "Error Scenarios (Edge Cases)" "$TESTS_DIR/error-scenarios" "*.sh"
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
