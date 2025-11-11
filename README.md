# Browser Debugger CLI

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/szymdzum/browser-debugger-cli/pulls)
[![CI](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml)
[![Security](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml)
[![npm downloads](https://img.shields.io/npm/dt/browser-debugger-cli?color=blue)](https://www.npmjs.com/package/browser-debugger-cli)

Chrome DevTools Protocol in your terminal. Run any CDP command, pipe the output, build browser automation with tools you already know. Design to be agent friendly

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

## Quick Start

```bash
# Start a session
bdg example.com

# Run any CDP command
bdg cdp Runtime.evaluate --params '{"expression":"document.title","returnByValue":true}'
bdg cdp Network.getCookies

# Check what's running
bdg status

# Done
bdg stop
```

## What You Can Do

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

Claude skill included at `.claude/skills/bdg/` with working automation patterns:

- Common CDP workflows (scraping, polling, navigation)
- Exit codes and error handling
- Troubleshooting reference

The `--help --json` flag outputs the complete CLI schema for programmatic discovery:

```bash
bdg --help --json | jq '.command.subcommands[].name'
bdg --help --json | jq '.exitCodes'
```

Agents can figure out what commands exist and how to use them without hardcoded knowledge.

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

## Contributing

If you use this and something breaks, [open an issue](https://github.com/szymdzum/browser-debugger-cli/issues/new). If you have ideas, start a [discussion](https://github.com/szymdzum/browser-debugger-cli/discussions). PRs welcome.

## License

MIT
