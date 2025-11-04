# Browser Debugger CLI

Lightweight CLI that streams Chrome DevTools Protocol telemetry (DOM, network, console) for humans and agents.

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/szymdzum/browser-debugger-cli/pulls)
[![CI](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml)
[![Security](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml)
[![npm downloads](https://img.shields.io/npm/dt/browser-debugger-cli?color=blue)](https://www.npmjs.com/package/browser-debugger-cli)


Talks directly to Chrome over WebSocket (the same protocol DevTools uses). No
Puppeteer wrapper, no MCP server, just raw browser internals piped straight to stdout
where you (or agent) can grep, jq, or script them.

## Installation

```bash
npm install -g browser-debugger-cli
```

## Quick Start

```bash
# Start session (open example.com in Chrome)
bdg example.com

# [bdg] Session started via daemon
# [bdg] Collecting network, console, and DOM...
#  Available commands:
#   bdg network         Inspect network requests
#   bdg console         Inspect console logs
#   bdg dom             Inspect DOM elements
#   bdg status          Show session status
#   bdg peek            Preview collected data
#   bdg stop            Stop and output results
#   bdg help            Show help

bdg dom query "document.title"
# 'Example Domain'
```

## Philosophy

There's no good CLI for Chrome DevTools Protocol. MCP servers work (most of the time) but are token-heavy and monolithic. Puppeteer is for automation, not inspection. Lighthouse is single-purpose. `bdg` takes the Unix approach: small, composable commands that pipe with `jq` and `grep`—tools models already know—without the token overhead.

**Why CLI over protocol servers?**
- **Token efficiency**: CDP is in the model's training data. A skill doc with usage
  patterns? ~3k tokens. MCP server definitions? 5-10k before you invoke anything.
- **Composability**: Pipe commands together. Each does one thing well.
- **Transparent errors**: See exactly what failed. No protocol layers hiding the
  issue.
- **Real-time evolution**: Update usage patterns anytime. No server redeployment
  needed.

The vision: Terminal-native browser debugging that's as composable as curl and jq.
```bash
# Under development but you get the idea

bdg network getCookies
# [bdg] Cookies for example.com:
#   - name: session_id
#     value: 1234567890abcdef
#     domain: example.com
#     path: /
#     expires: 2023-01-01T00:00:00Z
#     httpOnly: true
#     secure: true
#     sameSite: Strict

bdg network getCookies --json
# [
#   {
#     "name": "session_id",
#     "value": "1234567890abcdef",
#     "domain": "example.com",
#     "path": "/",
#     "expires": "2023-01-01T00:00:00Z",
#     "httpOnly": true,
#     "secure": true,
#     "sameSite": "Strict"
#   }
# ]

bdg cdp Network.getCookies --json | jq '.[] | select(.name == "session_id") | .value'
# 1234567890abcdef
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
- No intermediate files—data flows from Chrome to stdout
- Real CDP with full protocol access

## Contributing

Contributions welcome! But honestly, I'd just be happy if you give it a try.

Let me know how you use it
([discussions](https://github.com/szymdzum/browser-debugger-cli/discussions)), let me
know what's broken
([issues](https://github.com/szymdzum/browser-debugger-cli/issues/new)).

## License

MIT – see [LICENSE](LICENSE) for details.
