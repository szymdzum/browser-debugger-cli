#!/usr/bin/env bash
# Agent Benchmark Suite Runner
#
# Runs all agent benchmark scenarios and generates a summary report
#
# Usage:
#   ./run-benchmark.sh [--scenario <name>] [--screenshot]
#
# Options:
#   --scenario <name>   Run specific scenario only
#   --screenshot        Capture screenshots during benchmarks
#   --verbose           Enable verbose output

set -euo pipefail

# Configuration
BENCHMARK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIOS_DIR="$BENCHMARK_DIR/scenarios"
RESULTS_DIR="$BENCHMARK_DIR/results"
LIB_DIR="$BENCHMARK_DIR/lib"

# Load helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"

# Create results directory
mkdir -p "$RESULTS_DIR"

# Parse arguments
SPECIFIC_SCENARIO=""
SCREENSHOT_MODE=0
VERBOSE=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --scenario)
      SPECIFIC_SCENARIO="$2"
      shift 2
      ;;
    --screenshot)
      SCREENSHOT_MODE=1
      export SCREENSHOT=1
      shift
      ;;
    --verbose)
      VERBOSE=1
      set -x
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Find all scenario scripts
if [ -n "$SPECIFIC_SCENARIO" ]; then
  SCENARIOS=("$SCENARIOS_DIR/${SPECIFIC_SCENARIO}.sh")
else
  mapfile -t SCENARIOS < <(find "$SCENARIOS_DIR" -name "*.sh" -type f | sort)
fi

# Validate scenarios exist
if [ ${#SCENARIOS[@]} -eq 0 ]; then
  log_error "No scenarios found in $SCENARIOS_DIR"
  exit 1
fi

# Banner
echo "======================================"
echo "  Agent Benchmark Suite"
echo "======================================"
echo "Scenarios to run: ${#SCENARIOS[@]}"
echo "Results directory: $RESULTS_DIR"
echo ""

# Track overall results
TOTAL_SCENARIOS=${#SCENARIOS[@]}
PASSED_SCENARIOS=0
FAILED_SCENARIOS=0
declare -a FAILED_SCENARIO_NAMES

# Run each scenario
for scenario_script in "${SCENARIOS[@]}"; do
  scenario_name=$(basename "$scenario_script" .sh)
  
  echo ""
  echo "--------------------------------------"
  log_info "Running scenario: $scenario_name"
  echo "--------------------------------------"
  
  # Run scenario and capture exit code
  if bash "$scenario_script"; then
    log_success "Scenario passed: $scenario_name"
    PASSED_SCENARIOS=$((PASSED_SCENARIOS + 1))
  else
    log_error "Scenario failed: $scenario_name"
    FAILED_SCENARIOS=$((FAILED_SCENARIOS + 1))
    FAILED_SCENARIO_NAMES+=("$scenario_name")
    
    # Continue running other scenarios even if one fails
    continue
  fi
done

# Generate summary report
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SUMMARY_FILE="$RESULTS_DIR/benchmark-summary-$TIMESTAMP.json"

cat > "$SUMMARY_FILE" <<EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "total_scenarios": $TOTAL_SCENARIOS,
  "passed": $PASSED_SCENARIOS,
  "failed": $FAILED_SCENARIOS,
  "pass_rate": $(awk "BEGIN {printf \"%.2f\", ($PASSED_SCENARIOS / $TOTAL_SCENARIOS) * 100}"),
  "failed_scenarios": [
EOF

# Add failed scenario names
for i in "${!FAILED_SCENARIO_NAMES[@]}"; do
  echo -n "    \"${FAILED_SCENARIO_NAMES[$i]}\"" >> "$SUMMARY_FILE"
  if [ $i -lt $((${#FAILED_SCENARIO_NAMES[@]} - 1)) ]; then
    echo "," >> "$SUMMARY_FILE"
  else
    echo "" >> "$SUMMARY_FILE"
  fi
done

cat >> "$SUMMARY_FILE" <<EOF
  ],
  "individual_results": [
EOF

# Aggregate individual results
FIRST=true
for result_file in "$RESULTS_DIR"/*-result.json; do
  if [ -f "$result_file" ]; then
    if [ "$FIRST" = false ]; then
      echo "," >> "$SUMMARY_FILE"
    fi
    FIRST=false
    cat "$result_file" | jq -c '.' >> "$SUMMARY_FILE"
  fi
done

cat >> "$SUMMARY_FILE" <<EOF

  ]
}
EOF

# Print summary
echo ""
echo "======================================"
echo "  Benchmark Summary"
echo "======================================"
echo "Total scenarios: $TOTAL_SCENARIOS"
echo "Passed: $PASSED_SCENARIOS"
echo "Failed: $FAILED_SCENARIOS"
echo "Pass rate: $(awk "BEGIN {printf \"%.2f\", ($PASSED_SCENARIOS / $TOTAL_SCENARIOS) * 100}")%"
echo ""

if [ $FAILED_SCENARIOS -gt 0 ]; then
  echo "Failed scenarios:"
  for name in "${FAILED_SCENARIO_NAMES[@]}"; do
    echo "  - $name"
  done
  echo ""
fi

log_success "Summary saved to: $SUMMARY_FILE"

# Exit with error if any scenario failed
if [ $FAILED_SCENARIOS -gt 0 ]; then
  exit 1
fi

exit 0
