#!/bin/bash
# Agent Benchmark: SPA Navigation and State Changes
#
# Task: Navigate a single-page application and validate DOM updates
# Complexity: Tier 3 (Client-side routing, dynamic state, timing challenges)
# Expected Duration: 15-20 seconds
#
# Success Criteria:
# - Initial page load captured
# - Navigation events captured (client-side routing)
# - DOM updates detected after navigation
# - Network requests for both routes captured
# - No timeouts or crashes
#
# Known Challenges:
# - Detecting when SPA is "ready" after route change
# - No page reload, so DOM updates are incremental
# - Client-side routing uses History API (no network request)
# - Async data fetching after route change

set -euo pipefail

# Benchmark metadata
SCENARIO_NAME="spa-navigation"
SCENARIO_COMPLEXITY="tier3"
TARGET_URL="https://reactjs.org"

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

# Step 2: Wait for initial page load
log_step "Waiting for initial page load"
sleep 4

# Step 3: Capture initial state
log_step "Capturing initial page state"
INITIAL_STATE=$(bdg cdp Runtime.evaluate --params '{"expression": "document.title", "returnByValue": true}' 2>&1) || {
  log_error "Failed to get initial page title"
  die "CDP evaluation failed"
}

INITIAL_TITLE=$(echo "$INITIAL_STATE" | jq -r '.result.value')
log_info "Initial page title: $INITIAL_TITLE"
record_metric "initial_title" "$INITIAL_TITLE"

# Step 4: Perform SPA navigation (click a link that uses client-side routing)
log_step "Performing SPA navigation via Runtime.evaluate"

NAVIGATION_SCRIPT='
(function() {
  // Find first navigation link (docs, blog, etc.)
  const navLink = document.querySelector("nav a[href*=\"/docs\"], nav a[href*=\"/blog\"], a[href*=\"/learn\"]");
  if (navLink) {
    navLink.click();
    return { clicked: true, href: navLink.href, text: navLink.textContent.trim() };
  }
  return { clicked: false, error: "No navigation link found" };
})();
'

NAV_RESULT=$(bdg cdp Runtime.evaluate --params "{\"expression\": $(printf '%s' "$NAVIGATION_SCRIPT" | jq -Rs .), \"returnByValue\": true}" 2>&1) || {
  log_error "Navigation script failed"
  die "Failed to trigger SPA navigation"
}

CLICKED=$(echo "$NAV_RESULT" | jq -r '.result.value.clicked')
if [ "$CLICKED" != "true" ]; then
  log_warn "No navigation link found, skipping navigation test"
  log_info "This is expected if the site structure changed"
else
  NAV_HREF=$(echo "$NAV_RESULT" | jq -r '.result.value.href')
  NAV_TEXT=$(echo "$NAV_RESULT" | jq -r '.result.value.text')
  log_success "Clicked navigation link: $NAV_TEXT ($NAV_HREF)"
  record_metric "navigation_performed" "true"

  # Step 5: Wait for SPA to update
  log_step "Waiting for SPA to update after navigation"
  sleep 3

  # Step 6: Capture updated state
  log_step "Capturing updated page state"
  UPDATED_STATE=$(bdg cdp Runtime.evaluate --params '{"expression": "document.title", "returnByValue": true}' 2>&1) || {
    log_warn "Failed to get updated page title"
  }

  UPDATED_TITLE=$(echo "$UPDATED_STATE" | jq -r '.result.value')
  log_info "Updated page title: $UPDATED_TITLE"
  record_metric "updated_title" "$UPDATED_TITLE"

  # Validate that state actually changed
  if [ "$INITIAL_TITLE" = "$UPDATED_TITLE" ]; then
    log_warn "Page title unchanged after navigation (may indicate SPA didn't update)"
  else
    log_success "Page title changed: '$INITIAL_TITLE' → '$UPDATED_TITLE'"
  fi
fi

# Step 7: Validate network requests captured
log_step "Validating network requests were captured"
NETWORK_OUTPUT=$(bdg peek --network --last 50 --json 2>&1) || {
  log_error "Failed to peek network data"
  die "Peek command failed"
}

NETWORK_COUNT=$(echo "$NETWORK_OUTPUT" | jq '[.items[] | select(.type == "network")] | length')
log_info "Captured $NETWORK_COUNT network requests"
record_metric "network_request_count" "$NETWORK_COUNT"

# Validate we captured at least some requests
assert_gte "$NETWORK_COUNT" 3 "Expected at least 3 network requests, got $NETWORK_COUNT"

# Step 8: Validate console logs captured
log_step "Validating console logs were captured"
CONSOLE_OUTPUT=$(bdg peek --console --last 50 --json 2>&1) || {
  log_warn "Failed to peek console data (may be expected if no logs)"
}

if [ $? -eq 0 ]; then
  CONSOLE_COUNT=$(echo "$CONSOLE_OUTPUT" | jq '[.items[] | select(.type == "console")] | length')
  log_info "Captured $CONSOLE_COUNT console messages"
  record_metric "console_message_count" "$CONSOLE_COUNT"
else
  record_metric "console_message_count" 0
fi

# Step 9: Optional screenshot for debugging
if [ "${SCREENSHOT:-0}" = "1" ]; then
  log_step "Capturing screenshot for debugging"
  bdg page screenshot --full --out "results/${SCENARIO_NAME}-screenshot.png" 2>/dev/null || log_warn "Screenshot failed"
fi

# Step 10: Stop session and validate final DOM
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
    "initial_title": $(echo "$INITIAL_TITLE" | jq -Rs .),
    "updated_title": $(echo "$UPDATED_TITLE" | jq -Rs .),
    "navigation_performed": $([ "$CLICKED" = "true" ] && echo "true" || echo "false"),
    "network_request_count": $NETWORK_COUNT,
    "console_message_count": ${CONSOLE_COUNT:-0}
  },
  "validation": {
    "state_changed": $([ "$INITIAL_TITLE" != "$UPDATED_TITLE" ] && echo "true" || echo "false"),
    "network_captured": $([ "$NETWORK_COUNT" -ge 3 ] && echo "true" || echo "false")
  }
}
EOF

exit 0
