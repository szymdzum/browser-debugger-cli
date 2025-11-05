# Browser Debugger CLI

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/szymdzum/browser-debugger-cli/pulls)
[![CI](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml)
[![Security](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml)
[![npm downloads](https://img.shields.io/npm/dt/browser-debugger-cli?color=blue)](https://www.npmjs.com/package/browser-debugger-cli)

DevTools telemetry in your terminal. For humans and agents. Direct WebSocket to Chrome's debugging port. Stream DOM, network, and console data straight to stdout. Pipe it, grep it, feed it to agents for full context debugging.

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

# Data inspection (planned)
bdg peek            # Quick preview of collected data
bdg details         # Full details for specific items
bdg dom query       # Query DOM elements
bdg network         # Network request inspector
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
