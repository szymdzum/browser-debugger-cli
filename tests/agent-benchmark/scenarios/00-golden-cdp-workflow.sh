#!/usr/bin/env bash
# Agent Benchmark: Golden CDP Workflow
#
# Task: Demonstrate end-to-end raw CDP usage with comprehensive examples
# Complexity: Tier 1 (Static HTML, educational baseline)
# Expected Duration: 3-5 seconds
#
# Success Criteria:
# - Document title extracted successfully
# - Element existence check works
# - Multiple element extraction succeeds
# - Cookies and frame tree retrieved
# - Link extraction completes
# - No timeouts or crashes
#
# Purpose:
# This is the golden reference implementation showing how agents should
# compose raw CDP commands. It validates that bdg cdp works end-to-end
# and serves as a template for agent workflows.

set -euo pipefail

# Benchmark metadata
SCENARIO_NAME="golden-cdp-workflow"
SCENARIO_COMPLEXITY="tier1"
TARGET_URL="${1:-https://example.com}"

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

# ============================================================================
# SECTION 1: Start Session
# ============================================================================
log_step "Starting bdg session with $TARGET_URL"

if ! bdg "$TARGET_URL" --headless --timeout 60 >/dev/null 2>&1; then
  die "Failed to start session"
fi

log_success "Session started"

# Wait for page to stabilize
sleep 1

record_metric "session_started" "true"

# ============================================================================
# SECTION 2: Query Document Title
# ============================================================================
log_step "Querying document title via Runtime.evaluate"

TITLE_RESULT=$(bdg cdp Runtime.evaluate --params '{"expression":"document.title","returnByValue":true}')
TITLE=$(echo "$TITLE_RESULT" | jq -r '.result.result.value')

assert_not_empty "$TITLE" "Title should not be empty"
log_success "Title extracted: $TITLE"

record_metric "title_extracted" "$TITLE"

# ============================================================================
# SECTION 3: Check Element Existence
# ============================================================================
log_step "Checking element existence and extracting content"

# Check if h1 exists
H1_EXISTS=$(bdg cdp Runtime.evaluate --params '{"expression":"document.querySelector(\"h1\") !== null","returnByValue":true}')
EXISTS=$(echo "$H1_EXISTS" | jq -r '.result.result.value')

if [ "$EXISTS" != "true" ]; then
  die "H1 element should exist"
fi
log_success "H1 element found"

# Extract h1 text content
H1_TEXT=$(bdg cdp Runtime.evaluate --params '{"expression":"document.querySelector(\"h1\")?.textContent","returnByValue":true}')
H1_CONTENT=$(echo "$H1_TEXT" | jq -r '.result.result.value')

assert_not_empty "$H1_CONTENT" "H1 content should not be empty"
log_success "H1 content: $H1_CONTENT"

record_metric "h1_content" "$H1_CONTENT"

# ============================================================================
# SECTION 4: Extract Data from Multiple Elements
# ============================================================================
log_step "Extracting data from multiple paragraph elements"

PARAGRAPHS=$(bdg cdp Runtime.evaluate --params '{"expression":"Array.from(document.querySelectorAll(\"p\")).map(p => p.textContent)","returnByValue":true}')
PARA_COUNT=$(echo "$PARAGRAPHS" | jq '.result.result.value | length')

assert_gte "$PARA_COUNT" 1 "Should have at least 1 paragraph"
log_success "Extracted $PARA_COUNT paragraphs"

record_metric "paragraph_count" "$PARA_COUNT"

# ============================================================================
# SECTION 5: Work with Cookies and Page Metadata
# ============================================================================
log_step "Retrieving cookies and page metadata"

# Get cookies
COOKIES=$(bdg cdp Network.getCookies)
COOKIE_COUNT=$(echo "$COOKIES" | jq '.cookies | length')
log_success "Found $COOKIE_COUNT cookies"

record_metric "cookie_count" "$COOKIE_COUNT"

# Get frame tree
FRAME_TREE=$(bdg cdp Page.getFrameTree)
FRAME_URL=$(echo "$FRAME_TREE" | jq -r '.frameTree.frame.url')
MIME_TYPE=$(echo "$FRAME_TREE" | jq -r '.frameTree.frame.mimeType')

assert_not_empty "$FRAME_URL" "Frame URL should not be empty"
assert_not_empty "$MIME_TYPE" "MIME type should not be empty"
log_success "Frame metadata: $MIME_TYPE at $FRAME_URL"

record_metric "mime_type" "$MIME_TYPE"

# ============================================================================
# SECTION 6: Complex Data Extraction
# ============================================================================
log_step "Extracting complex data (links with URLs and text)"

LINKS=$(bdg cdp Runtime.evaluate --params '{"expression":"Array.from(document.querySelectorAll(\"a\")).map(a => ({href: a.href, text: a.textContent.trim()}))","returnByValue":true}')
LINK_COUNT=$(echo "$LINKS" | jq '.result.result.value | length')

assert_gte "$LINK_COUNT" 1 "Should have at least 1 link"
log_success "Extracted $LINK_COUNT links"

record_metric "link_count" "$LINK_COUNT"

# ============================================================================
# SECTION 7: Stop Session and Validate Final Output
# ============================================================================
log_step "Stopping session and validating final output"

bdg stop >/dev/null

log_success "Session stopped"

# Validate session.json was created
if [ ! -f ~/.bdg/session.json ]; then
  die "session.json not found after stop"
fi

# Extract final metrics
DURATION=$(jq -r '.duration' ~/.bdg/session.json)
NET_REQUESTS=$(jq '.data.network | length' ~/.bdg/session.json)
CONSOLE_MSGS=$(jq '.data.console | length' ~/.bdg/session.json)

assert_gte "$NET_REQUESTS" 1 "Should have captured network requests"
log_success "Final session: ${DURATION}ms, $NET_REQUESTS requests, $CONSOLE_MSGS console messages"

record_metric "session_duration_ms" "$DURATION"
record_metric "network_requests" "$NET_REQUESTS"
record_metric "console_messages" "$CONSOLE_MSGS"

# End timing
end_time=$(date +%s)
elapsed=$((end_time - start_time))

# Write results
end_benchmark "$SCENARIO_NAME" "success"

log_success "Golden CDP workflow completed in ${elapsed}s"
log_info "Results: $RESULTS_DIR/${SCENARIO_NAME}-result.json"
