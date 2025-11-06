#!/bin/bash
# Agent Benchmark: Reddit Post Scraping
#
# Task: Extract post titles, scores, and authors from r/programming
# Complexity: Tier 3 (Heavy JavaScript, lazy loading, dynamic content)
# Expected Duration: 12-18 seconds
#
# Success Criteria:
# - At least 10 posts extracted
# - Each post has: title, score, author, url
# - No timeouts or crashes
#
# Known Challenges:
# - Heavy JavaScript rendering
# - Lazy loading of content
# - Complex DOM structure with many nested divs
# - Anti-bot measures (may need longer wait times)

set -euo pipefail

# Benchmark metadata
SCENARIO_NAME="reddit-scrape"
SCENARIO_COMPLEXITY="tier3"
TARGET_URL="https://old.reddit.com/r/programming"

# Load helper functions
source "$(dirname "$0")/../lib/metrics.sh"
source "$(dirname "$0")/../lib/assertions.sh"
source "$(dirname "$0")/../lib/recovery.sh"

# Start timing
start_time=$(date +%s)
start_benchmark "$SCENARIO_NAME"

# Step 1: Start session
log_step "Starting bdg session"
bdg "$TARGET_URL" || die "Failed to start session"

# Step 2: Wait for posts to load
log_step "Waiting for posts to load"
WAIT_START=$(date +%s)

# old.reddit.com is more stable than new Reddit, but still needs time to load
sleep 4

WAIT_DURATION=$(($(date +%s) - WAIT_START))
record_metric "wait_duration_seconds" "$WAIT_DURATION"

# Step 3: Extract post data using raw CDP
log_step "Extracting post data via Runtime.evaluate"

EXTRACT_SCRIPT='
Array.from(document.querySelectorAll(".thing[data-type=\"link\"]")).slice(0, 25).map(post => {
  const titleEl = post.querySelector("a.title");
  const scoreEl = post.querySelector(".score");
  const authorEl = post.querySelector(".author");
  const commentsEl = post.querySelector(".comments");

  return {
    title: titleEl?.textContent?.trim() || "unknown",
    url: titleEl?.href || "",
    score: scoreEl?.textContent?.trim() || "0",
    author: authorEl?.textContent?.trim() || "unknown",
    comments: commentsEl?.textContent?.trim() || "0"
  };
}).filter(post => post.title !== "unknown");
'

RESULT=$(bdg cdp Runtime.evaluate --params "{\"expression\": $(printf '%s' "$EXTRACT_SCRIPT" | jq -Rs .), \"returnByValue\": true}" 2>&1) || {
  log_error "CDP Runtime.evaluate failed"
  record_metric "extraction_status" "failed"
  capture_error_context "$SCENARIO_NAME" "CDP extraction failed"
  die "Failed to extract post data"
}

# Step 4: Validate extraction
log_step "Validating extracted data"

# Parse result using jq
POSTS=$(echo "$RESULT" | jq -r '.result.value')
POST_COUNT=$(echo "$POSTS" | jq 'length')

log_info "Extracted $POST_COUNT posts"
record_metric "posts_extracted" "$POST_COUNT"

# Validate minimum threshold
assert_gte "$POST_COUNT" 10 "Expected at least 10 posts, got $POST_COUNT"

# Validate structure of first post
FIRST_POST=$(echo "$POSTS" | jq '.[0]')
assert_has_field "$FIRST_POST" "title" "First post missing title field"
assert_has_field "$FIRST_POST" "score" "First post missing score field"
assert_has_field "$FIRST_POST" "author" "First post missing author field"
assert_has_field "$FIRST_POST" "url" "First post missing url field"

log_success "Validation passed: structure is correct"

# Step 5: Optional screenshot for debugging
if [ "${SCREENSHOT:-0}" = "1" ]; then
  log_step "Capturing screenshot for debugging"
  bdg page screenshot --full --out "results/${SCENARIO_NAME}-screenshot.png" 2>/dev/null || log_warn "Screenshot failed (expected if page.screenshot not implemented)"
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
cat > "results/${SCENARIO_NAME}-result.json" <<EOF
{
  "scenario": "$SCENARIO_NAME",
  "complexity": "$SCENARIO_COMPLEXITY",
  "target": "$TARGET_URL",
  "status": "success",
  "duration_seconds": $duration,
  "metrics": {
    "wait_duration_seconds": $WAIT_DURATION,
    "posts_extracted": $POST_COUNT
  },
  "sample_data": $(echo "$POSTS" | jq '[.[0:3]]')
}
EOF

exit 0
