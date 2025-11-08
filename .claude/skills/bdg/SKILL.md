---
name: bdg
description: Use bdg CLI for browser automation via Chrome DevTools Protocol. Provides direct CDP access (60+ domains, 300+ methods) for DOM queries, navigation, screenshots, network control, and JavaScript execution. Use this skill when you need to automate browsers, scrape dynamic content, or interact with web pages programmatically.
---

# bdg - Browser Automation

**bdg** is a CLI tool for browser automation via Chrome DevTools Protocol (CDP).

## When to Use This Skill

- Automating browsers and scraping dynamic web content
- Extracting data from JavaScript-heavy single-page applications
- Taking screenshots or generating PDFs
- Testing web applications with real browser behavior
- Manipulating network requests (cache, throttling, blocking)
- Executing JavaScript in browser context

## Philosophy: Raw CDP First

`bdg cdp` gives direct access to 60+ CDP domains. **You don't need wrappers** — the protocol is the interface.

## Quick Start

```bash
# 1. Start session (launches Chrome, opens URL)
bdg https://example.com

# 2. Execute CDP commands directly
bdg cdp Runtime.evaluate --params '{"expression": "document.title", "returnByValue": true}'

# 3. Stop session (writes output)
bdg stop
```

## Essential Documentation

**`docs/AGENT_WORKFLOWS.md`** - Complete guide with 15+ working recipes:
- Golden example: Full GitHub scraper workflow
- Core patterns for DOM queries, navigation, screenshots
- Error handling with exit codes and retries
- Waiting strategies (polling, navigation, network idle)
- Best practices for CDP usage

## Common Patterns

### Extract Data from Page

```bash
bdg cdp Runtime.evaluate --params '{
  "expression": "Array.from(document.querySelectorAll(\"a\")).map(a => ({text: a.textContent, href: a.href}))",
  "returnByValue": true
}' | jq '.result.value'
```

### Wait for Element (Polling Loop)

```bash
TIMEOUT=10
ELAPSED=0

while [ $(echo "$ELAPSED < $TIMEOUT" | bc) -eq 1 ]; do
  EXISTS=$(bdg cdp Runtime.evaluate --params '{
    "expression": "document.querySelector(\"#target\") !== null",
    "returnByValue": true
  }' | jq -r '.result.value')
  
  [ "$EXISTS" = "true" ] && break
  sleep 0.5
  ELAPSED=$(echo "$ELAPSED + 0.5" | bc)
done
```

### Navigate with Retry

```bash
MAX_RETRIES=3

for i in $(seq 1 $MAX_RETRIES); do
  bdg cdp Page.navigate --params '{"url": "https://example.com"}' && break
  [ $i -eq $MAX_RETRIES ] && exit 101
  sleep 2
done
```

### Take Screenshot

```bash
bdg cdp Page.captureScreenshot --params '{
  "format": "png",
  "captureBeyondViewport": true
}' | jq -r '.data' | base64 -d > screenshot.png
```

## Key Commands

### Session Management
- `bdg <url>` - Start session (launches Chrome)
- `bdg status` - Check session status
- `bdg peek` - Preview collected data
- `bdg stop` - Stop session and write output

### Direct CDP Access
- `bdg cdp <Domain>.<method>` - Execute any CDP method
- `bdg cdp Runtime.evaluate` - Run JavaScript
- `bdg cdp Page.navigate` - Navigate to URL
- `bdg cdp Page.captureScreenshot` - Take screenshot
- `bdg cdp Network.enable` - Enable network tracking

### Discovery
- `bdg --help --json` - Machine-readable command reference
- `bdg dom query <selector>` - Query DOM elements
- `bdg dom eval <js>` - Evaluate JavaScript

## Error Handling

### Exit Codes
- `0` - Success
- `80-99` - User errors (invalid input, resource not found)
- `100-119` - System errors (CDP failure, timeout, Chrome crash)

**Reference**: `docs/EXIT_CODES.md`

### Check Exit Codes

```bash
bdg cdp Page.navigate --params '{"url": "https://example.com"}'
EXIT_CODE=$?

case $EXIT_CODE in
  0) echo "Success" ;;
  101) echo "CDP connection failure"; exit 101 ;;
  102) echo "CDP timeout"; exit 102 ;;
  *) echo "Unknown error: $EXIT_CODE"; exit 1 ;;
esac
```

### Retry with Backoff

```bash
attempt=1
delay=1

while [ $attempt -le 3 ]; do
  bdg cdp Page.navigate --params '{"url": "https://example.com"}' && break
  
  [ $attempt -eq 3 ] && exit 101
  
  sleep $delay
  delay=$((delay * 2))
  attempt=$((attempt + 1))
done
```

## Best Practices

### 1. Always Use `returnByValue: true`

```bash
# ✅ GOOD: Returns serialized value
bdg cdp Runtime.evaluate --params '{
  "expression": "document.title",
  "returnByValue": true
}'

# ❌ BAD: Returns object reference (requires additional CDP calls)
bdg cdp Runtime.evaluate --params '{"expression": "document.title"}'
```

### 2. Wrap JavaScript in Try-Catch

```bash
bdg cdp Runtime.evaluate --params '{
  "expression": "(function() {
    try {
      return document.querySelector(\"#element\").textContent;
    } catch (e) {
      return null;
    }
  })()",
  "returnByValue": true
}'
```

### 3. Enable Domains Before Use

```bash
# Network domain requires enabling
bdg cdp Network.enable
bdg cdp Network.setCacheDisabled --params '{"cacheDisabled": true}'

# Performance domain requires enabling
bdg cdp Performance.enable
bdg cdp Performance.getMetrics
```

### 4. Use jq for JSON Parsing

```bash
# Extract value from CDP response
TITLE=$(bdg cdp Runtime.evaluate --params '{...}' | jq -r '.result.value')
```

### 5. Check Every Exit Code

```bash
bdg cdp Page.navigate --params '{"url": "https://example.com"}'
[ $? -ne 0 ] && { echo "Navigation failed"; exit 101; }
```

## Common Tasks Quick Reference

| Task | Command |
|------|---------|
| Get page title | `bdg cdp Runtime.evaluate --params '{"expression": "document.title", "returnByValue": true}'` |
| Get all links | `bdg cdp Runtime.evaluate --params '{"expression": "Array.from(document.querySelectorAll(\"a\")).map(a => a.href)", "returnByValue": true}'` |
| Navigate to URL | `bdg cdp Page.navigate --params '{"url": "https://example.com"}'` |
| Take screenshot | `bdg cdp Page.captureScreenshot --params '{"format": "png"}'` |
| Disable cache | `bdg cdp Network.enable && bdg cdp Network.setCacheDisabled --params '{"cacheDisabled": true}'` |
| Get cookies | `bdg cdp Network.enable && bdg cdp Network.getCookies` |
| Reload page | `bdg cdp Page.reload --params '{"ignoreCache": true}'` |
| Check element exists | `bdg cdp Runtime.evaluate --params '{"expression": "document.querySelector(\"#id\") !== null", "returnByValue": true}'` |

## CDP Protocol Reference

**Chrome DevTools Protocol**: https://chromedevtools.github.io/devtools-protocol/

**Common Domains**:
- `Runtime` - JavaScript execution, object inspection
- `Page` - Navigation, screenshots, lifecycle
- `Network` - Network control, caching, blocking
- `DOM` - DOM tree inspection
- `Performance` - Performance metrics
- `Emulation` - Device emulation

## When NOT to Use bdg

- **Static HTML parsing** → Use `curl` + `pq`/`htmlq`
- **API calls** → Use `curl` + `jq`
- **Simple HTTP requests** → Use `wget`/`curl`

Use `bdg` when you need:
- JavaScript execution
- Dynamic content (SPAs, lazy loading)
- Browser APIs (localStorage, cookies, etc.)
- Screenshots or PDFs
- Network manipulation
- Device emulation

## Example: GitHub Trending Scraper

```bash
#!/bin/bash
# Scrape GitHub trending repositories

set -e  # Exit on error

# Start session
bdg https://github.com/trending

# Extract repository data
REPOS=$(bdg cdp Runtime.evaluate --params '{
  "expression": "Array.from(document.querySelectorAll(\"article h2 a\")).slice(0, 5).map(a => ({name: a.textContent.trim(), url: a.href}))",
  "returnByValue": true
}')

# Check for errors
if ! echo "$REPOS" | jq -e '.result.value' > /dev/null; then
  echo "Failed to extract repositories"
  bdg stop
  exit 1
fi

# Display results
echo "$REPOS" | jq -r '.result.value[] | "\(.name) - \(.url)"'

# Stop session
bdg stop
```

## Troubleshooting

### Session Issues
```bash
# Check session status
bdg status

# Force cleanup stale session
bdg cleanup --force

# Kill all Chrome processes
bdg cleanup --aggressive
```

### CDP Connection Errors
- **Exit 101 (CDP_CONNECTION_FAILURE)** - Chrome crashed or connection lost
  - Solution: Run `bdg cleanup --aggressive` and retry
- **Exit 102 (CDP_TIMEOUT)** - CDP operation timed out
  - Solution: Increase timeout or check network connectivity

### Chrome Launch Failures
- **Exit 100 (CHROME_LAUNCH_FAILURE)** - Chrome failed to start
  - Solution: Check Chrome installation with `bdg status --verbose`

**Full troubleshooting**: `docs/TROUBLESHOOTING.md`

---

**For complete patterns and examples, always refer to `docs/AGENT_WORKFLOWS.md`**.
