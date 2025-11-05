# Browser Debugger CLI

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/szymdzum/browser-debugger-cli/pulls)
[![CI](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml)
[![Security](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml)
[![npm downloads](https://img.shields.io/npm/dt/browser-debugger-cli?color=blue)](https://www.npmjs.com/package/browser-debugger-cli)

DevTools telemetry in your terminal. For humans and agents. Direct WebSocket to Chrome's debugging port. Stream DOM, network, and console data straight to stdout. Pipe it, grep it, feed it to agents for full context debugging.

## Installation

```bash
# Latest alpha release (recommended)
npm install -g browser-debugger-cli@alpha

# Or install specific version
npm install -g browser-debugger-cli@0.1.0-alpha.0
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

# Preview collected data
bdg peek --last 5
# NETWORK [0] GET http://example.com/ (200)
# NETWORK [1] GET http://example.com/style.css (200)
# ...

# Execute raw CDP commands
bdg cdp Runtime.evaluate --params '{"expression":"document.title","returnByValue":true}'
# { "result": { "type": "string", "value": "Example Domain" } }

# Stop session
bdg stop
```

## Philosophy

There's no good CLI for Chrome DevTools Protocol. MCP servers work (most of the time) but are token-heavy and monolithic. Puppeteer is for automation, not inspection. Lighthouse is single-purpose.

`bdg` takes the Unix approach: small, composable commands that pipe with `jq` and `grep` tools models already know—without the token overhead.

**Why CLI over protocol servers?**
- **Token efficiency**: CDP is in the model's training data. A skill doc with usage
  patterns? ~3k tokens. MCP server definitions? 5-10k before you invoke anything.
- **Composability**: Pipe commands together. Each does one thing well.
- **Transparent errors**: See exactly what failed. No protocol layers hiding the
  issue.
- **Real-time evolution**: Update usage patterns anytime. No server redeployment
  needed.

The vision: Terminal-native browser debugging that's as composable as `curl` and `jq`.

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
# Check if session is active
bdg status
# Status: Active
# Worker PID: 12345
# Chrome PID: 67890
# Target: http://example.com

# Stop session
bdg stop

# Clean up stale sessions
bdg cleanup
bdg cleanup --force  # Force cleanup even if session appears active
```

### Live Data Inspection

```bash
# Preview collected data without stopping
bdg peek
bdg peek --last 10          # Show last 10 items
bdg peek --network          # Only network requests
bdg peek --console          # Only console logs
bdg peek --follow           # Live updates every second
bdg peek --json             # JSON output

# Get detailed information
bdg details network <requestId>    # Full request/response with bodies
bdg details console <index>        # Full console message with args
```

### DOM Inspection

```bash
# Query DOM elements
bdg dom query "document.title"
bdg dom query ".error-message"

# Get element by selector or index
bdg dom get ".main-content"
bdg dom get 0  # Get first element from cache

# Evaluate JavaScript
bdg dom eval "window.location.href"
```

### Network & Console Commands

```bash
# Inspect network state
bdg network

# Query console logs
bdg console
bdg console --json
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
