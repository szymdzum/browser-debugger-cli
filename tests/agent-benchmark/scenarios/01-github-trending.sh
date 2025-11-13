#!/usr/bin/env bash
# Agent Benchmark: GitHub Trending Repositories
#
# Task: Extract trending repositories with name, description, stars
# Complexity: Tier 2 (SPA with lazy loading)
# Expected Duration: 10-15 seconds
#
# Success Criteria:
# - At least 10 repositories extracted
# - Each repo has: name, description, stars
# - No timeouts or crashes
#
# Known Challenges:
# - Dynamic content loading (needs wait)
# - Repository cards may render progressively
# - Network timing varies

set -euo pipefail

# Benchmark metadata
SCENARIO_NAME="github-trending"
SCENARIO_COMPLEXITY="tier2"
TARGET_URL="https://github.com/trending"

# Results directory
RESULTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/results"
mkdir -p "$RESULTS_DIR"
# Load helper functions
source "$(dirname "$0")/../lib/metrics.sh"
source "$(dirname "$0")/../lib/assertions.sh"

# Start timing
start_time=$(date +%s)
start_benchmark "$SCENARIO_NAME"

# Step 1: Start session
log_step "Starting bdg session"
bdg "$TARGET_URL" --headless || die "Failed to start session"

# Step 2: Wait for page load and content
log_step "Waiting for trending repositories to load"
MAX_WAIT=30
WAIT_START=$(date +%s)

# Use dom.wait when it exists (M1), fallback to sleep for now
if command -v "bdg dom wait" &> /dev/null; then
  bdg dom wait --selector "article.Box-row" --state visible --timeout ${MAX_WAIT}000 || die "Timeout waiting for repositories"
else
  log_warn "dom.wait not implemented yet, using sleep fallback"
  sleep 5
fi

WAIT_DURATION=$(($(date +%s) - WAIT_START))
record_metric "wait_duration_seconds" "$WAIT_DURATION"

# Step 3: Extract repository data using raw CDP
log_step "Extracting repository data via Runtime.evaluate"

EXTRACT_SCRIPT='
Array.from(document.querySelectorAll("article.Box-row")).slice(0, 25).map(article => {
  const nameEl = article.querySelector("h2 a");
  const descEl = article.querySelector("p");
  const starsEl = article.querySelector("svg[aria-label*=\"star\"]")?.parentElement;
  
  return {
    name: nameEl?.textContent?.trim() || "unknown",
    url: nameEl?.href || "",
    description: descEl?.textContent?.trim() || "",
    stars: starsEl?.textContent?.trim() || "0"
  };
}).filter(repo => repo.name !== "unknown");
'

RESULT=$(bdg cdp Runtime.evaluate --params "{\"expression\": $(printf '%s' "$EXTRACT_SCRIPT" | jq -Rs .), \"returnByValue\": true}" 2>&1) || {
  log_error "CDP Runtime.evaluate failed"
  record_metric "extraction_status" "failed"
  die "Failed to extract repository data"
}

# Step 4: Validate extraction
log_step "Validating extracted data"

# Parse result using jq
REPOS=$(echo "$RESULT" | jq -r '.result.result.value')
REPO_COUNT=$(echo "$REPOS" | jq 'length')

log_info "Extracted $REPO_COUNT repositories"
record_metric "repositories_extracted" "$REPO_COUNT"

# Validate minimum threshold
assert_gte "$REPO_COUNT" 10 "Expected at least 10 repositories, got $REPO_COUNT"

# Validate structure of first repo
FIRST_REPO=$(echo "$REPOS" | jq '.[0]')
assert_has_field "$FIRST_REPO" "name" "First repository missing name field"
assert_has_field "$FIRST_REPO" "description" "First repository missing description field"
assert_has_field "$FIRST_REPO" "stars" "First repository missing stars field"

log_success "Validation passed: structure is correct"

# Step 5: Optional screenshot for debugging
if [ "${SCREENSHOT:-0}" = "1" ]; then
  log_step "Capturing screenshot for debugging"
  bdg page screenshot --full --out "${RESULTS_DIR}/${SCENARIO_NAME}-screenshot.png" 2>/dev/null || log_warn "Screenshot failed"
fi

# Step 6: Stop session
log_step "Stopping session"
bdg stop

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
    "repositories_extracted": $REPO_COUNT
  },
  "sample_data": $(echo "$REPOS" | jq '[.[0:3]]')
}
EOF

exit 0
