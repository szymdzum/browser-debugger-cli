#!/usr/bin/env bash
#
# Golden CDP Workflow Example
#
# This script demonstrates end-to-end raw CDP usage with bdg.
# It shows how agents can compose CDP commands to:
# 1. Query the document title
# 2. Check element existence
# 3. Extract data from multiple elements
# 4. Work with cookies and page metadata
#
# Requirements:
# - bdg installed and in PATH
# - jq for JSON processing (optional but recommended)
#
# Exit codes:
# - 0: Success
# - 1: Generic failure
# - 80-99: User errors (invalid input, resource not found, etc.)
# - 100-119: Software errors (CDP connection failure, timeouts, etc.)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ ${NC}$1" >&2
}

log_success() {
    echo -e "${GREEN}✓${NC} $1" >&2
}

log_error() {
    echo -e "${RED}✗${NC} $1" >&2
}

log_section() {
    echo >&2
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
    echo -e "${YELLOW}$1${NC}" >&2
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
}

# Cleanup function
cleanup() {
    if [ -n "${SESSION_ACTIVE:-}" ]; then
        log_info "Cleaning up session..."
        bdg stop >/dev/null 2>&1 || true
    fi
}

trap cleanup EXIT

# Configuration
TARGET_URL="${1:-https://example.com}"
SESSION_ACTIVE=""

# ============================================================================
# SECTION 1: Start Session
# ============================================================================
log_section "Starting Browser Session"

log_info "Starting session with: $TARGET_URL"
if bdg "$TARGET_URL" --timeout 60 >/dev/null 2>&1; then
    SESSION_ACTIVE="1"
    log_success "Session started successfully"
else
    log_error "Failed to start session"
    exit 1
fi

# Wait for page to stabilize
sleep 1

# ============================================================================
# SECTION 2: Query Document Title
# ============================================================================
log_section "Querying Document Title"

log_info "Executing: Runtime.evaluate to get document.title"
TITLE_RESULT=$(bdg cdp Runtime.evaluate --params '{"expression":"document.title","returnByValue":true}')

if [ -n "$TITLE_RESULT" ]; then
    if command -v jq >/dev/null 2>&1; then
        TITLE=$(echo "$TITLE_RESULT" | jq -r '.result.value')
        log_success "Title: $TITLE"
    else
        log_success "Title result (install jq for pretty output):"
        echo "$TITLE_RESULT" | head -1
    fi
else
    log_error "Failed to get title"
fi

# ============================================================================
# SECTION 3: Check Element Existence
# ============================================================================
log_section "Checking Element Existence"

log_info "Checking if <h1> element exists"
H1_EXISTS=$(bdg cdp Runtime.evaluate --params '{"expression":"document.querySelector(\"h1\") !== null","returnByValue":true}')

if command -v jq >/dev/null 2>&1; then
    EXISTS=$(echo "$H1_EXISTS" | jq -r '.result.value')
    if [ "$EXISTS" = "true" ]; then
        log_success "Found <h1> element"

        # Extract h1 text
        log_info "Extracting <h1> text content"
        H1_TEXT=$(bdg cdp Runtime.evaluate --params '{"expression":"document.querySelector(\"h1\")?.textContent","returnByValue":true}')
        H1_CONTENT=$(echo "$H1_TEXT" | jq -r '.result.value')
        log_success "h1 content: $H1_CONTENT"
    else
        log_info "No <h1> element found"
    fi
else
    log_success "h1 check result (install jq for pretty output):"
    echo "$H1_EXISTS"
fi

# ============================================================================
# SECTION 4: Extract Data from Multiple Elements
# ============================================================================
log_section "Extracting Data from Multiple Elements"

log_info "Extracting all paragraph text"
PARAGRAPHS=$(bdg cdp Runtime.evaluate --params '{"expression":"Array.from(document.querySelectorAll(\"p\")).map(p => p.textContent)","returnByValue":true}')

if command -v jq >/dev/null 2>&1; then
    PARA_COUNT=$(echo "$PARAGRAPHS" | jq '.result.value | length')
    log_success "Found $PARA_COUNT paragraphs"

    echo "$PARAGRAPHS" | jq -r '.result.value[]' | while read -r para; do
        echo "  • $para" >&2
    done
else
    log_success "Paragraph results (install jq for pretty output):"
    echo "$PARAGRAPHS"
fi

# ============================================================================
# SECTION 5: Work with Cookies and Page Metadata
# ============================================================================
log_section "Page Metadata"

log_info "Getting cookies"
COOKIES=$(bdg cdp Network.getCookies)

if command -v jq >/dev/null 2>&1; then
    COOKIE_COUNT=$(echo "$COOKIES" | jq '.cookies | length')
    log_success "Found $COOKIE_COUNT cookies"
else
    log_success "Cookie results:"
    echo "$COOKIES"
fi

log_info "Getting frame tree"
FRAME_TREE=$(bdg cdp Page.getFrameTree)

if command -v jq >/dev/null 2>&1; then
    FRAME_URL=$(echo "$FRAME_TREE" | jq -r '.frameTree.frame.url')
    MIME_TYPE=$(echo "$FRAME_TREE" | jq -r '.frameTree.frame.mimeType')
    log_success "Frame URL: $FRAME_URL"
    log_success "MIME Type: $MIME_TYPE"
else
    log_success "Frame tree results:"
    echo "$FRAME_TREE"
fi

# ============================================================================
# SECTION 6: Complex Data Extraction
# ============================================================================
log_section "Complex Data Extraction"

log_info "Extracting link URLs and text"
LINKS=$(bdg cdp Runtime.evaluate --params '{"expression":"Array.from(document.querySelectorAll(\"a\")).map(a => ({href: a.href, text: a.textContent.trim()}))","returnByValue":true}')

if command -v jq >/dev/null 2>&1; then
    LINK_COUNT=$(echo "$LINKS" | jq '.result.value | length')
    log_success "Found $LINK_COUNT links"

    echo "$LINKS" | jq -r '.result.value[] | "  • \(.text) → \(.href)"' >&2
else
    log_success "Link results:"
    echo "$LINKS"
fi

# ============================================================================
# SECTION 7: Stop Session and View Final Output
# ============================================================================
log_section "Session Summary"

log_info "Stopping session..."
bdg stop >/dev/null

log_success "Session completed successfully"
log_info "Full session output saved to: ~/.bdg/session.json"

# Display summary
if command -v jq >/dev/null 2>&1 && [ -f ~/.bdg/session.json ]; then
    DURATION=$(jq -r '.duration' ~/.bdg/session.json)
    NET_REQUESTS=$(jq '.data.network | length' ~/.bdg/session.json)
    CONSOLE_MSGS=$(jq '.data.console | length' ~/.bdg/session.json)

    echo >&2
    log_success "Session Statistics:"
    echo "  Duration: ${DURATION}ms" >&2
    echo "  Network requests: $NET_REQUESTS" >&2
    echo "  Console messages: $CONSOLE_MSGS" >&2
fi

echo >&2
log_section "Key Takeaways"
echo >&2
cat >&2 <<EOF
${GREEN}✓${NC} Raw CDP provides full browser automation capabilities
${GREEN}✓${NC} All responses are pure JSON (pipe to jq for processing)
${GREEN}✓${NC} Session persists until stopped (no reconnection overhead)
${GREEN}✓${NC} Exit codes indicate success/failure (0=success, 80-99=user errors, 100-119=software errors)
${GREEN}✓${NC} Use Runtime.evaluate for any JavaScript expression
${GREEN}✓${NC} Combine with standard Unix tools (jq, grep, awk) for powerful workflows

${BLUE}Next Steps:${NC}
1. Explore 300+ CDP methods: https://chromedevtools.github.io/devtools-protocol/
2. Check bdg docs for stateful wrappers: bdg --help
3. Build custom agent workflows by composing CDP commands
EOF

SESSION_ACTIVE=""
