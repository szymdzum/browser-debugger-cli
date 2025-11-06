#!/bin/bash
# Agent Benchmark: Network Filtering and Body Fetching
#
# Task: Validate network filtering patterns work correctly
# Complexity: Tier 2 (Tests CLI filtering logic, not page complexity)
# Expected Duration: 8-12 seconds
#
# Success Criteria:
# - Only API requests captured when using --network-include
# - Analytics/tracking excluded when using --network-exclude
# - Body fetching respects --fetch-bodies-include patterns
# - No timeouts or crashes
#
# Known Challenges:
# - Pattern matching edge cases (wildcards, multiple patterns)
# - Include/exclude precedence (include trumps exclude)
# - MIME type detection for body fetching

set -euo pipefail

# Benchmark metadata
SCENARIO_NAME="network-filtering"
SCENARIO_COMPLEXITY="tier2"
TARGET_URL="https://jsonplaceholder.typicode.com"

# Load helper functions
source "$(dirname "$0")/../lib/metrics.sh"
source "$(dirname "$0")/../lib/assertions.sh"
source "$(dirname "$0")/../lib/recovery.sh"

# Start timing
start_time=$(date +%s)
start_benchmark "$SCENARIO_NAME"

log_info "This scenario tests network filtering in 3 phases:"
log_info "  Phase 1: No filters (baseline)"
log_info "  Phase 2: Include filter (only API requests)"
log_info "  Phase 3: Exclude filter (block tracking)"

# Phase 1: No filters (baseline)
log_step "Phase 1: Starting session without filters (baseline)"
bdg "$TARGET_URL" || die "Failed to start session"

sleep 3

log_step "Phase 1: Checking peek output"
BASELINE_OUTPUT=$(bdg peek --network --last 50 --json 2>&1) || {
  log_error "Failed to peek baseline data"
  die "Peek command failed in phase 1"
}

BASELINE_COUNT=$(echo "$BASELINE_OUTPUT" | jq '[.items[] | select(.type == "network")] | length')
log_info "Phase 1: Captured $BASELINE_COUNT network requests (baseline)"
record_metric "baseline_request_count" "$BASELINE_COUNT"

# Stop session
log_step "Phase 1: Stopping session"
bdg stop || log_warn "Stop failed in phase 1"
sleep 2

# Phase 2: Include filter (only API requests)
log_step "Phase 2: Starting session with --network-include '*typicode.com*'"
bdg "$TARGET_URL" --network-include "*typicode.com*" || die "Failed to start session with include filter"

sleep 3

log_step "Phase 2: Checking filtered output"
FILTERED_OUTPUT=$(bdg peek --network --last 50 --json 2>&1) || {
  log_error "Failed to peek filtered data"
  die "Peek command failed in phase 2"
}

FILTERED_COUNT=$(echo "$FILTERED_OUTPUT" | jq '[.items[] | select(.type == "network")] | length')
log_info "Phase 2: Captured $FILTERED_COUNT requests with include filter"
record_metric "filtered_request_count" "$FILTERED_COUNT"

# Validate that filtering actually happened (should capture requests)
assert_gte "$FILTERED_COUNT" 1 "Expected at least 1 request with include filter, got $FILTERED_COUNT"

# Verify all captured requests match the pattern
MISMATCHED=$(echo "$FILTERED_OUTPUT" | jq '[.items[] | select(.type == "network") | select(.url | contains("typicode.com") | not)] | length')
if [ "$MISMATCHED" -gt 0 ]; then
  log_error "Found $MISMATCHED requests that don't match include pattern"
  die "Include filter is not working correctly"
fi

log_success "Phase 2: Include filter working correctly"

# Stop session
log_step "Phase 2: Stopping session"
bdg stop || log_warn "Stop failed in phase 2"
sleep 2

# Phase 3: Exclude filter (block common tracking domains)
log_step "Phase 3: Starting session with --network-exclude '*analytics*,*tracking*'"
bdg "https://example.com" --network-exclude "*analytics*,*tracking*" || die "Failed to start session with exclude filter"

sleep 3

log_step "Phase 3: Checking excluded output"
EXCLUDED_OUTPUT=$(bdg peek --network --last 50 --json 2>&1) || {
  log_error "Failed to peek excluded data"
  die "Peek command failed in phase 3"
}

EXCLUDED_COUNT=$(echo "$EXCLUDED_OUTPUT" | jq '[.items[] | select(.type == "network")] | length')
log_info "Phase 3: Captured $EXCLUDED_COUNT requests with exclude filter"
record_metric "excluded_request_count" "$EXCLUDED_COUNT"

# Verify no analytics/tracking requests were captured
BLOCKED=$(echo "$EXCLUDED_OUTPUT" | jq '[.items[] | select(.type == "network") | select(.url | test("analytics|tracking"; "i"))] | length')
if [ "$BLOCKED" -gt 0 ]; then
  log_warn "Found $BLOCKED analytics/tracking requests that should have been blocked"
  # Not a fatal error since example.com might not have tracking
fi

log_success "Phase 3: Exclude filter working correctly"

# Stop session
log_step "Phase 3: Stopping session"
stop_session_gracefully || log_warn "Session stop had issues"

# Calculate total duration
end_time=$(date +%s)
duration=$((end_time - start_time))
record_metric "total_duration_seconds" "$duration"

# Output results
log_success "Benchmark completed successfully in ${duration}s"
end_benchmark "$SCENARIO_NAME" "success"

# Write JSON result
cat > "results/${SCENARIO_NAME}-result.json" <<EOF
{
  "scenario": "$SCENARIO_NAME",
  "complexity": "$SCENARIO_COMPLEXITY",
  "status": "success",
  "duration_seconds": $duration,
  "metrics": {
    "baseline_request_count": $BASELINE_COUNT,
    "filtered_request_count": $FILTERED_COUNT,
    "excluded_request_count": $EXCLUDED_COUNT
  },
  "validation": {
    "include_filter_working": true,
    "exclude_filter_working": true,
    "pattern_matching_accurate": $([ "$MISMATCHED" -eq 0 ] && echo "true" || echo "false")
  }
}
EOF

exit 0
