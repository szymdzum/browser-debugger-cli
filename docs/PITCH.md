# bdg: Browser Telemetry from the Command Line

**`bdg` is a standalone CLI for collecting browser telemetry (network, console, DOM) via Chrome DevTools Protocol. It's designed to be useful for quick debugging, automation, and AI agent workflows.**

Chrome DevTools is great for interactive debugging, but there's no good CLI equivalent. Lighthouse is single-purpose. Puppeteer requires writing code. `chrome-remote-interface` is a library, not a tool. `bdg` fills that gap: a command-line tool that lets you inspect browser state, collect telemetry, and access the full CDP without writing code.

---

## Quick Example

```bash
# Start collecting telemetry
$ bdg localhost:3000

[bdg] Session started
[bdg] Collecting network, console, and DOM...

Available commands:
  bdg network         Inspect network requests
  bdg console         Inspect console logs
  bdg dom             Inspect DOM elements
  bdg status          Show session status
  bdg peek            Preview collected data
  bdg stop            Stop and output results
```

---

## Key Features

### Standalone CLI Tool
Not a library. Install globally, run commands:

```bash
npm install -g bdg
bdg localhost:3000
```

### Collector-Centric Commands
Organized by data type (Network, Console, DOM):

```bash
$ bdg network
Network Inspector:
  bdg network peek        Show recent requests
  bdg network errors      Show failed requests (4xx/5xx)
  bdg network slow        Show slow requests
  bdg network getCookies  Get browser cookies
```

### Live Inspection
Sessions run continuously. You can inspect data without stopping collection:

```bash
bdg localhost:3000           # Start session
bdg peek                     # Preview data (without stopping!)
bdg network errors           # Check for 404s/500s
bdg console warnings         # Check console
bdg query "document.title"   # Execute JS in browser
bdg stop                     # Stop and get full output
```

### Agent-Friendly Design
Structured output, semantic exit codes, composable with Unix tools:

```bash
# Structured output
bdg network errors --json

# Composable with Unix tools
bdg network slow --threshold 1000 --json | \
  jq -r '.requests[] | .url'

# Semantic exit codes (agents make smart decisions)
# Exit codes: 0 = success, 90 = no session, 92 = not found, 105 = timeout
```

### Full CDP Access
High-level commands for common tasks, raw CDP access for everything else:

```bash
# High-level (beginner-friendly)
bdg network errors
bdg console warnings

# Curated CDP methods (common use cases)
bdg network getCookies
bdg network clearCache

# Raw CDP (power users)
bdg cdp Network.setCookie --name=test --value=123
bdg cdp Performance.getMetrics --json
bdg cdp Emulation.setDeviceMetricsOverride --mobile=true
```

### Daemon Architecture
Persistent daemon spawns workers per session. CLI communicates via IPC:

```
CLI (exits immediately)
  ↓ IPC
Daemon (persistent)
  ↓ Spawns
Worker (per session)
  ↓ CDP WebSocket
Chrome Browser
```

### Unix Philosophy
Commands output structured data and compose via pipes:

```bash
# Find slow requests, get details, extract URLs
bdg network slow --threshold 1000 --json | \
  jq -r '.requests[] | .id' | \
  xargs -I {} bdg network get {} --json | \
  jq -r '.url'

# Count console errors matching pattern
bdg console errors --json | \
  jq -r '.messages[] | .text' | \
  grep "API" | \
  wc -l

# Export 404s to CSV
bdg network errors --json | \
  jq -r '.requests[] | select(.status == 404) | [.url, .duration_ms] | @csv'
```

---

## Use Cases

### Developers
Quick debugging without opening DevTools:

```bash
# Check for errors
bdg localhost:3000
bdg console errors

# Find slow API calls
bdg network slow --threshold 2000

# Test mobile layout
bdg cdp Emulation.setDeviceMetricsOverride --mobile=true --width=375
```

### AI Agents
Structured browser inspection for LLM workflows:

```bash
# Agent investigates failing tests
1. bdg localhost:3000 --timeout 30
2. bdg console errors --json
3. Parse JSON, identify error patterns
4. bdg network errors --json
5. Correlate network failures with console errors
6. Report findings to user
```

### DevOps/SRE
Automated telemetry in CI/CD:

```bash
# CI/CD pipeline
npm run dev &
sleep 5

bdg localhost:3000 --timeout 30
bdg network errors --json > network_errors.json
bdg console errors --json > console_errors.json

if [ $(jq '.requests | length' network_errors.json) -gt 0 ]; then
  echo "❌ Network errors detected"
  exit 1
fi
```

### QA/Testing
Scriptable browser testing:

```bash
# Test checkout flow
bdg localhost:3000

# Verify no console errors
bdg console errors --json | jq -e '.messages | length == 0'

# Check API response times
bdg network slow --threshold 500 --json | jq -e '.requests | length == 0'

# Stop and archive results
bdg stop --output results/checkout-$(date +%Y%m%d).json
```

---

## Examples

### Debug Cookie Issues
```bash
$ bdg localhost:3000

$ bdg network getCookies --json
{
  "cookies": [
    {"name": "session", "value": "expired", "domain": "localhost"}
  ]
}

# Found the issue - session cookie expired
# Set test cookie
$ bdg cdp Network.setCookie --name=session --value=new_token --domain=localhost

# Verify
$ bdg network getCookies | jq '.cookies[] | select(.name=="session")'
```

### Performance Investigation (Agent)
```bash
# Agent workflow: Find slow resources

# 1. Collect data
bdg localhost:3000 --timeout 60

# 2. Find slow requests
bdg network slow --threshold 2000 --json > slow.json

# 3. Analyze each request
cat slow.json | jq -r '.requests[] | .id' | while read id; do
  bdg network get $id --json
done | jq '{url, duration_ms, size_kb: (.response.size / 1024)}'

# 4. Generate report
echo "Slow Resources:"
jq -r '.requests[] | "  - \(.url) (\(.duration_ms)ms)"' slow.json
```

### Mobile Emulation Test
```bash
# Test responsive design
$ bdg localhost:3000

# Emulate iPhone 12
$ bdg cdp Emulation.setDeviceMetricsOverride \
  --mobile=true \
  --width=390 \
  --height=844 \
  --deviceScaleFactor=3

# Emulate slow 3G
$ bdg cdp Network.emulateNetworkConditions \
  --offline=false \
  --downloadThroughput=93750 \
  --uploadThroughput=31250 \
  --latency=100

# Check for mobile-specific issues
$ bdg console errors --json | jq '.messages[] | select(.text | contains("viewport"))'

# Capture screenshot
$ bdg cdp Page.captureScreenshot --format=png --json | \
  jq -r '.result.data' | base64 -d > mobile_view.png
```

---

## Comparison with Alternatives

| Feature | bdg | Lighthouse | Chrome DevTools | Puppeteer | Chrome MCP |
|---------|-----|-----------|-----------------|-----------|------------|
| **Standalone CLI** | ✅ | ✅ | ❌ GUI | ❌ Library | ❌ MCP Server |
| **Live inspection** | ✅ | ❌ One-shot | ✅ | ⚠️ Code required | ? |
| **Agent-friendly** | ✅ JSON + exit codes | ✅ JSON | ❌ | ⚠️ Code required | ✅ MCP |
| **Unix composability** | ✅ Pipes work | ✅ Pipes work | ❌ | ❌ | ❌ MCP protocol |
| **Progressive UX** | ✅ Simple → Advanced | ⚠️ Single-purpose | ✅ | ❌ | ⚠️ Via clients |
| **Full CDP access** | ✅ `bdg cdp` | ❌ Limited | ✅ | ✅ | ✅ |
| **Setup time** | `npm i -g bdg` | `npm i -g lighthouse` | Built-in | Write code | MCP infra |

bdg provides a standalone CLI with live inspection, agent-friendly output, and full CDP access.

---

## Technical Highlights

### Daemon/IPC Architecture
```
Persistent daemon → spawns workers → connects to Chrome
CLI sends IPC requests → daemon routes → worker responds
```

**Benefits:**
- Zero CLI overhead (CLI exits immediately)
- Multiple commands inspect same session
- Clean process isolation

### Agent-Friendly Principles
Following industry best practices from Square, InfoQ, and clig.dev:

1. **Semantic exit codes** (90s = user errors, 100s = system errors)
2. **Structured output** (JSON everywhere with `--json`)
3. **No interactive prompts** (fully automatable)
4. **Stream separation** (data → stdout, logs → stderr)
5. **Composability** (Unix pipes, jq-friendly)

### Collector-Centric Design
Commands grouped by data type (Network, Console, DOM), not by implementation:

```bash
bdg network         # All network commands
bdg console         # All console commands
bdg dom             # All DOM commands
bdg cdp             # Raw CDP access
```


---

## What's Next

### Current Status (v0.0.1-alpha)
- ✅ Core telemetry collection (Network, Console, DOM)
- ✅ Daemon/IPC architecture
- ✅ Live inspection (`peek`, `status`, `query`)
- ✅ Basic filtering (exclude trackers, dev server noise)
- ✅ Two-tier preview (fast metadata + full data on demand)

### Roadmap

**Phase 1: Collector-Centric UX**
- [ ] Nested command menus (`bdg network` → shows menu)
- [ ] Domain-specific subcommands (`bdg network errors`, `bdg console warnings`)
- [ ] Enhanced filtering and querying

**Phase 2: CDP Method Exposure**
- [ ] Raw CDP command (`bdg cdp <Domain.method>`)
- [ ] Curated CDP methods (`bdg network getCookies`, `bdg dom highlight`)
- [ ] CDP introspection (`bdg cdp --list Network`)

**Phase 3: Advanced Features**
- [ ] HAR export (`bdg network export --format har`)
- [ ] Performance metrics (`bdg performance metrics`)
- [ ] Visual debugging (`bdg dom highlight`, screenshot capture)
- [ ] Session recording/replay

**Phase 4: Ecosystem Integration**
- [ ] MCP server wrapper (for agent orchestration)
- [ ] CI/CD plugins (GitHub Actions, GitLab CI)
- [ ] IDE extensions (VSCode, Cursor)

---

## Getting Started

```bash
npm install -g bdg

# Start collecting telemetry
bdg localhost:3000

# Check for errors
bdg console errors
bdg network errors

# Preview collected data
bdg peek

# Stop and output results
bdg stop
```

## Documentation
- **Documentation**: [README.md](../README.md)
- **Agent-Friendly Design**: [AGENT_FRIENDLY_TOOLS.md](./AGENT_FRIENDLY_TOOLS.md)
- **Collector UX**: [COLLECTOR_CENTRIC_UX.md](./COLLECTOR_CENTRIC_UX.md)
- **CDP Access**: [CDP_METHOD_EXPOSURE.md](./CDP_METHOD_EXPOSURE.md)

---

## Status

Currently in alpha (v0.0.1-alpha). Core features work, but expect API changes. See [Roadmap](#roadmap) for planned improvements.
