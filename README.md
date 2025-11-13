# Browser Debugger CLI

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/szymdzum/browser-debugger-cli/pulls)
[![CI](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml)
[![Security](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml)
[![npm downloads](https://img.shields.io/npm/dt/browser-debugger-cli?color=blue)](https://www.npmjs.com/package/browser-debugger-cli)

Chrome DevTools Protocol in your terminal. Self-documenting CDP access with discovery, search, and introspection. Perfect for AI agents and developers who want direct browser control without the framework overhead.

## Why This Exists
Puppeteer is great but heavy. CDP is powerful but raw. This tool sits in between: direct protocol access with session management and a few helpful wrappers. No abstractions hiding what's actually happening.
Built for debugging web apps and scripting browser automation without spinning up a full testing framework.

## Current State

**Raw [CDP](https://chromedevtools.github.io/devtools-protocol/) access is complete.** All 300+ protocol methods work now. This makes it immediately useful for AI agents and developers comfortable with CDP.

**Human-friendly wrappers are in progress.** Commands like `bdg dom query` and `bdg peek` are being added for common operations. For now, most automation work happens through `bdg cdp` and Unix pipes.

## Demo

[![asciicast](https://asciinema.org/a/RE6Iup9sB1iSWBK0wgUUn3bBl.svg)](https://asciinema.org/a/RE6Iup9sB1iSWBK0wgUUn3bBl)

*Watch bdg scrape GitHub trending pages and extract repository data in real-time using DOM queries and CDP.*

## Installation

```bash
npm install -g browser-debugger-cli@alpha
```

**Platform Support:**
- ✅ macOS and Linux (native support)
- ✅ Windows via WSL (Windows Subsystem for Linux)
- ❌ PowerShell and Git Bash on Windows (not yet supported)

The CLI uses Unix domain sockets for inter-process communication. Windows users should run bdg inside WSL for full compatibility.

## Quick Start

```bash
# Start a session
bdg example.com

# Discover what's available
bdg cdp --list                    # List all 53 domains
bdg cdp Network --list            # List Network methods
bdg cdp --search cookie           # Search by keyword

# Run any CDP command
bdg cdp Network.getCookies
bdg cdp Runtime.evaluate --params '{"expression":"document.title","returnByValue":true}'

# Check what's running
bdg status

# Done
bdg stop
```

## What You Can Do

### Discover CDP Commands (53 Domains, 300+ Methods)

Built-in introspection helps you find what you need without reading docs:

```bash
# What can I do with this browser?
bdg cdp --list
# Returns: 53 domains (Network, DOM, Page, Runtime, Storage, etc.)

# What Network operations exist?
bdg cdp Network --list
# Returns: 39 methods with descriptions and parameter counts

# How do I use this method?
bdg cdp Network.getCookies --describe
# Returns: Full schema with parameters, types, examples

# Find cookie-related methods
bdg cdp --search cookie
# Returns: 14 methods across domains (Network.getCookies, Storage.getCookies, etc.)
```

All discovery commands output JSON for easy parsing. Perfect for AI agents building automation on the fly.

### Run Any CDP Command

All 300+ methods from [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) work out of the box:

```bash
# Get cookies and filter with jq
bdg cdp Network.getCookies | jq '.cookies[] | select(.httpOnly)'

# Execute JavaScript in the page
bdg cdp Runtime.evaluate --params '{"expression":"document.querySelectorAll(\"a\").length","returnByValue":true}'

# Monitor memory usage
bdg cdp Performance.getMetrics | jq '.metrics[] | select(.name == "JSHeapUsedSize")'

# Capture a screenshot
bdg cdp Page.captureScreenshot | jq -r '.data' | base64 -d > screenshot.png
```

The daemon keeps a WebSocket open to Chrome, so commands run immediately against the live session.

### Pipe Everything

Output is JSON by default. Use it with `jq`, `grep`, `awk` - whatever works:

```bash
# Find all failed network requests
bdg peek --network --json | jq '.data.network[] | select(.status >= 400)'

# Extract every link on the page
bdg cdp Runtime.evaluate --params '{
  "expression": "Array.from(document.querySelectorAll(\"a\")).map(a => ({text: a.textContent.trim(), href: a.href}))",
  "returnByValue": true
}' | jq '.result.value'

# Count console errors
bdg peek --console --json | jq '[.data.console[] | select(.level == "error")] | length'
```

### For AI Agents

**Self-documenting CDP discovery** - agents can explore 300+ browser capabilities without external docs:

```bash
# Agent discovers what's possible
bdg cdp --list                           # 53 domains available
bdg cdp --search screenshot              # Find relevant methods
bdg cdp Page.captureScreenshot --describe # Learn parameters
bdg cdp Page.captureScreenshot --params '{"format":"png"}' # Execute

# All commands return structured JSON for easy parsing
```

**Why this matters for agents:**
- No need to memorize CDP docs (1000+ pages)
- Discover → Learn → Execute in one tool
- Search by keyword (`--search`)
- Case-insensitive execution (forgiving for LLM outputs)
- Semantic exit codes for error handling

Claude skill included at `.claude/skills/bdg/` with working automation patterns:

- Common CDP workflows (scraping, polling, navigation)
- Exit codes and error handling
- Troubleshooting reference

The `--help --json` flag outputs the complete CLI schema for programmatic discovery:

```bash
bdg --help --json | jq '.command.subcommands[].name'
bdg --help --json | jq '.exitCodes'
```

### Debug Live Apps

Point at localhost, monitor what's happening:

```bash
bdg localhost:3000 --headless
bdg tail --console          # Stream console output
bdg tail --network          # Watch requests in real-time
```

Helpful for catching issues during development without opening DevTools.

### Automate Browser Tasks

Poll for elements, click buttons, extract data:

```bash
# Wait for an element to appear
while ! bdg cdp Runtime.evaluate --params '{"expression":"document.querySelector(\"#target\") !== null","returnByValue":true}' | jq -e '.result.value'; do
  sleep 0.5
done

# Click it
bdg cdp Runtime.evaluate --params '{"expression":"document.querySelector(\"#target\").click()"}'

# Get the result
bdg cdp Runtime.evaluate --params '{"expression":"document.querySelector(\".result\").textContent","returnByValue":true}'
```

Check `.claude/skills/bdg/WORKFLOWS.md` for more complete examples (GitHub scraper, form automation, etc).

## Session Management

Sessions persist until you stop them. Chrome stays open, data keeps collecting:

```bash
bdg example.com          # Opens Chrome, starts daemon
bdg status               # Check what's running
bdg status --verbose     # Show Chrome process details
bdg stop                 # Kill everything
bdg cleanup              # Remove stale files
```

## Helper Commands

A few convenience wrappers for common operations. Most work still happens through `bdg cdp`:

```bash
# Query DOM
bdg dom query "button.primary"      # Find elements
bdg dom get "button.primary"        # Get HTML
bdg dom eval "document.title"       # Run JavaScript
bdg dom highlight ".navbar"         # Visual debugging

# Inspect collected data
bdg peek                 # Quick snapshot
bdg peek --network       # Just network data
bdg tail                 # Stream like tail -f
```

## Page Readiness

By default, `bdg` waits for pages to fully load using three signals:

1. Browser's `window.onload` fires
2. Network goes quiet (200ms without new requests)
3. DOM stops changing (300ms without mutations)

Catches server-rendered HTML, client hydration, and lazy-loaded content. Works with Next.js, React, Vue, whatever. Times out after 5 seconds if something hangs.

Skip it with `--no-wait` if you want immediate connection.

## Architecture

Three processes:

- **CLI** talks to daemon via Unix socket
- **Daemon** manages Chrome and routes commands
- **Worker** holds the WebSocket to CDP

Chrome stays running between commands. No startup cost for each operation.

## Design Principles

This tool is built on principles learned from building CLI tools for autonomous agents:

**[Self-Documenting Systems](docs/principles/SELF_DOCUMENTING_SYSTEMS.md)** - Tools should teach agents how to use them through progressive discovery, not external documentation. The `--list`, `--describe`, and `--search` commands implement this philosophy.

**[Agent-Friendly Tools](docs/principles/AGENT_FRIENDLY_TOOLS.md)** - CLI design patterns that work well for autonomous agents: machine-readable output, semantic exit codes, structured errors, and zero-ambiguity commands.

These docs capture observations from real agent interactions and explain the reasoning behind design decisions. If you're building tools for AI agents, they might be useful.

## Contributing

If you use this and something breaks, [open an issue](https://github.com/szymdzum/browser-debugger-cli/issues/new). If you have ideas, start a [discussion](https://github.com/szymdzum/browser-debugger-cli/discussions). PRs welcome.

## License

MIT
