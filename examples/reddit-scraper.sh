#!/usr/bin/env bash
#
# Reddit Post Scraper using bdg
#
# Extract top posts from a subreddit with titles and descriptions
#
# Usage: ./reddit-scraper.sh [subreddit_url]
# Example: ./reddit-scraper.sh https://www.reddit.com/r/ClaudeAI/

set -euo pipefail

# Configuration
SUBREDDIT_URL="${1:-https://www.reddit.com/r/ClaudeAI/}"
POST_LIMIT=10
LOAD_WAIT=8  # Wait for dynamic content to load

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Reddit Post Scraper${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Cleanup function
cleanup() {
    echo
    echo -e "${BLUE}Cleaning up...${NC}"
    bdg stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Start session
echo -e "${BLUE}→${NC} Starting session: $SUBREDDIT_URL"
if ! bdg "$SUBREDDIT_URL" --timeout 60 >/dev/null 2>&1; then
    echo -e "${YELLOW}✗${NC} Failed to start session"
    exit 1
fi

echo -e "${GREEN}✓${NC} Session started"
echo -e "${BLUE}→${NC} Waiting for DOM to stabilize (MutationObserver)..."

# Use the same adaptive DOM stability logic from src/utils/pageReadiness.ts!
# Waits for DOM mutations to stop (300ms of no changes = stable, max 15s timeout)
STABILITY_SCRIPT='
new Promise((resolve, reject) => {
  const maxWait = 15000;
  const stableThreshold = 300;
  const deadline = Date.now() + maxWait;

  window.__bdg_lastMutation = Date.now();

  const observer = new MutationObserver(() => {
    window.__bdg_lastMutation = Date.now();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true
  });

  const check = () => {
    if (Date.now() >= deadline) {
      observer.disconnect();
      reject(new Error("DOM stability timeout"));
      return;
    }

    const idle = Date.now() - window.__bdg_lastMutation;
    if (idle >= stableThreshold) {
      observer.disconnect();
      resolve(true);
    } else {
      setTimeout(check, 100);
    }
  };

  setTimeout(check, 100);
})
'

bdg cdp Runtime.evaluate --params "{\"expression\":$(echo "$STABILITY_SCRIPT" | jq -Rs .),\"awaitPromise\":true}" >/dev/null 2>&1 || \
  echo -e "${YELLOW}⚠${NC} DOM stability timeout (proceeding anyway)"

# Extract posts using Runtime.evaluate
echo -e "${BLUE}→${NC} Extracting posts..."

# Reddit uses custom elements, let's try different selectors
EXTRACTION_SCRIPT='
(function() {
    // Try multiple selector strategies for Reddit posts
    let posts = [];

    // Strategy 1: Try shreddit-post custom elements
    let shredditPosts = Array.from(document.querySelectorAll("shreddit-post"));
    if (shredditPosts.length > 0) {
        posts = shredditPosts.slice(0, 10).map(post => ({
            title: post.getAttribute("post-title") || "",
            author: post.getAttribute("author") || "",
            score: post.getAttribute("score") || "0",
            comments: post.getAttribute("comment-count") || "0",
            permalink: post.getAttribute("content-href") || ""
        }));
    }

    // Strategy 2: If no shreddit-post, try article elements with data-testid
    if (posts.length === 0) {
        let articles = Array.from(document.querySelectorAll("article, [data-testid=\"post-container\"]"));
        posts = articles.slice(0, 10).map(article => {
            let titleEl = article.querySelector("h3, [data-testid=\"post-title\"]");
            let authorEl = article.querySelector("[data-testid=\"post-author\"], a[href*=\"/user/\"]");
            let scoreEl = article.querySelector("[data-testid=\"vote-button-up\"]");

            return {
                title: titleEl ? titleEl.innerText.trim() : "No title",
                author: authorEl ? authorEl.innerText.trim() : "Unknown",
                score: scoreEl ? scoreEl.getAttribute("aria-label") || "0" : "0",
                permalink: titleEl ? (titleEl.href || titleEl.closest("a")?.href || "") : ""
            };
        });
    }

    // Strategy 3: Fallback to any links that look like post links
    if (posts.length === 0) {
        let postLinks = Array.from(document.querySelectorAll("a[href*=\"/comments/\"]"));
        let seen = new Set();
        posts = postLinks
            .filter(link => {
                let href = link.href;
                if (seen.has(href)) return false;
                seen.add(href);
                return true;
            })
            .slice(0, 10)
            .map(link => ({
                title: link.innerText.trim() || link.getAttribute("aria-label") || "No title",
                permalink: link.href
            }));
    }

    return posts;
})()
'

POSTS_JSON=$(bdg cdp Runtime.evaluate --params "{\"expression\":$(echo "$EXTRACTION_SCRIPT" | jq -Rs .),\"returnByValue\":true}")

# Check if we got data
if ! echo "$POSTS_JSON" | jq -e '.result.value | length > 0' >/dev/null 2>&1; then
    echo -e "${YELLOW}✗${NC} No posts found. Reddit might have changed their HTML structure."
    echo -e "${BLUE}→${NC} Trying fallback: extracting all visible h3 elements..."

    # Fallback: just get all h3 elements that look like titles
    FALLBACK_SCRIPT='
    Array.from(document.querySelectorAll("h3"))
        .slice(0, 10)
        .map(h3 => ({
            title: h3.innerText.trim(),
            permalink: h3.closest("a")?.href || ""
        }))
    '

    POSTS_JSON=$(bdg cdp Runtime.evaluate --params "{\"expression\":$(echo "$FALLBACK_SCRIPT" | jq -Rs .),\"returnByValue\":true}")
fi

# Parse and display posts
POST_COUNT=$(echo "$POSTS_JSON" | jq '.result.value | length')

echo
echo -e "${GREEN}✓${NC} Extracted $POST_COUNT posts"
echo
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Top Posts from r/ClaudeAI${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Display posts with formatting
echo "$POSTS_JSON" | jq -r '.result.value | to_entries[] |
    "\n\u001b[1;33m[\(.key + 1)]\u001b[0m \u001b[1m\(.value.title)\u001b[0m" +
    (if .value.author then "\n   👤 u/\(.value.author)" else "" end) +
    (if .value.score then " | 🔼 \(.value.score) points" else "" end) +
    (if .value.comments then " | 💬 \(.value.comments) comments" else "" end) +
    (if .value.permalink then "\n   🔗 \(.value.permalink)" else "" end)
'

echo
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Stop session
echo
echo -e "${BLUE}→${NC} Stopping session..."
bdg stop >/dev/null

echo -e "${GREEN}✓${NC} Done!"
