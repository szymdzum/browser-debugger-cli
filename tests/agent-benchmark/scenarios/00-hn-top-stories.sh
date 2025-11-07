#!/usr/bin/env bash
# Agent Benchmark: Hacker News Top Stories
#
# Task: Extract top 10 stories with title, points, URL
# Complexity: Tier 1 (Static HTML, minimal JavaScript)
# Expected Duration: 5-8 seconds
#
# Success Criteria:
# - At least 10 stories extracted
# - Each story has: title, points, url
# - No timeouts or crashes
#
# Known Challenges:
# - Static HTML makes this straightforward
# - Good baseline to verify basic functionality

set -euo pipefail

# Benchmark metadata
SCENARIO_NAME="hn-top-stories"
SCENARIO_COMPLEXITY="tier1"
TARGET_URL="https://news.ycombinator.com"

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

# Step 2: Wait for page load (static page, should be fast)
log_step "Waiting for stories to load"
WAIT_START=$(date +%s)

# HN is static HTML, so just wait a moment for the page to load
sleep 2

WAIT_DURATION=$(($(date +%s) - WAIT_START))
record_metric "wait_duration_seconds" "$WAIT_DURATION"

# Step 3: Extract story data using raw CDP
log_step "Extracting story data via Runtime.evaluate"

EXTRACT_SCRIPT='
Array.from(document.querySelectorAll(".athing")).slice(0, 30).map((item, index) => {
  const titleEl = item.querySelector(".titleline > a");
  const subtext = item.nextElementSibling;
  const scoreEl = subtext?.querySelector(".score");
  
  return {
    rank: index + 1,
    title: titleEl?.textContent?.trim() || "unknown",
    url: titleEl?.href || "",
    points: scoreEl?.textContent?.replace(" points", "")?.trim() || "0"
  };
}).filter(story => story.title !== "unknown");
'

RESULT=$(bdg cdp Runtime.evaluate --params "{\"expression\": $(printf '%s' "$EXTRACT_SCRIPT" | jq -Rs .), \"returnByValue\": true}" 2>&1) || {
  log_error "CDP Runtime.evaluate failed"
  record_metric "extraction_status" "failed"
  capture_error_context "$SCENARIO_NAME" "CDP extraction failed"
  die "Failed to extract story data"
}

# Step 4: Validate extraction
log_step "Validating extracted data"

# Parse result using jq
STORIES=$(echo "$RESULT" | jq -r '.result.value')
STORY_COUNT=$(echo "$STORIES" | jq 'length')

log_info "Extracted $STORY_COUNT stories"
record_metric "stories_extracted" "$STORY_COUNT"

# Validate minimum threshold
assert_gte "$STORY_COUNT" 10 "Expected at least 10 stories, got $STORY_COUNT"

# Validate structure of first story
FIRST_STORY=$(echo "$STORIES" | jq '.[0]')
assert_has_field "$FIRST_STORY" "title" "First story missing title field"
assert_has_field "$FIRST_STORY" "points" "First story missing points field"
assert_has_field "$FIRST_STORY" "url" "First story missing url field"

log_success "Validation passed: structure is correct"

# Step 5: Optional screenshot for debugging
if [ "${SCREENSHOT:-0}" = "1" ]; then
  log_step "Capturing screenshot for debugging"
  bdg page screenshot --full --out "${RESULTS_DIR}/${SCENARIO_NAME}-screenshot.png" 2>/dev/null || log_warn "Screenshot failed (expected if page.screenshot not implemented)"
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
    "stories_extracted": $STORY_COUNT
  },
  "sample_data": $(echo "$STORIES" | jq '[.[0:3]]')
}
EOF

exit 0
