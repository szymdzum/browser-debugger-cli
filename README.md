# bdg — Browser Debugger CLI

[![npm downloads](https://img.shields.io/npm/dt/browser-debugger-cli?color=blue)](https://www.npmjs.com/package/browser-debugger-cli)
[![CI](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml)
[![Security](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/szymdzum/browser-debugger-cli/pulls)

**Give your AI agent a real browser. And the DevTools to go with it.**

bdg keeps a browser session open in the background and lets you drive it one shell command at a time. Click, fill, navigate, then read what actually happened: requests, console errors, layout and styles. It is built for coding agents like Claude Code, Codex and Gemini CLI, and it's just as handy in your own terminal.

```bash
npm install -g browser-debugger-cli
bdg localhost:3000
```

## See it work

### 1. Open a page and see what's wrong

```console
$ bdg localhost:3000
Session Started
Target: http://localhost:3000/

$ bdg console
Errors (2)
──────────────────────────────
Failed to load resource: the server responded with a status of 404 (File not found)
     → http://localhost:3000/api/user

Failed to load user: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
     → :3:63

$ bdg network list --preset errors
[ID]       START STS METH TYP     SIZE   TIME  URL
[86615.3]  +0.0s 404 GET  IMG    460 B    7ms  localhost:3000/logo.png
[86615.6]  +0.0s 404 GET  FET    645 B    1ms  localhost:3000/api/user
```

Three commands, and the agent knows the API call is failing and why the page breaks. `bdg details network 86615.6` shows the full request and response.

### 2. Interact, and see what each action did

```console
$ bdg dom fill 'input[name=email]' ada@example.com
✓ Element Filled

$ bdg dom click "#pay"
✓ Element Clicked

Element:       button#pay.btn "Pay now"
Requests during the action (1):
  POST localhost:3000/api/pay → 501 (2ms)
```

The click reports the request it triggered, with no screenshot and no extra tool call.

### 3. Inspect, without screenshots

```console
$ bdg dom inspect .note
p.note "Secure payment" 1840x16 @40,154
text   system-ui 400 13/normal · color #9ca3af · contrast 2.53 fail on #fff · align start
```

A few lines of text instead of an image: box, layout, fonts, colors and contrast. Here the contrast check fails. `--why color` shows which CSS rule set the color.

### 4. Grab cookies and auth tokens

```console
$ bdg network getCookies
[1] session_id
  Value: s%3A9f8e7d6c
  HttpOnly: Yes
  SameSite: Lax

$ bdg network headers 89565.2 --header authorization
Request Headers:
  Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEifQ.demo

$ bdg eval "localStorage.getItem('access_token')"
eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEifQ.demo
```

`HttpOnly` cookies are included, even though the page's own JavaScript can't read them. Log in once in the browser, then reuse the session from the shell:

```bash
COOKIES=$(bdg network getCookies --json | jq -r '[.data[] | "\(.name)=\(.value)"] | join("; ")')
curl -H "Cookie: $COOKIES" localhost:3000/api/me
```

### 5. The rest of DevTools is there too

```console
$ bdg dom a11y tree
[RootWebArea] "My App" (focused)
  [Heading] "My App"
  [Button] "Sign in" (focusable)
  [Image]                                         ← no accessible name

$ bdg cdp Performance.enable
$ bdg cdp Performance.getMetrics --json | jq '.data.result.metrics | from_entries'
{ "Nodes": 51, "LayoutDuration": 0.000115, "ScriptDuration": 0.000775, "JSHeapUsedSize": 772124, ... }

$ bdg cdp Emulation.setCPUThrottlingRate --params '{"rate":4}'    # Slow CPU
$ bdg cdp Network.emulateNetworkConditions --params '{"offline":false,"latency":400,"downloadThroughput":50000,"uploadThroughput":20000}'
```

Accessibility, performance metrics, CPU profiling, heap snapshots, code coverage, throttling, storage, service workers: everything Chrome DevTools can do, bdg can do too, through raw CDP. Can't find the method you need? `bdg cdp --search heap`.

## Why bdg

- **Actions report their effects.** Clicks, fills, key presses and submits tell you what they changed: navigation, network requests, new console messages, or nothing at all. The agent doesn't have to guess whether the click worked.
- **Looks without screenshots.** `dom inspect` and `dom layout` report box, fonts, colors, contrast, visibility and what covers an element, as a few lines of text. `--why color` shows which CSS rule won and what it beat.
- **All of DevTools.** All 59 Chrome DevTools Protocol domains and 675 methods are one command away: `bdg cdp <Method>`. Accessibility, performance, memory, coverage, emulation: when a high-level command doesn't cover something, you are never stuck.
- **Self-documenting.** `bdg --help --json`, `bdg cdp --search cookie`, `bdg cdp Network.getCookies --describe`. The agent learns the tool from the tool, not from docs pasted into its context.
- **Cheap on tokens.** There are no tool schemas loaded up front, and output is compact text, with `--json` when you need structure.
- **Errors that help.** Every error comes with a suggestion and a semantic exit code (`83` not found, `87` stale index, ...), so an agent can recover by itself.
- **Unix all the way.** Every command is a process, so pipes, `jq` and shell scripts just work.

## Benchmark: CLI vs MCP

We gave an AI agent five real debugging tasks, from a single JS error up to a memory leak, and ran each one with bdg and with the official Chrome DevTools MCP server (November 2025).

| | bdg | Chrome DevTools MCP |
|---|---|---|
| **Score** | **77 / 100** | 60 / 100 |
| **Token efficiency** | **202** | 152 |
| Tokens used | ~38.1K | ~39.4K |

bdg scored 17 points higher on about the same token budget, so its token efficiency was 33% better. Part of the gap is reach: memory profiling, HAR export and batch JS execution have no MCP equivalent. [Read the full analysis →](docs/benchmarks/ARTICLE_MCP_VS_CLI_FOR_AGENTS.md)

## Use it with your agent

bdg ships an agent skill that teaches the workflow: start once, act, read what changed, inspect without screenshots, check network and console.

```bash
bdg install-skill            # Claude Code (~/.claude/skills) + Codex, Gemini CLI, ... (~/.agents/skills)
bdg install-skill --claude   # Claude Code only
```

Start a new agent session afterwards. In Claude Code the skill loads when a task needs a browser, or on demand with `/bdg`. Re-run `bdg install-skill` after upgrading bdg.

## Quick start

```bash
bdg example.com                              # Start a session (the browser stays open)
bdg dom fill 'input[name="q"]' "shoes"       # Interact
bdg dom click 'button:has-text("Search")'
bdg dom wait "#result" --visible             # Wait for an element instead of sleeping
bdg network list --preset errors             # Failed requests
bdg console                                  # Console messages
bdg dom layout "#save"                       # Where is it? Visible? Covered?
bdg dom inspect "#save" --why color          # Which CSS rule sets the color
bdg dom listeners "#save"                    # Which event listeners run
bdg page emulate --viewport 900x700          # Responsive check mid-session
bdg eval "document.title"                    # Run JavaScript (--frame for iframes)
bdg cdp Network.getCookies                   # Any CDP method
bdg stop                                     # End the session
```

Local dev servers with self-signed certificates: `bdg https://localhost:5173 --chrome-flags="--ignore-certificate-errors"`. Need parallel sessions? `bdg example.com --session agent2`.

## What it covers

| Area | Commands |
|---|---|
| **Page** | navigate, reload, back/forward, viewport and color-scheme emulation |
| **Interaction** | click (double, right), fill (React-compatible, file inputs), hover, keys, forms, scroll, wait; shadow DOM and iframes included |
| **Inspection** | element styles with the CSS cascade, layout and visibility, accessibility tree, event listeners, screenshots |
| **Telemetry** | network requests and headers (incl. `Authorization`), HAR export, cookies (incl. `HttpOnly`), console messages, live `tail` |
| **Accessibility** | accessibility tree, semantic queries (`role:button name:Submit`), contrast checks |
| **Performance** | metrics, CPU and heap profiling, tracing, CPU and network throttling (raw CDP) |
| **Sessions** | several named sessions side by side, or attach to a browser you already have open (`--chrome-ws-url`) |
| **Everything else** | raw CDP: `bdg cdp --list`, `--search`, `--describe` |

The [CLI reference](docs/CLI_REFERENCE.md) documents every command. `bdg --help --json` gives agents the machine-readable version.

## Install

```bash
npm install -g browser-debugger-cli
```

**Requirements:** Node.js 22.12+ and a Chromium-based browser: Chrome, Chromium or Microsoft Edge.

**Platforms:** macOS, Linux and Windows via WSL. Native PowerShell and Git Bash are not supported yet.

**Browsers:** bdg launches Chrome by default. To use Edge, point `CHROME_PATH` at its binary, or attach to an Edge you started with `--remote-debugging-port`:

```bash
CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" bdg example.com   # macOS
CHROME_PATH=/usr/bin/microsoft-edge bdg example.com                                         # Linux
bdg example.com --chrome-ws-url 9222                                                        # Attach to a running browser
```

Firefox and Safari are not supported: bdg speaks the Chrome DevTools Protocol, which they do not implement.

## When to use something else

- **Playwright / Puppeteer**: long scripted test suites and a mature testing ecosystem.
- **Chrome DevTools MCP**: if your setup is already built around MCP servers.

bdg is for when an agent or a developer needs to poke at a live page, step by step, and understand what is going on.

## Documentation

📖 **[Wiki](https://github.com/szymdzum/browser-debugger-cli/wiki)**: [Getting Started](https://github.com/szymdzum/browser-debugger-cli/wiki/Getting-Started) · [Commands](https://github.com/szymdzum/browser-debugger-cli/wiki/Commands) · [For AI Agents](https://github.com/szymdzum/browser-debugger-cli/wiki/For-AI-Agents) · [Recipes](https://github.com/szymdzum/browser-debugger-cli/wiki/Recipes) · [Quick Reference](https://github.com/szymdzum/browser-debugger-cli/wiki/Quick-Reference) · [Architecture](https://github.com/szymdzum/browser-debugger-cli/wiki/Architecture) · [Troubleshooting](https://github.com/szymdzum/browser-debugger-cli/wiki/Troubleshooting)

bdg follows the [Agent-Friendly Tools](docs/principles/AGENT_FRIENDLY_TOOLS.md) principles: self-documenting, semantic exit codes, structured errors and progressive disclosure.

## Contributing

[Issues](https://github.com/szymdzum/browser-debugger-cli/issues) for bugs, [Discussions](https://github.com/szymdzum/browser-debugger-cli/discussions) for ideas. PRs welcome. See `docs/` for architecture and contributor guides.

## License

MIT
