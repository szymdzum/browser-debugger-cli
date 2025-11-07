# Browser Debugger CLI

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/szymdzum/browser-debugger-cli/pulls)
[![CI](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml)
[![Security](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml)
[![npm downloads](https://img.shields.io/npm/dt/browser-debugger-cli?color=blue)](https://www.npmjs.com/package/browser-debugger-cli)

DevTools telemetry in your terminal, for humans and agents alike. Direct WebSocket to Chrome's debugging port streams DOM, network, and console data straight to stdout. Pipe it, grep it, feed it to your agents for full context debugging.

## Demo

[![asciicast](https://asciinema.org/a/RE6Iup9sB1iSWBK0wgUUn3bBl.svg)](https://asciinema.org/a/RE6Iup9sB1iSWBK0wgUUn3bBl)

*Watch bdg scrape GitHub trending pages and extract repository data in real-time using DOM queries and CDP.*

## Installation

```bash
npm install -g browser-debugger-cli@alpha
```

## Quick Start

```bash
# Start session (opens example.com in Chrome)
bdg example.com

# Daemon starts in background, Chrome opens
# Session is active - you can now run commands

# Check session status
bdg status
# Status: Active
# Worker PID: 12345
# Chrome PID: 67890
# Target: http://example.com

# Execute raw CDP commands
bdg cdp Runtime.evaluate --params '{"expression":"document.title","returnByValue":true}'
# { "result": { "type": "string", "value": "Example Domain" } }

bdg cdp Network.getCookies
# { "cookies": [...] }

# Stop session
bdg stop
```

## How It Works

`bdg` is built on a **layered architecture** — raw CDP access with human-friendly wrappers on top.

### Layer 1: Raw CDP Access ✅

Direct access to **60+ domains, 300+ methods** from [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/):

```bash
# Execute any CDP method
bdg cdp Network.getCookies
bdg cdp Runtime.evaluate --params '{"expression":"document.title","returnByValue":true}'
bdg cdp Performance.getMetrics

# Pipe to jq for filtering
bdg cdp Network.getCookies | jq '.cookies[] | select(.name == "session")'
```

**Why raw CDP first?**
- ✅ Zero abstraction overhead — direct WebSocket to Chrome
- ✅ Full protocol power — all CDP methods work immediately
- ✅ Future-proof — new CDP features work without code changes
- ✅ Agent-friendly — structured input/output, composable with Unix tools

### Layer 2: Human-Friendly Wrappers 🚧

Building ergonomic commands on top of raw CDP for common workflows:

```bash
# Session management
bdg status          # Check active session
bdg stop            # Stop session gracefully
bdg cleanup         # Clean up stale sessions

# Data inspection
bdg peek            # Quick preview of collected data (snapshot)
bdg tail            # Continuous monitoring (like tail -f)
bdg details         # Full details for specific items
bdg dom query       # Query DOM elements
bdg dom eval        # Execute JavaScript in browser context
bdg dom highlight   # Highlight elements visually
bdg dom get         # Get full HTML for elements
```

**Progressive disclosure**: Start with raw CDP power, add convenience wrappers for common patterns.

**Why CLI over protocol servers?**
- **Token efficiency**: CDP is in the model's training data (~3k tokens for patterns vs. 5-10k for MCP server definitions)
- **Composability**: Unix pipes with `jq`, `grep`, `awk` — tools models already know
- **Transparent errors**: See exactly what failed, no protocol layers hiding issues
- **Real-time evolution**: Update patterns anytime, no server redeployment

## Available Commands

### Raw CDP Access

Full Chrome DevTools Protocol access via `bdg cdp` command – **any CDP method works**:

```bash
# Get all cookies (raw CDP)
bdg cdp Network.getCookies
# {
#   "cookies": [
#     {
#       "name": "session_id",
#       "value": "1234567890abcdef",
#       "domain": "example.com",
#       "httpOnly": true,
#       "secure": true,
#       "sameSite": "Strict"
#     }
#   ]
# }

# Evaluate JavaScript
bdg cdp Runtime.evaluate --params '{"expression":"document.title","returnByValue":true}'
# {
#   "result": {
#     "type": "string",
#     "value": "Example Domain"
#   }
# }

# Get browser version
bdg cdp Browser.getVersion
# {
#   "protocolVersion": "1.3",
#   "product": "Chrome/142.0.7444.60",
#   "jsVersion": "14.2.231.14"
# }

# Pipe to jq for filtering
bdg cdp Network.getCookies | jq '.cookies[] | select(.name == "session_id") | .value'
# "1234567890abcdef"
```

**60+ domains, 300+ methods** from the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) are available.

### Session Management

```bash
# Start session
bdg example.com             # Opens Chrome with daemon in background

# Check if session is active
bdg status                  # Show session info
bdg status --verbose        # Include Chrome diagnostics

# Stop session
bdg stop                    # Gracefully stop daemon and close Chrome

# Clean up stale sessions
bdg cleanup                 # Remove stale session files
bdg cleanup --force         # Force cleanup even if session appears active
```

## Real-World Examples

### Debug API Failures in Real-Time

```bash
# Monitor network requests as you interact with the page
bdg localhost:3000 --headless
bdg tail --network

# Filter failed requests
bdg peek --network --json | jq '.data.network[] | select(.status >= 400)'

# See full request/response details
bdg details network <requestId>
```

### Extract Page Data for AI Agents

```bash
# Get page title and meta for context
bdg cdp Runtime.evaluate --params '{"expression":"({title: document.title, meta: Array.from(document.querySelectorAll(\"meta\")).map(m => ({name: m.name, content: m.content}))})", "returnByValue": true}'

# Get all visible text for RAG
bdg cdp Runtime.evaluate --params '{"expression":"document.body.innerText","returnByValue":true}' | jq -r '.result.value'

# Capture screenshots for vision models
bdg dom screenshot --output page.png
```

### Monitor Console Errors During Testing

```bash
# Watch for console errors in real-time
bdg https://your-app.com --headless
bdg tail --console

# Get last 50 console messages
bdg peek --console --last 50

# Export console logs to file
bdg stop > session-data.json
jq '.data.console' session-data.json > console-logs.json
```

### Inspect DOM Without DevTools

```bash
# Query elements by selector
bdg dom query "button.primary"

# Get element HTML
bdg dom get "button.primary"

# Highlight element on page (visual debugging)
bdg dom highlight ".navbar" --color red

# Execute JavaScript in page context
bdg dom eval "document.querySelector('.price').textContent"
```

### Pipe to Unix Tools

```bash
# Count failed network requests
bdg peek --network --json | jq '[.data.network[] | select(.status >= 400)] | length'

# Extract all external script URLs
bdg peek --network --json | jq -r '.data.network[] | select(.mimeType | contains("javascript")) | .url'

# Find largest requests
bdg peek --network --json | jq '.data.network | sort_by(.responseSize) | reverse | .[0:5]'

# Monitor performance metrics
bdg cdp Performance.getMetrics | jq '.metrics[] | select(.name == "JSHeapUsedSize")'
```

## Technical Overview

`bdg` runs a daemon that maintains a WebSocket connection to Chrome's debugging port.
When you run commands like `bdg network` or `bdg console`, they communicate with the
daemon via IPC, which forwards [Chrome DevTools
Protocol](https://chromedevtools.github.io/devtools-protocol/) commands and streams
responses back.

**Architecture:**
- **Daemon** – Background process managing Chrome connection lifecycle
- **IPC** – Unix sockets for CLI ↔ daemon communication
- **WebSocket** – Direct connection to Chrome's `--remote-debugging-port`
- **CDP** – Native Chrome DevTools Protocol for all browser inspection

**Benefits:**
- Sessions persist across commands (Chrome stays open)
- Live queries without stopping collection
- No intermediate files data flows from Chrome to stdout
- Real CDP with full protocol access

## Contributing

Contributions welcome! But honestly, I'd just be happy if you give it a try.

Let me know how you use it
([discussions](https://github.com/szymdzum/browser-debugger-cli/discussions)), let me
know what's broken
([issues](https://github.com/szymdzum/browser-debugger-cli/issues/new)).

## License

MIT – see [LICENSE](LICENSE) for details.
