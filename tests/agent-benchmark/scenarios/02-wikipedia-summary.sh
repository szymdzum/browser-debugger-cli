#!/usr/bin/env bash
# Agent Benchmark: Wikipedia Article Summary
#
# Task: Extract first paragraph summary from a Wikipedia article
# Complexity: Tier 2 (Heavy DOM, some JavaScript)
# Expected Duration: 8-12 seconds
#
# Success Criteria:
# - Article title extracted
# - First paragraph (summary) extracted with ≥100 characters
# - No timeouts or crashes
#
# Known Challenges:
# - Large DOM (many script tags, references)
# - Multiple paragraphs to filter through
# - Dynamic elements (edit buttons, references)

set -euo pipefail

# Benchmark metadata
SCENARIO_NAME="wikipedia-summary"
SCENARIO_COMPLEXITY="tier2"
TARGET_URL="https://en.wikipedia.org/wiki/Web_scraping"

# Results directory
RESULTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/results"
mkdir -p "$RESULTS_DIR"
# Load helper functions
source "$(dirname "$0")/../lib/metrics.sh"
source "$(dirname "$0")/../lib/assertions.sh"
source "$(dirname "$0")/../lib/recovery.sh"

# Cleanup trap to prevent cascade failures
cleanup() {
  local exit_code=$?
  bdg stop 2>/dev/null || true
  sleep 0.5
  # Force kill any Chrome processes on port 9222
  lsof -ti:9222 | xargs kill -9 2>/dev/null || true
  sleep 0.5
  bdg cleanup --force 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# Start timing
start_time=$(date +%s)
start_benchmark "$SCENARIO_NAME"

# Step 1: Start session
log_step "Starting bdg session"
bdg "$TARGET_URL" --headless || die "Failed to start session"

# Step 2: Wait for article content
log_step "Waiting for article to load"
WAIT_START=$(date +%s)

# Wikipedia articles load quickly but have heavy DOM
# Wait for the main content area
sleep 3

WAIT_DURATION=$(($(date +%s) - WAIT_START))
record_metric "wait_duration_seconds" "$WAIT_DURATION"

# Step 3: Extract article data using raw CDP
log_step "Extracting article summary via Runtime.evaluate"

EXTRACT_SCRIPT='
(function() {
  const title = document.querySelector("#firstHeading")?.textContent?.trim() || "unknown";
  
  // Get first meaningful paragraph (skip empty ones)
  const paragraphs = Array.from(document.querySelectorAll(".mw-parser-output > p"));
  const firstPara = paragraphs.find(p => p.textContent.trim().length > 50);
  const summary = firstPara?.textContent?.trim() || "";
  
  // Count sections
  const sections = document.querySelectorAll(".mw-heading").length;
  
  // Count references
  const references = document.querySelectorAll(".reference").length;
  
  return {
    title,
    summary,
    summary_length: summary.length,
    sections,
    references
  };
})();
'

RESULT=$(bdg cdp Runtime.evaluate --params "{\"expression\": $(printf '%s' "$EXTRACT_SCRIPT" | jq -Rs .), \"returnByValue\": true}" 2>&1) || {
  log_error "CDP Runtime.evaluate failed"
  record_metric "extraction_status" "failed"
  capture_error_context "$SCENARIO_NAME" "CDP extraction failed"
  die "Failed to extract article data"
}

# Step 4: Validate extraction
log_step "Validating extracted data"

# Parse result using jq
ARTICLE=$(echo "$RESULT" | jq -r '.result.value')

TITLE=$(echo "$ARTICLE" | jq -r '.title')
SUMMARY=$(echo "$ARTICLE" | jq -r '.summary')
SUMMARY_LENGTH=$(echo "$ARTICLE" | jq -r '.summary_length')

log_info "Extracted article: $TITLE"
log_info "Summary length: $SUMMARY_LENGTH characters"

record_metric "summary_length" "$SUMMARY_LENGTH"

# Validate title
assert_not_empty "$TITLE" "Article title should not be empty"
[ "$TITLE" != "unknown" ] || die "Failed to extract article title"

# Validate summary
assert_gte "$SUMMARY_LENGTH" 100 "Expected summary ≥100 characters, got $SUMMARY_LENGTH"

log_success "Validation passed: article data extracted"

# Step 5: Optional screenshot for debugging
if [ "${SCREENSHOT:-0}" = "1" ]; then
  log_step "Capturing screenshot for debugging"
  bdg page screenshot --full --out "${RESULTS_DIR}/${SCENARIO_NAME}-screenshot.png" 2>/dev/null || log_warn "Screenshot failed"
fi

# Step 6: Stop session
log_step "Stopping session"
stop_session_gracefully || log_warn "Session stop had issues"

# Calculate total duration
end_time=$(date +%s)
duration=$((end_time - start_time))
record_metric "total_duration_seconds" "$duration"

# Output results
log_success "Benchmark completed successfully in ${duration}s"
end_benchmark "$SCENARIO_NAME" "success"

# Write JSON result
cat > "${RESULTS_DIR}/${SCENARIO_NAME}-result.json" <<EOF
{
  "scenario": "$SCENARIO_NAME",
  "complexity": "$SCENARIO_COMPLEXITY",
  "target": "$TARGET_URL",
  "status": "success",
  "duration_seconds": $duration,
  "metrics": {
    "wait_duration_seconds": $WAIT_DURATION,
    "summary_length": $SUMMARY_LENGTH
  },
  "sample_data": {
    "title": $(echo "$TITLE" | jq -Rs .),
    "summary_preview": $(echo "$SUMMARY" | cut -c1-200 | jq -Rs .)
  }
}
EOF

exit 0
