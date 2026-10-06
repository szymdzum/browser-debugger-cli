# Browser Debugger CLI

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/szymdzum/browser-debugger-cli/pulls)
[![CI](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/ci.yml)
[![Security](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml/badge.svg)](https://github.com/szymdzum/browser-debugger-cli/actions/workflows/security.yml)
[![npm downloads](https://img.shields.io/npm/dt/browser-debugger-cli?color=blue)](https://www.npmjs.com/package/browser-debugger-cli)

Chrome DevTools Protocol in your terminal. Opens a persistent connection to Chrome where commands can be executed sequentially via Unix pipes. **Designed for AI agents** and developers who want direct browser control without framework overhead.

## Why bdg?

- **Raw CDP access** - Every [protocol method](https://chromedevtools.github.io/devtools-protocol/) available directly
- **Token efficient** - No overhead from MCP tool definitions; progressive discovery loads only what's needed
- **Self-correcting** - Errors clearly exposed with semantic exit codes and suggestions
- **Composable** - Unix philosophy: pipes, jq, shell scripts work naturally

**When to use alternatives:**
- **Puppeteer/Playwright**: Complex multi-step scripts, mature testing ecosystem
- **Chrome DevTools MCP**: Already invested in MCP infrastructure

**Built for agents:** Self-discovery (`--list`, `--search`), semantic exit codes, structured errors, case-insensitive commands, token-efficient output.

## Benchmark: CLI vs MCP for AI Agents

We benchmarked bdg against Chrome DevTools MCP Server on real developer debugging tasks.


**[Full benchmark analysis →](docs/benchmarks/ARTICLE_MCP_VS_CLI_FOR_AGENTS.md)**

**Key findings:** CLI provided 33% better token efficiency through selective queries vs full accessibility tree dumps, plus capabilities MCP doesn't expose (memory profiling, HAR export, batch JS execution).


## Install

```bash
npm install -g browser-debugger-cli
```

**Requirements:** Node.js 22.12+ and Chrome (or Chromium).

**Platform Support:**
- ✅ macOS and Linux
- ✅ Windows via WSL
- ❌ PowerShell/Git Bash (not yet)

## Use with Claude Code and Other Agents

bdg ships an agent skill (`SKILL.md`) that teaches the workflow: start once, act, read what the action changed, inspect without screenshots, check network and console.

```bash
bdg install-skill            # ~/.claude/skills/bdg (Claude Code) + ~/.agents/skills/bdg (Codex, Gemini CLI, ...)
bdg install-skill --claude   # Claude Code only
```

Start a new agent session afterwards, and re-run `bdg install-skill` after upgrading bdg. In Claude Code the skill loads when a task needs a browser, or on demand with `/bdg`.

## Quick Start

```bash
bdg example.com                    # Start session
bdg https://localhost:5173 --chrome-flags="--ignore-certificate-errors"  # Self-signed certs
bdg https://localhost:5173 --chrome-flags="--disable-web-security"       # Disable CORS
bdg cdp --search cookie            # Discover commands
bdg cdp Network.getCookies         # Run any CDP method
bdg dom query "button"             # High-level helpers
bdg dom fill 'input[name="q"]' "shoes"
bdg dom click 'button:has-text("Search")'
bdg page navigate example.com/about
bdg eval "document.title"          # Run JavaScript in the page (--frame for iframes)
bdg network list --preset errors   # Network requests, console: bdg console
bdg dom listeners "#save"          # Which event listeners run for an element
bdg dom layout "#save"             # Where it is, whether it is visible or covered
bdg dom inspect "#save"            # What it looks like (Figma-like styles), no screenshot
bdg dom inspect "#save" --why color   # Which CSS rule sets a value, and what it beats
bdg page emulate --viewport 900x700   # Responsive check mid-session (or --color-scheme)
bdg dom wait "#result" --visible   # Wait for an element instead of sleeping
bdg example.com --session agent2 --viewport 1280x800   # A second, independent session
bdg stop                           # End session
```

## Current State

**Raw CDP access is complete.** Every protocol method works now. High-level commands cover the common work: page navigation, DOM queries and interaction (click, fill, hover, keys, forms, shadow DOM and iframes), accessibility tree, screenshots, element styles with the CSS cascade (`dom inspect`: what an element looks like, which rule sets each value, and declarations that have no effect), network requests and HAR export, console messages and event listeners. Actions report what they changed (navigation, new messages, requests, or no visible effect), and several named sessions can run side by side. See the [CLI reference](docs/CLI_REFERENCE.md) for every command, and `bdg --help --json` for the machine-readable version.

## Agent Discovery Pattern

```bash
# Agent explores what's possible (no docs needed)
bdg cdp --list                              # All domains
bdg cdp Network --list                      # Methods in one domain
bdg cdp Network.getCookies --describe       # Full schema + examples
bdg cdp Network.getCookies                  # Execute

# Search across all domains
bdg cdp --search screenshot                 # Find relevant methods
bdg cdp --search cookie                     # methods mentioning cookies
```

## Documentation

📖 **[Wiki](https://github.com/szymdzum/browser-debugger-cli/wiki)** - Guides, command reference, recipes

- [Getting Started](https://github.com/szymdzum/browser-debugger-cli/wiki/Getting-Started)
- [Commands](https://github.com/szymdzum/browser-debugger-cli/wiki/Commands)
- [For AI Agents](https://github.com/szymdzum/browser-debugger-cli/wiki/For-AI-Agents)
- [Recipes](https://github.com/szymdzum/browser-debugger-cli/wiki/Recipes)
- [Quick Reference](https://github.com/szymdzum/browser-debugger-cli/wiki/Quick-Reference)
- [Architecture](https://github.com/szymdzum/browser-debugger-cli/wiki/Architecture)
- [Troubleshooting](https://github.com/szymdzum/browser-debugger-cli/wiki/Troubleshooting)

## Design Principles

This tool implements [Agent-Friendly Tools](docs/principles/AGENT_FRIENDLY_TOOLS.md):

- **Self-documenting** - Tools teach themselves via `--list`, `--describe`
- **Semantic exit codes** - Machine-parseable error handling
- **Structured output** - JSON by default, human-readable optional
- **Progressive disclosure** - Simple commands, deep capabilities

## Contributing

[Issues](https://github.com/szymdzum/browser-debugger-cli/issues) for bugs, [Discussions](https://github.com/szymdzum/browser-debugger-cli/discussions) for ideas. PRs welcome.

See `docs/` for architecture and contributor guides.

## License

MIT
