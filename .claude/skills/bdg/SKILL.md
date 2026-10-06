---
name: bdg
description: Use bdg CLI to drive and debug a real Chrome via Chrome DevTools Protocol - navigate, click, fill and submit forms, check what an action changed (navigation, new messages, pending requests), inspect elements without screenshots (box, layout, fonts, colors, a11y), read network requests and console errors, and call any CDP method. Use this skill when you need to verify a UI change in a running app, debug a page, automate a browser flow, or scrape dynamic content.
---

# bdg - Browser Automation CLI

## Quick Start

```bash
bdg https://example.com          # Start session (launches Chrome)
bdg dom screenshot /tmp/page.png # Take screenshot
bdg stop                         # End session
```

## Session Management

```bash
bdg <url>                  # Start session (1920x1080, headless if no display)
bdg <url> --headless       # Force headless mode
bdg <url> --no-headless    # Force visible browser window
bdg status                 # Check session status
bdg peek                   # Preview collected telemetry
bdg stop                   # End session (use sparingly)
bdg cleanup                # Clean up after a crashed session
bdg cleanup --force        # Kill a stuck session (daemon + its Chrome)
```

**Sessions run indefinitely by default** (no timeout). With HMR/hot-reload dev servers, keep the session running:

```bash
bdg http://localhost:5173      # Start once
# ... make code changes, HMR updates the page ...
bdg dom screenshot /tmp/s.png  # Check anytime
bdg peek                       # Preview collected data
# No need to stop/restart - Chrome stays on the page
```

**Don't stop sessions prematurely** - use `bdg peek` to inspect data. Only call `bdg stop` when completely done with browser automation.

## Screenshots

Always use `bdg dom screenshot` (raw CDP is blocked):

```bash
bdg dom screenshot /tmp/page.png                    # Full page
bdg dom screenshot /tmp/viewport.png --no-full-page # Viewport only
bdg dom screenshot /tmp/el.png --selector "#main"   # Element only
bdg dom screenshot /tmp/scroll.png --scroll "#target" # Scroll to element first
```

## Actions Report What Changed

`dom click`, `fill`, `submit`, `pressKey`, `hover` and `scroll` wait for the requests the action starts, then say what happened. Read this before reaching for a screenshot:

```text
✓ Element Clicked
Page: navigated to https://app.test/secure (200)    # navigation (or "URL changed ... (same document)")
New text: "Your password is invalid!" (div#flash)   # alert/status/aria-live messages that appeared
⚠ Element Clicked (no visible effect observed ...)  # nothing changed - wrong element or a broken handler
```

- In `--json`: `navigation`, `messages`, `effect: "none"` and pending work (timers, spinners) are fields on `data`.
- Results the page shows later are not waited for: follow up with `bdg dom wait` (below).

## Form Interaction

```bash
# Discover forms
bdg dom form --brief              # Quick scan: field names, types, required

# Fill and interact
bdg dom fill "input[name='user']" "myuser"    # Fill by selector
bdg dom fill 0 "value"                         # Fill by index (from query)
bdg dom click "button.submit"                  # Click element
bdg dom submit "form" --wait-navigation        # Submit and wait for page load
bdg dom pressKey "input" Enter                 # Press Enter key

# Options
--no-wait          # Skip network stability wait
--wait-navigation  # Wait for page navigation (traditional forms)
--wait-network <ms> # Wait for network idle (SPA forms)
--index <n>        # Select nth element when multiple match
```

## DOM Inspection

```bash
bdg dom query "selector"     # Find elements, returns [0], [1], [2]... (0-based)
bdg dom get "selector"       # Get semantic a11y info (token-efficient)
bdg dom get "selector" --raw # Get full HTML
bdg dom eval "js expression" # Run JavaScript
bdg dom a11y "role:button"   # Query by accessibility role/name
```

Selectors search open shadow roots and same-origin iframes, and accept `:has-text("...")` and `:visible`.

### Look Without a Screenshot

```bash
bdg dom inspect "button.primary"   # Box, layout, rendered font, colors + WCAG contrast, borders, state (~60-100 tokens)
bdg dom inspect ".card" --why color  # Which CSS rule set a property, and what it overrode
bdg dom layout ".card"             # Positions/sizes of every match: above/below the fold, hidden, covered
bdg dom listeners "#save"          # Event listeners that run for an element (incl. delegated, React/Preact)
bdg page emulate --viewport 390x844 --color-scheme dark   # Responsive/theme check mid-session
```

### Wait for Something

```bash
bdg dom wait '#result' --visible       # Appears and is visible
bdg dom wait '.toast' --text 'Saved'   # Contains text
bdg dom wait '#loading' --gone         # Spinner went away
bdg dom wait --load                    # Page finished loading
```

## Network and Console

```bash
bdg network list                              # Requests (DevTools-style)
bdg network list --filter "status-code:>=400" # Failed requests
bdg details network <id>                      # Headers, timing, body of one request
bdg console --level error                     # Console errors on the current page
bdg console --follow                          # Stream messages live
bdg network har /tmp/session.har              # Export HAR 1.2
```

## CDP Access

Direct access to Chrome DevTools Protocol:

```bash
# Execute any CDP method
bdg cdp Runtime.evaluate --params '{"expression": "document.title", "returnByValue": true}'
bdg cdp Page.navigate --params '{"url": "https://example.com"}'
bdg cdp Page.reload --params '{"ignoreCache": true}'

# Discovery
bdg cdp --list                    # List all domains
bdg cdp Network --list            # List methods in domain
bdg cdp Network.getCookies --describe  # Show method schema
bdg cdp --search cookie           # Search methods
```

**Important**: Always use `returnByValue: true` for Runtime.evaluate to get serialized values.

## Common Patterns

### Login Flow
```bash
bdg https://example.com/login
bdg dom form --brief
bdg dom fill "input[name='username']" "$USER"
bdg dom fill "input[name='password']" "$PASS"
bdg dom submit "button[type='submit']" --wait-navigation
bdg dom screenshot /tmp/result.png
bdg stop
```

### Verify a UI Change (dev server with HMR)
```bash
bdg http://localhost:5173                 # Once; keep the session running
bdg dom click "button.save"               # Read the reported effect
bdg dom wait '.toast' --text 'Saved'
bdg console --level error                 # Anything thrown?
bdg dom inspect ".toast"                  # Looks right? (no screenshot needed)
```

### Extract Data
```bash
bdg cdp Runtime.evaluate --params '{
  "expression": "Array.from(document.querySelectorAll(\"a\")).map(a => ({text: a.textContent, href: a.href}))",
  "returnByValue": true
}' | jq '.data.result.result.value'
```

## JSON Output and Exit Codes

Add `--json` (`-j`) to any command for `{ version, success, data }` (or `{ success: false, error, exitCode, suggestion }`). `bdg --help --json` lists every command, flag and exit code.

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | - |
| 81 | Invalid arguments (incl. blocked raw CDP methods) | Read the suggestion, use the alternative |
| 83 | Resource not found | Element/session doesn't exist |
| 85 | Session busy (still starting/stopping) | Retry shortly |
| 87 | Stale index (page changed since `dom query`) | Re-run the query |
| 91 | `dom eval` script threw | Fix the JavaScript |
| 101 | CDP connection failure | Run `bdg cleanup --force` and retry |
| 102 | Timeout (CDP, or `dom wait --timeout`) | Increase timeout or check page load |

## Troubleshooting

```bash
bdg status --verbose      # Full diagnostics
bdg cleanup               # Clean up after a crashed session
bdg cleanup --force       # Kill a stuck session (daemon + its Chrome)
```

**Chrome won't launch?** Run `bdg cleanup --force` then retry.

**Session stuck?** Run `bdg cleanup --force` to reset.

### Custom Chrome Flags

Use `--chrome-flags` or `BDG_CHROME_FLAGS` for self-signed certificates, CORS, etc.:

```bash
# CLI option
bdg https://localhost:5173 --chrome-flags="--ignore-certificate-errors"

# Environment variable
BDG_CHROME_FLAGS="--ignore-certificate-errors" bdg https://localhost:5173

# Multiple flags
bdg https://example.com --chrome-flags="--ignore-certificate-errors --disable-web-security"
```

**Common flags for development:**
- `--ignore-certificate-errors` - Self-signed SSL certs
- `--disable-web-security` - CORS issues in development
- `--allow-insecure-localhost` - Insecure localhost
- `--disable-features=IsolateOrigins,site-per-process` - Cross-origin iframes

## Verification Best Practices

**Prefer DOM queries over screenshots** for verification:

```bash
# GOOD: Fast, precise, scriptable
bdg cdp Runtime.evaluate --params '{
  "expression": "document.querySelector(\".error-message\")?.textContent",
  "returnByValue": true
}'

# GOOD: Check element exists
bdg dom query ".submit-btn"

# GOOD: Check text content
bdg cdp Runtime.evaluate --params '{
  "expression": "document.body.innerText.includes(\"Success\")",
  "returnByValue": true
}'

# AVOID: Screenshots for simple verification (slow, requires visual inspection)
bdg dom screenshot /tmp/check.png  # Only use when you need visual proof
```

**When to use screenshots:**
- Visual regression testing
- Capturing proof for user review
- Debugging layout issues
- When DOM structure is unknown

**When to use DOM queries:**
- Verifying text content appeared
- Checking element exists/visible
- Validating form state
- Counting elements
- Any programmatic assertion

## When NOT to Use bdg

- **Static HTML** - Use `curl` + `htmlq`/`pq`
- **API calls** - Use `curl` + `jq`
- **Simple HTTP** - Use `wget`/`curl`

Use bdg when you need: JavaScript execution, dynamic content, browser APIs, screenshots, or network manipulation.
