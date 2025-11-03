# CLI Agent Workflow Guide

This companion guide captures the detailed CLI usage patterns, agent workflows, and optimization tips that previously lived in the README. Share it with agents (or link from skill files) so they can execute common bdg flows confidently.

---

## Philosophy: CLI Over MCP

### Agent Learning
When you teach the agent how to use CLI tools for your specific needs, it learns fast. Provide examples, usage patterns, and real-world workflows in a skill file and the agent adapts. MCP exposes a rigid API; CLI lets you keep iterating. Combining skill docs with concrete examples consistently outperforms general-purpose MCP servers.

### Token Efficiency
MCP makes you declare every tool and capability upfront, consuming tokens whether you use them or not. CLI tools like `glab`, `jq`, and `grep` already existed in the model’s training data. A skill document with example commands is ~3k tokens; MCP server definitions alone can hit 5–10k before a single invocation.

### Composability
Unix philosophy still wins. CLI tools pipe together, each focused on one job. MCP endpoints are monolithic—if they don’t expose the exact query you need, you’re stuck. With CLI you can `grep`, pipe to files, and combine commands the model already knows.

### Debuggability
CLI errors are transparent—you see exactly what failed. MCP errors hide behind protocol layers and server logs you can’t reach. The model can read CLI stderr, reason about it, and recover.

### Real-Time Evolution
Update the skill document at any time: new patterns, edge cases, clarifications. MCP requires server updates and redeploys. CLI keeps you shipping.

---

## Quick Start Patterns

```bash
# Start collection (auto-launches Chrome if needed)
bdg localhost:3000

# Interact with the page, then stop collection
bdg stop
```

JSON output (network, console, DOM) is written to stdout on stop. Pipe it to files or downstream tools:

```bash
bdg stop > telemetry.json
jq '.data.console[] | select(.type == "error")' telemetry.json
```

### Run-Until-Stopped Pattern (Agents)

```bash
# Agent starts collection
bdg "localhost:3000/signin"

# User interacts with browser (fills form, clicks button, sees errors)

# Agent stops and captures output
bdg stop > telemetry.json

# Agent analyzes the data
jq '.data.console[] | select(.type == "error")' telemetry.json
```

---

## Usage Reference

### Basic Collection

```bash
# Collect all telemetry (default)
bdg localhost:3000

# Collect specific data types (additive flags)
bdg localhost:3000 --dom                    # DOM snapshot only
bdg localhost:3000 --network                # Network requests only
bdg localhost:3000 --console                # Console logs only
bdg localhost:3000 --dom --console          # DOM and console only

# Exclude specific collectors (subtractive flags)
bdg localhost:3000 --skip-console             # Network and DOM only
bdg localhost:3000 --skip-dom --skip-network  # Console only

# Options
bdg localhost:3000 --port 9223              # Custom CDP port
bdg localhost:3000 --timeout 30             # Auto-stop after 30s
bdg localhost:3000 --all                    # Disable default filtering
```

### Session Management

```bash
# Check session status
bdg status                    # Basic status
bdg status --verbose          # Include Chrome diagnostics
bdg status --json             # JSON output

# Preview collected data (without stopping)
bdg peek                      # Last 10 items (compact format)
bdg peek --last 50            # Show more items
bdg peek --network            # Network requests only
bdg peek --console            # Console messages only
bdg peek --follow             # Live updates every second
bdg peek --verbose            # Full URLs and emojis

# Get detailed information
bdg details network <requestId>   # Full request/response with bodies
bdg details console <index>       # Full console message with args

# Stop collection
bdg stop                      # Stop and output JSON

# Cleanup
bdg cleanup                   # Remove stale session files
bdg cleanup --force           # Force cleanup even if session appears active
bdg cleanup --all             # Also remove session.json output
```

---

## Output Formats

**Compact (Default)** – Optimized for agents, 67–72 % token reduction  
• Truncated URLs (`api.example.com/users`)  
• No emojis or box-drawing  
• Concise stack traces

**Verbose** – Human-readable format

```bash
bdg peek --verbose            # Full URLs, emojis, detailed output
```

Example output payload:

```json
{
  "version": "0.0.1-alpha.0",
  "success": true,
  "timestamp": "2025-10-31T12:00:00.000Z",
  "duration": 45230,
  "target": {
    "url": "http://localhost:3000/dashboard",
    "title": "Dashboard"
  },
  "data": {
    "network": [...],
    "console": [...],
    "dom": {...}
  }
}
```

Error payload:

```json
{
  "version": "0.0.1-alpha.0",
  "success": false,
  "error": "Error message here"
}
```

---

## Filtering & Optimization

### Default Behaviour

- **Network filtering** – 13 tracking/analytics domains excluded (Google Analytics, Facebook, TikTok, etc.)
- **Automatic body skipping** – Skips response bodies for images, fonts, videos, etc.; always fetches JSON/HTML/JS API responses.
- **Console filtering** – Removes dev-server noise (webpack, HMR, React DevTools).

Override example:

```bash
# Include all data (disable all filtering/optimization)
bdg localhost:3000 --all

# Fetch all bodies but keep tracking filters
bdg localhost:3000 --fetch-all-bodies
```

### Fine-Grained Controls

```bash
# Only capture specific hosts or patterns
bdg localhost:3000 --network-include "api.example.com,*.graphql"

# Exclude tracking/analytics domains
bdg localhost:3000 --network-exclude "*analytics*,*ads*,*tracking*"

# Body fetching patterns
bdg localhost:3000 --fetch-bodies-include "*/api/*,*/graphql"
bdg localhost:3000 --fetch-bodies-exclude "*tracking*"

# Compact JSON output (30% size reduction)
bdg localhost:3000 --compact
```

**Pattern syntax** – `*` matches anything:

- `api.example.com` → all requests to that host  
- `*/api/*` → any path containing `/api/`  
- `*analytics*` → any hostname containing “analytics”  
- `*.png` → all PNG images  

**Precedence** – Includes override excludes:

```bash
bdg localhost:3000 \
  --network-include "mixpanel.com" \
  --network-exclude "*tracking*"
```

---

## Session Files (Current Implementation)

Until the daemon/IPC upgrade lands, the CLI writes to `~/.bdg/`:

- `session.pid` – PID of running session  
- `session.lock` – Atomic acquisition lock  
- `session.meta.json` – Metadata (start time, Chrome PID, port, target info)  
- `session.preview.json` – Lightweight preview data  
- `session.full.json` – Complete data with bodies  
- `session.json` – Final output written on stop  

These are automatically cleaned up on graceful shutdown (`bdg cleanup` handles stale sessions).

---

## Chrome Launch Helpers

bdg auto-launches Chrome if needed. Manual launch examples:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-bdg

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-bdg

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir=C:\temp\chrome-bdg
```

If Chrome is already running with debugging enabled, bdg will detect and reuse it.

---

## Requirements

- Node.js ≥ 18.0.0  
- Chrome/Chromium with remote debugging enabled  

---

## Next Steps

This guide will evolve alongside the daemon + IPC work. Once the live IPC path is stable, we’ll add examples for:

- Streaming lifecycle (`networkIdle`) status  
- Fetching live request bodies without disk writes  
- Querying DOM fragments on demand  
- Managing sessions (`bdg status`, `bdg stop`) all via sockets  

Keep the README concise; link here for the full playbook. Update your skill docs to reference whichever sections your agents rely on most.

