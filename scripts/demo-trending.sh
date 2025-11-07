#!/bin/bash
#
# GitHub Trending Demo - Showcase bdg scraping GitHub trending pages
#
# This script demonstrates bdg's ability to:
# 1. Browse real web pages (github.com/trending)
# 2. Extract DOM data using CDP commands
# 3. Output structured data to terminal
#
# Usage:
#   ./scripts/demo-trending.sh              # Run demo
#   ./scripts/demo-trending.sh --record     # Record with asciinema

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
RED='\033[0;31m'
RESET='\033[0m'
BOLD='\033[1m'

# Configuration
RECORD_MODE=false
OUTPUT_DIR="$PROJECT_ROOT/.bdg-demo"
TYPESCRIPT_URL="https://github.com/trending/typescript?since=daily"
AI_URL="https://github.com/trending?topics=ai&since=daily"

# Parse arguments
if [[ "${1:-}" == "--record" ]]; then
    RECORD_MODE=true
fi

# Ensure bdg is available
if ! command -v bdg &> /dev/null; then
    echo -e "${YELLOW}Installing bdg globally...${RESET}"
    cd "$PROJECT_ROOT"
    npm run build
    npm link
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Banner
print_banner() {
    echo -e "${CYAN}${BOLD}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ◆ bdg - GitHub Trending Demo"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${RESET}"
    echo -e "${BLUE}Demonstrating browser telemetry and data extraction${RESET}"
    echo
}

# Extract trending repos from live session using DOM queries
extract_trending_repos() {
    local category="$1"
    
    echo -e "${GREEN}${BOLD}📊 Trending $category Repositories${RESET}"
    echo
    
    # Query all article elements (each is a repository card)
    local articles=$(bdg dom query 'article.Box-row' --json 2>/dev/null)
    
    if [[ -z "$articles" ]] || [[ "$(echo "$articles" | jq '.count')" == "0" ]]; then
        echo -e "${YELLOW}No repositories found. Page may still be loading...${RESET}"
        echo
        return
    fi
    
    echo -e "${CYAN}Repository                          Stars Today    Language${RESET}"
    echo "────────────────────────────────────────────────────────────────────────"
    
    # Get count of articles
    local count=$(echo "$articles" | jq '.count')
    local display_count=$((count < 10 ? count : 10))
    
    # Extract data for each article using index-based queries
    for i in $(seq 1 $display_count); do
        # Get repository name link
        local repo_link=$(bdg dom get "article.Box-row:nth-of-type($i) h2 a" --json 2>/dev/null | \
            jq -r '.nodes[0].attributes.href' 2>/dev/null)
        
        if [[ -z "$repo_link" ]] || [[ "$repo_link" == "null" ]]; then
            continue
        fi
        
        # Clean repo name (remove leading slash)
        local repo_name=$(echo "$repo_link" | sed 's/^\///')
        
        # Get stars today
        local stars=$(bdg dom query "article.Box-row:nth-of-type($i) span.d-inline-block.float-sm-right" --json 2>/dev/null | \
            jq -r '.nodes[0].preview' 2>/dev/null | \
            sed 's/ stars\? today//' || echo "N/A")
        
        # Get language (if available)
        local lang=$(bdg dom query "article.Box-row:nth-of-type($i) span[itemprop='programmingLanguage']" --json 2>/dev/null | \
            jq -r '.nodes[0].preview' 2>/dev/null || echo "-")
        
        # Format output
        printf "%-35s %-14s %s\n" \
            "${repo_name:0:34}" \
            "$stars" \
            "$lang"
    done
    
    echo
}

# Scrape a trending page
scrape_trending_page() {
    local url="$1"
    local category="$2"
    
    echo -e "${BLUE}${BOLD}Fetching $category trending repositories...${RESET}"
    echo -e "${YELLOW}URL: $url${RESET}"
    echo
    
    # Start bdg session in background
    echo -e "${CYAN}▶ bdg \"$url\" --headless${RESET}"
    bdg "$url" --headless > /dev/null 2>&1 &
    local bdg_pid=$!
    
    # Wait for page to load (check for session)
    echo -e "${MAGENTA}Waiting for page to load...${RESET}"
    local attempts=0
    while ! bdg status > /dev/null 2>&1; do
        sleep 1
        attempts=$((attempts + 1))
        if [[ $attempts -gt 15 ]]; then
            echo -e "${RED}Timeout waiting for session to start${RESET}"
            return 1
        fi
    done
    
    # Give page time to render and JavaScript to execute
    sleep 5
    
    # Extract data using DOM queries
    extract_trending_repos "$category"
    
    # Show network telemetry sample
    echo -e "${CYAN}Network telemetry (sample):${RESET}"
    bdg peek --network --last 5 2>/dev/null || echo "  (no network data yet)"
    echo
    
    # Stop session
    echo -e "${MAGENTA}Stopping session...${RESET}"
    bdg stop > /dev/null 2>&1
    sleep 1
    echo
}

# Main demo flow
run_demo() {
    print_banner
    
    # TypeScript trending
    echo -e "${BLUE}${BOLD}1. ${RESET}${BOLD}TypeScript Repositories${RESET}"
    echo
    scrape_trending_page "$TYPESCRIPT_URL" "TypeScript"
    
    sleep 2
    
    # AI trending
    echo -e "${BLUE}${BOLD}2. ${RESET}${BOLD}AI/ML Repositories${RESET}"
    echo
    scrape_trending_page "$AI_URL" "AI"
    
    # Summary
    echo -e "${GREEN}${BOLD}✓ Demo Complete${RESET}"
    echo
    echo -e "${CYAN}What just happened:${RESET}"
    echo "  1. bdg launched headless Chrome and connected via WebSocket"
    echo "  2. Navigated to GitHub trending pages"
    echo "  3. Used CDP (Chrome DevTools Protocol) to query live DOM"
    echo "  4. Extracted repository data without parsing HTML files"
    echo "  5. Collected network requests, console logs, and DOM snapshots"
    echo
    echo -e "${BLUE}This demonstrates bdg's ability to:${RESET}"
    echo "  • Browse real web pages programmatically"
    echo "  • Extract structured data from live DOM"
    echo "  • Collect comprehensive telemetry (network, console, DOM)"
    echo "  • Operate in headless mode for automation"
    echo "  • Work as a web scraping tool for AI agents"
    echo
}

# Record with asciinema
run_with_recording() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local recording_file="$OUTPUT_DIR/bdg-trending-demo-$timestamp.cast"
    
    echo -e "${YELLOW}Starting asciinema recording...${RESET}"
    echo -e "${CYAN}Recording will be saved to: $recording_file${RESET}"
    echo
    sleep 2
    
    # Record the demo
    asciinema rec \
        --title "bdg - GitHub Trending Demo" \
        --command "bash '$SCRIPT_DIR/demo-trending.sh'" \
        --overwrite \
        "$recording_file"
    
    echo
    echo -e "${GREEN}${BOLD}✓ Recording saved!${RESET}"
    echo -e "${CYAN}Play it back with: asciinema play $recording_file${RESET}"
    echo -e "${CYAN}Upload to share: asciinema upload $recording_file${RESET}"
}

# Main execution
main() {
    # Cleanup any existing sessions
    bdg stop > /dev/null 2>&1 || true
    sleep 1
    
    if [[ "$RECORD_MODE" == true ]]; then
        run_with_recording
    else
        run_demo
    fi
}

# Run if not sourced
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi
