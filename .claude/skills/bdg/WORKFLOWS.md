# Agent Workflows

**Purpose**: Show AI agents how to compose raw CDP commands for common browser automation tasks.

**Philosophy**: `bdg cdp` gives you direct access to 60+ Chrome DevTools Protocol domains. You don't need wrappers — the protocol is the interface.

## Table of Contents

- [Golden Example: Full Workflow](#golden-example-full-workflow)
- [Core Patterns](#core-patterns)
- [Recipe Index](#recipe-index)
- [Error Handling](#error-handling)
- [Waiting Strategies](#waiting-strategies)

---

## Golden Example: Full Workflow

Complete workflow showing session lifecycle, navigation, DOM queries, and data extraction:

```bash
#!/bin/bash
# Extract repository information from GitHub trending page

# 1. Start session (launches Chrome, establishes CDP connection)
bdg start https://github.com/trending

# 2. Wait for page to be ready (automatic via page readiness detection)
# No polling needed - bdg waits for load event + network idle + DOM stable

# 3. Extract repository names using JavaScript evaluation
REPOS=$(bdg cdp Runtime.evaluate --params '{
  "expression": "Array.from(document.querySelectorAll(\"h2.h3 a\")).map(a => ({
    name: a.textContent.trim(),
    url: a.href,
    stars: a.closest(\"article\").querySelector(\"svg.octicon-star\").nextSibling.textContent.trim()
  }))",
  "returnByValue": true
}')

# 4. Parse and display results
echo "$REPOS" | jq -r '.result.value[] | "\(.name) - \(.stars) stars"'

# 5. Navigate to first repository
FIRST_URL=$(echo "$REPOS" | jq -r '.result.value[0].url')
bdg cdp Page.navigate --params "{\"url\": \"$FIRST_URL\"}"

# 6. Wait for navigation to complete (check readyState)
while true; do
  STATE=$(bdg cdp Runtime.evaluate --params '{
    "expression": "document.readyState",
    "returnByValue": true
  }' | jq -r '.result.value')
  
  [ "$STATE" = "complete" ] && break
  sleep 0.5
done

# 7. Extract README content
README=$(bdg cdp Runtime.evaluate --params '{
  "expression": "document.querySelector(\"#readme\")?.textContent || \"No README found\"",
  "returnByValue": true
}')

echo "$README" | jq -r '.result.value'

# 8. Stop session (captures final DOM snapshot and writes output)
bdg stop
```

**Key takeaways**:
- ✅ No custom wrappers needed - raw CDP handles everything
- ✅ `Runtime.evaluate` executes arbitrary JavaScript in browser context
- ✅ Shell loops provide waiting/polling logic
- ✅ `jq` parses CDP JSON responses
- ✅ Session lifecycle: `start` → CDP commands → `stop`

---

## Core Patterns

### Pattern 1: Execute JavaScript

Use `Runtime.evaluate` to run JavaScript and get results:

```bash
# Simple expression (returns primitive value)
bdg cdp Runtime.evaluate --params '{
  "expression": "document.title",
  "returnByValue": true
}'

# Complex JavaScript (returns object)
bdg cdp Runtime.evaluate --params '{
  "expression": "({url: window.location.href, title: document.title})",
  "returnByValue": true
}'

# Extract to shell variable
TITLE=$(bdg cdp Runtime.evaluate --params '{
  "expression": "document.title",
  "returnByValue": true
}' | jq -r '.result.value')

echo "Page title: $TITLE"
```

**Key points**:
- `returnByValue: true` serializes objects to JSON
- Without it, you get a remote object reference
- Use `jq -r '.result.value'` to extract the actual value

### Pattern 2: Query DOM Elements

Query elements and extract data:

```bash
# Get all links on page
bdg cdp Runtime.evaluate --params '{
  "expression": "Array.from(document.querySelectorAll(\"a\")).map(a => ({text: a.textContent, href: a.href}))",
  "returnByValue": true
}' | jq '.result.value'

# Check if element exists
EXISTS=$(bdg cdp Runtime.evaluate --params '{
  "expression": "document.querySelector(\"#my-element\") !== null",
  "returnByValue": true
}' | jq -r '.result.value')

if [ "$EXISTS" = "true" ]; then
  echo "Element found!"
fi

# Get element bounding box
bdg cdp Runtime.evaluate --params '{
  "expression": "document.querySelector(\"#logo\").getBoundingClientRect()",
  "returnByValue": true
}' | jq '.result.value'
```

### Pattern 3: Navigate Pages

Control page navigation:

```bash
# Navigate to URL
bdg cdp Page.navigate --params '{"url": "https://example.com"}'

# Wait for navigation complete (check readyState)
while true; do
  STATE=$(bdg cdp Runtime.evaluate --params '{
    "expression": "document.readyState",
    "returnByValue": true
  }' | jq -r '.result.value')
  
  [ "$STATE" = "complete" ] && break
  sleep 0.5
done

# Reload page (bypass cache)
bdg cdp Page.reload --params '{"ignoreCache": true}'

# Go back/forward
bdg cdp Runtime.evaluate --params '{
  "expression": "window.history.back()"
}'
```

### Pattern 4: Network Control

Manipulate network behavior:

```bash
# Disable cache
bdg cdp Network.enable
bdg cdp Network.setCacheDisabled --params '{"cacheDisabled": true}'

# Set custom headers
bdg cdp Network.setExtraHTTPHeaders --params '{
  "headers": {"X-Custom-Header": "value"}
}'

# Block URLs (e.g., analytics)
bdg cdp Network.setBlockedURLs --params '{
  "urls": ["*analytics*", "*tracking*"]
}'

# Emulate slow connection
bdg cdp Network.emulateNetworkConditions --params '{
  "offline": false,
  "latency": 100,
  "downloadThroughput": 750000,
  "uploadThroughput": 250000
}'
```

### Pattern 5: Take Screenshots

Capture page screenshots:

```bash
# Full page screenshot (PNG)
SCREENSHOT=$(bdg cdp Page.captureScreenshot --params '{
  "format": "png",
  "captureBeyondViewport": true
}')

# Save to file
echo "$SCREENSHOT" | jq -r '.data' | base64 -d > screenshot.png

# Viewport screenshot (JPEG)
bdg cdp Page.captureScreenshot --params '{
  "format": "jpeg",
  "quality": 80
}' | jq -r '.data' | base64 -d > viewport.jpg

# Specific element screenshot (requires coordinates)
RECT=$(bdg cdp Runtime.evaluate --params '{
  "expression": "document.querySelector(\"#logo\").getBoundingClientRect()",
  "returnByValue": true
}' | jq '.result.value')

X=$(echo "$RECT" | jq '.x')
Y=$(echo "$RECT" | jq '.y')
WIDTH=$(echo "$RECT" | jq '.width')
HEIGHT=$(echo "$RECT" | jq '.height')

bdg cdp Page.captureScreenshot --params "{
  \"format\": \"png\",
  \"clip\": {
    \"x\": $X,
    \"y\": $Y,
    \"width\": $WIDTH,
    \"height\": $HEIGHT,
    \"scale\": 1
  }
}" | jq -r '.data' | base64 -d > element.png
```

---

## Recipe Index

### 1. Extract Text from Element

```bash
TEXT=$(bdg cdp Runtime.evaluate --params '{
  "expression": "document.querySelector(\"h1\").textContent",
  "returnByValue": true
}' | jq -r '.result.value')

echo "Heading: $TEXT"
```

### 2. Get Element Bounding Box

```bash
BBOX=$(bdg cdp Runtime.evaluate --params '{
  "expression": "document.querySelector(\"#element\").getBoundingClientRect()",
  "returnByValue": true
}')

echo "$BBOX" | jq '.result.value'
# Output: {"x": 10, "y": 20, "width": 100, "height": 50, ...}
```

### 3. Check Element Visibility

```bash
VISIBLE=$(bdg cdp Runtime.evaluate --params '{
  "expression": "(function() {
    const el = document.querySelector(\"#element\");
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== \"none\" && style.visibility !== \"hidden\" && style.opacity !== \"0\";
  })()",
  "returnByValue": true
}' | jq -r '.result.value')

echo "Element visible: $VISIBLE"
```

### 4. Navigate with Retry

```bash
MAX_RETRIES=3
URL="https://example.com"

for i in $(seq 1 $MAX_RETRIES); do
  echo "Attempt $i/$MAX_RETRIES"
  
  RESULT=$(bdg cdp Page.navigate --params "{\"url\": \"$URL\"}")
  EXIT_CODE=$?
  
  if [ $EXIT_CODE -eq 0 ]; then
    echo "Navigation successful"
    break
  fi
  
  if [ $i -eq $MAX_RETRIES ]; then
    echo "Navigation failed after $MAX_RETRIES attempts"
    exit 101  # CDP_CONNECTION_FAILURE
  fi
  
  sleep 2
done
```

### 5. Get All Cookies

```bash
bdg cdp Network.enable

COOKIES=$(bdg cdp Network.getCookies)
echo "$COOKIES" | jq '.cookies'

# Filter specific cookie
echo "$COOKIES" | jq '.cookies[] | select(.name == "session")'
```

### 6. Disable Cache

```bash
bdg cdp Network.enable
bdg cdp Network.setCacheDisabled --params '{"cacheDisabled": true}'

echo "Cache disabled - all requests will bypass cache"
```

### 7. Throttle Network

```bash
# Emulate slow 3G
bdg cdp Network.enable
bdg cdp Network.emulateNetworkConditions --params '{
  "offline": false,
  "latency": 400,
  "downloadThroughput": 400000,
  "uploadThroughput": 400000
}'

echo "Network throttled to slow 3G speeds"
```

### 8. Block URL Patterns

```bash
bdg cdp Network.enable
bdg cdp Network.setBlockedURLs --params '{
  "urls": [
    "*analytics*",
    "*tracking*",
    "*ads*",
    "*facebook.com*"
  ]
}'

echo "Blocked analytics, tracking, ads, and Facebook"
```

### 9. Evaluate JavaScript Safely

```bash
# Wrap in try-catch to handle errors
RESULT=$(bdg cdp Runtime.evaluate --params '{
  "expression": "(function() {
    try {
      return document.querySelector(\"#element\").textContent;
    } catch (e) {
      return null;
    }
  })()",
  "returnByValue": true
}')

VALUE=$(echo "$RESULT" | jq -r '.result.value')

if [ "$VALUE" = "null" ]; then
  echo "Element not found"
else
  echo "Element text: $VALUE"
fi
```

### 10. Wait for Element (Manual Polling)

```bash
TIMEOUT=10  # seconds
INTERVAL=0.5  # seconds
ELAPSED=0

while [ $(echo "$ELAPSED < $TIMEOUT" | bc) -eq 1 ]; do
  EXISTS=$(bdg cdp Runtime.evaluate --params '{
    "expression": "document.querySelector(\"#target\") !== null",
    "returnByValue": true
  }' | jq -r '.result.value')
  
  if [ "$EXISTS" = "true" ]; then
    echo "Element found after ${ELAPSED}s"
    break
  fi
  
  sleep $INTERVAL
  ELAPSED=$(echo "$ELAPSED + $INTERVAL" | bc)
done

if [ "$EXISTS" != "true" ]; then
  echo "Timeout: Element not found after ${TIMEOUT}s"
  exit 102  # CDP_TIMEOUT
fi
```

### 11. Get Page Metrics

```bash
bdg cdp Performance.enable

# Get performance metrics
METRICS=$(bdg cdp Performance.getMetrics)
echo "$METRICS" | jq '.metrics[] | {name, value}'

# Get layout metrics (viewport, page dimensions)
LAYOUT=$(bdg cdp Page.getLayoutMetrics)
echo "$LAYOUT" | jq '.'
```

### 12. Emulate Device

```bash
# Emulate iPhone 12 Pro
bdg cdp Emulation.setDeviceMetricsOverride --params '{
  "width": 390,
  "height": 844,
  "deviceScaleFactor": 3,
  "mobile": true
}'

bdg cdp Emulation.setUserAgentOverride --params '{
  "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15"
}'

echo "Emulating iPhone 12 Pro"
```

### 13. Handle JavaScript Dialogs

```bash
# Enable Page domain to receive dialog events
bdg cdp Page.enable

# Navigate to page with alert/confirm/prompt
bdg cdp Page.navigate --params '{"url": "https://example.com"}'

# If dialog appears, dismiss it automatically
# (bdg already auto-dismisses dialogs by default via dialog handler)

# Manually handle dialog
bdg cdp Page.handleJavaScriptDialog --params '{
  "accept": true,
  "promptText": "user input"
}'
```

### 14. Print to PDF

```bash
PDF=$(bdg cdp Page.printToPDF --params '{
  "landscape": false,
  "displayHeaderFooter": false,
  "printBackground": true,
  "scale": 1,
  "paperWidth": 8.5,
  "paperHeight": 11,
  "marginTop": 0.4,
  "marginBottom": 0.4,
  "marginLeft": 0.4,
  "marginRight": 0.4
}')

echo "$PDF" | jq -r '.data' | base64 -d > page.pdf
echo "PDF saved to page.pdf"
```

### 15. Execute Async JavaScript

```bash
# Use Runtime.evaluate with awaitPromise for async operations
RESULT=$(bdg cdp Runtime.evaluate --params '{
  "expression": "(async function() {
    const response = await fetch(\"/api/data\");
    return await response.json();
  })()",
  "awaitPromise": true,
  "returnByValue": true
}')

echo "$RESULT" | jq '.result.value'
```

---

## Error Handling

### Check Exit Codes

`bdg` uses semantic exit codes for error handling:

```bash
bdg cdp Page.navigate --params '{"url": "https://example.com"}'
EXIT_CODE=$?

case $EXIT_CODE in
  0)
    echo "Success"
    ;;
  80)
    echo "Invalid URL format"
    ;;
  101)
    echo "CDP connection failure"
    exit 101
    ;;
  102)
    echo "CDP timeout"
    exit 102
    ;;
  *)
    echo "Unknown error (exit code: $EXIT_CODE)"
    exit 1
    ;;
esac
```

**Reference**: See `docs/EXIT_CODES.md` for complete list.

### Parse CDP Errors

CDP errors are returned in JSON response:

```bash
RESULT=$(bdg cdp Runtime.evaluate --params '{
  "expression": "document.nonExistentMethod()"
}')

# Check for CDP error
if echo "$RESULT" | jq -e '.exceptionDetails' > /dev/null; then
  echo "JavaScript error:"
  echo "$RESULT" | jq '.exceptionDetails.exception.description'
  exit 1
fi

# Extract successful result
echo "$RESULT" | jq '.result.value'
```

### Retry with Exponential Backoff

```bash
function retry_with_backoff() {
  local max_attempts=$1
  shift
  local cmd="$@"
  local attempt=1
  local delay=1
  
  while [ $attempt -le $max_attempts ]; do
    echo "Attempt $attempt/$max_attempts: $cmd"
    
    if eval "$cmd"; then
      return 0
    fi
    
    if [ $attempt -eq $max_attempts ]; then
      echo "Failed after $max_attempts attempts"
      return 1
    fi
    
    echo "Retrying in ${delay}s..."
    sleep $delay
    delay=$((delay * 2))  # Exponential backoff
    attempt=$((attempt + 1))
  done
}

# Usage
retry_with_backoff 3 bdg cdp Page.navigate --params '{"url": "https://example.com"}'
```

### Graceful Degradation

```bash
# Try to get element, fall back to default if not found
TITLE=$(bdg cdp Runtime.evaluate --params '{
  "expression": "document.querySelector(\"h1\")?.textContent || \"No title found\"",
  "returnByValue": true
}' | jq -r '.result.value')

echo "Title: $TITLE"
```

---

## Waiting Strategies

### Strategy 1: Poll Until Condition Met

```bash
function wait_for_condition() {
  local condition=$1
  local timeout=${2:-10}
  local interval=${3:-0.5}
  local elapsed=0
  
  while [ $(echo "$elapsed < $timeout" | bc) -eq 1 ]; do
    RESULT=$(bdg cdp Runtime.evaluate --params "{
      \"expression\": \"$condition\",
      \"returnByValue\": true
    }" | jq -r '.result.value')
    
    if [ "$RESULT" = "true" ]; then
      return 0
    fi
    
    sleep $interval
    elapsed=$(echo "$elapsed + $interval" | bc)
  done
  
  return 1  # Timeout
}

# Usage: Wait for element to exist
if wait_for_condition "document.querySelector('#element') !== null" 10 0.5; then
  echo "Element found"
else
  echo "Timeout waiting for element"
  exit 102
fi
```

### Strategy 2: Wait for Navigation Complete

```bash
function wait_for_navigation() {
  local timeout=${1:-10}
  local interval=0.5
  local elapsed=0
  
  while [ $(echo "$elapsed < $timeout" | bc) -eq 1 ]; do
    STATE=$(bdg cdp Runtime.evaluate --params '{
      "expression": "document.readyState",
      "returnByValue": true
    }' | jq -r '.result.value')
    
    if [ "$STATE" = "complete" ]; then
      return 0
    fi
    
    sleep $interval
    elapsed=$(echo "$elapsed + $interval" | bc)
  done
  
  return 1
}

# Navigate and wait
bdg cdp Page.navigate --params '{"url": "https://example.com"}'
wait_for_navigation 10 || {
  echo "Navigation timeout"
  exit 102
}
```

### Strategy 3: Wait for Network Idle

```bash
# bdg automatically waits for network idle on start
# For manual navigation, poll for active requests:

function wait_for_network_idle() {
  local timeout=${1:-10}
  local idle_time=${2:-2}  # seconds of idle
  local interval=0.5
  local elapsed=0
  local idle_elapsed=0
  
  bdg cdp Network.enable
  
  while [ $(echo "$elapsed < $timeout" | bc) -eq 1 ]; do
    # Check if there are active network requests
    # Note: This is simplified - in practice you'd track request/response events
    sleep $interval
    elapsed=$(echo "$elapsed + $interval" | bc)
    idle_elapsed=$(echo "$idle_elapsed + $interval" | bc)
    
    if [ $(echo "$idle_elapsed >= $idle_time" | bc) -eq 1 ]; then
      return 0
    fi
  done
  
  return 1
}
```

### Strategy 4: Wait for Multiple Conditions

```bash
function wait_for_all() {
  local timeout=${1:-10}
  shift
  local conditions=("$@")
  local interval=0.5
  local elapsed=0
  
  while [ $(echo "$elapsed < $timeout" | bc) -eq 1 ]; do
    local all_met=true
    
    for condition in "${conditions[@]}"; do
      RESULT=$(bdg cdp Runtime.evaluate --params "{
        \"expression\": \"$condition\",
        \"returnByValue\": true
      }" | jq -r '.result.value')
      
      if [ "$RESULT" != "true" ]; then
        all_met=false
        break
      fi
    done
    
    if [ "$all_met" = true ]; then
      return 0
    fi
    
    sleep $interval
    elapsed=$(echo "$elapsed + $interval" | bc)
  done
  
  return 1
}

# Usage: Wait for page ready AND element visible
wait_for_all 10 \
  "document.readyState === 'complete'" \
  "document.querySelector('#content') !== null" \
  "document.querySelector('#content').offsetParent !== null"
```

---

## Best Practices

### 1. Always Use `returnByValue: true`

Without it, you get remote object references that require additional CDP calls:

```bash
# ❌ BAD: Returns object reference
bdg cdp Runtime.evaluate --params '{
  "expression": "{name: \"test\"}"
}'
# Output: {"type": "object", "objectId": "12345..."}

# ✅ GOOD: Returns serialized value
bdg cdp Runtime.evaluate --params '{
  "expression": "{name: \"test\"}",
  "returnByValue": true
}'
# Output: {"type": "object", "value": {"name": "test"}}
```

### 2. Wrap JavaScript in Try-Catch

Prevent CDP errors from breaking your script:

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

### 3. Use IIFEs for Complex JavaScript

Immediately Invoked Function Expressions avoid polluting global scope:

```bash
# ✅ GOOD: IIFE pattern
bdg cdp Runtime.evaluate --params '{
  "expression": "(function() {
    const elements = document.querySelectorAll(\"a\");
    return Array.from(elements).map(a => a.href);
  })()",
  "returnByValue": true
}'
```

### 4. Check Exit Codes for Every CDP Command

Don't assume success:

```bash
bdg cdp Page.navigate --params '{"url": "https://example.com"}'
if [ $? -ne 0 ]; then
  echo "Navigation failed"
  exit 101
fi
```

### 5. Enable Domains Before Use

Some CDP domains require explicit enabling:

```bash
# Enable before using Network methods
bdg cdp Network.enable
bdg cdp Network.setCacheDisabled --params '{"cacheDisabled": true}'

# Enable before using Performance methods
bdg cdp Performance.enable
bdg cdp Performance.getMetrics
```

### 6. Use `jq` for JSON Parsing

Don't try to parse JSON with shell tools:

```bash
# ✅ GOOD: Use jq
VALUE=$(bdg cdp Runtime.evaluate --params '{...}' | jq -r '.result.value')

# ❌ BAD: Don't use grep/sed/awk for JSON
VALUE=$(bdg cdp Runtime.evaluate --params '{...}' | grep -oP '(?<="value":")[^"]*')
```

---

## Additional Resources

- **CDP Protocol Reference**: https://chromedevtools.github.io/devtools-protocol/
- **Exit Codes**: `docs/EXIT_CODES.md`
- **CLI Reference**: `docs/CLI_REFERENCE.md`
- **Machine-Readable Help**: `bdg --help --json`

---

## Quick Reference

### Common CDP Domains

| Domain | Purpose | Must Enable? |
|--------|---------|--------------|
| `Runtime` | JavaScript execution, object inspection | No |
| `Page` | Navigation, screenshots, lifecycle | No |
| `Network` | Network control, caching, blocking | Yes |
| `Performance` | Performance metrics | Yes |
| `DOM` | DOM tree inspection | Yes |
| `Emulation` | Device emulation | No |

### Common JavaScript Patterns

```javascript
// Check element exists
document.querySelector('#id') !== null

// Get element text
document.querySelector('h1').textContent

// Get all matching elements
Array.from(document.querySelectorAll('a')).map(a => a.href)

// Check visibility
el.offsetParent !== null && getComputedStyle(el).display !== 'none'

// Get bounding box
document.querySelector('#id').getBoundingClientRect()

// Wait for condition (page readyState)
document.readyState === 'complete'
```

### Session Lifecycle

```bash
bdg start <url>              # Start session + launch Chrome
bdg cdp <Domain>.<method>    # Execute CDP commands
bdg status                   # Check session status
bdg peek                     # Preview collected data
bdg stop                     # Stop session + write output
```
