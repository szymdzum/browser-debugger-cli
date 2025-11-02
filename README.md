# Browser Debugger CLI

CLI tool for agents to quickly access browser telemetry (DOM, network, console) via Chrome DevTools Protocol.

## Why This Tool?

After finding limited success with MCP servers for browser telemetry access, I discovered that CLI agents excel at using command-line tools. It makes sense that CLI agents are naturally good at terminal operations. That's why I built this lightweight CLI to give console agents direct access to browser telemetry. It lets users interact with a page while the agent collects DOM snapshots, console logs, and network data as context for debugging and analysis.

The tool communicates directly with Chrome DevTools Protocol via WebSocket, collecting telemetry in real-time as events occur. Data is saved using a two-tier system: a lightweight preview file (~360KB) for quick monitoring and a full data file with complete request/response bodies for deep inspection. Agents can peek at collected data without stopping collection, get detailed information on specific requests, or stop collection to receive structured JSON output via stdout, making it seamless to pipe into other tools or analyze directly in the terminal.

## Philosophy: MCP vs CLI

### Agent Learning
What I've noticed is when you actually teach the agent how to use CLI tools for your specific needs, it tends to perform much better. You can provide examples, usage patterns, and real-world workflows in a skill file. The agent learns from these examples and adapts them to your use case. With MCP, you get a rigid API, take it or leave it. The combination of skill files with concrete CLI examples consistently outperforms MCP servers in my experience.

### Token Efficiency
With MCP, you pay upfront for every tool definition and capability declaration, whether you use them or not. CLI tools like `glab`, `jq`, and `grep` were already in the model's training data. A skill document showing usage patterns is ~3k tokens. MCP server definitions alone can be 5-10k before you invoke anything.

### Composability
Unix philosophy wins here. CLI tools pipe together, each does one thing well, you chain them for complexity. MCP servers are monolithic endpoints. If it doesn't expose your exact query, you're stuck. With CLI you can `grep`, pipe to files, combine tools. The model already knows these patterns.

### Debuggability
CLI errors are transparent, you see exactly what failed and why. MCP errors hide behind protocol layers and server logs you can't access. The model can see CLI errors, understand them, and adapt.

### Real-Time Evolution
I can update skill documents while the agent uses them, add patterns, refine examples. With MCP, you're locked to whatever the server exposes. Want new functionality? Wait for the maintainer to add it, redeploy, hope nothing breaks. With CLI, just update the markdown.

## Installation

```bash
npm install -g browser-debugger-cli
```

## Quick Start

```bash
# Start collection (auto-launches Chrome if needed)
bdg localhost:3000

# Interact with the page, then stop collection
bdg stop
```

JSON output with collected network requests, console logs, and DOM is written to stdout on stop.

### For Agents

**Run-Until-Stopped Pattern**: `bdg` runs indefinitely until you stop it with `Ctrl+C` or `bdg stop`. This allows agents to:
1. Start collection in the background
2. Let the user interact with the browser manually
3. Stop collection and analyze captured telemetry when ready

```bash
# Agent starts collection
bdg "localhost:3000/signin"

# User interacts with browser (fills form, clicks button, sees errors)

# Agent stops and captures output
bdg stop > telemetry.json

# Agent analyzes the data
jq '.data.console[] | select(.type == "error")' telemetry.json
```

## Usage

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

### Output Formats

**Compact (Default)**: Optimized for agents, 67-72% token reduction
- Truncated URLs: `api.example.com/users`
- No emojis or Unicode box-drawing
- Concise stack traces

**Verbose**: Human-readable format
```bash
bdg peek --verbose            # Full URLs, emojis, detailed output
```

### Default Filtering & Optimization

By default, `bdg` applies multiple optimization layers (50-80% data reduction):

**Network Request Filtering**: 13 tracking/analytics domains excluded (Google Analytics, Facebook, TikTok, etc.)

**Automatic Body Skipping**: Response bodies auto-skipped for non-essential assets:
- Images, fonts, stylesheets, source maps, videos, audio
- API responses (JSON, HTML, JS) are always fetched

**Console Filtering**: 4 dev server patterns excluded (webpack-dev-server, HMR, React DevTools)

```bash
# Default: filtering and auto-optimization enabled
bdg localhost:3000

# Include all data (disable all filtering and optimization)
bdg localhost:3000 --all

# Override just body skipping (still filters tracking domains)
bdg localhost:3000 --fetch-all-bodies
```

### Performance Optimization

**Network Optimization** - Control which URLs and bodies are captured:

```bash
# Only capture specific hosts or patterns
bdg localhost:3000 --network-include "api.example.com,*.graphql"

# Exclude tracking/analytics domains
bdg localhost:3000 --network-exclude "*analytics*,*ads*,*tracking*"

# Control body fetching with patterns
bdg localhost:3000 --fetch-bodies-include "*/api/*,*/graphql"
bdg localhost:3000 --fetch-bodies-exclude "*tracking*"

# Fetch all bodies (override auto-skip)
bdg localhost:3000 --fetch-all-bodies
```

**Output Optimization** - Reduce output file sizes:

```bash
# Compact JSON output (30% size reduction, no indentation)
bdg localhost:3000 --compact
```

**Pattern Syntax** - Simple wildcards (`*` matches anything):
- `api.example.com` → matches all requests to that host
- `*/api/*` → matches any path containing `/api/`
- `*analytics*` → matches any hostname with "analytics"
- `*.png` → matches all PNG images

**Pattern Precedence** - Include always trumps exclude:
```bash
# Capture Mixpanel despite *tracking* exclusion
bdg localhost:3000 \
  --network-include "mixpanel.com" \
  --network-exclude "*tracking*"
```

## Output

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

Error format:
```json
{
  "version": "0.0.1-alpha.0",
  "success": false,
  "error": "Error message here",
  ...
}
```

## How It Works

### Auto-Launch Chrome

`bdg` automatically launches Chrome with debugging enabled if not already running. You can also manually start Chrome:

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

If Chrome is already running with debugging enabled, `bdg` will detect and use the existing instance.

### Two-Tier Preview System

`bdg` writes two files during collection:
- **Lightweight preview** (~360KB): Metadata only, used by `bdg peek` for fast monitoring
- **Full data** (~87MB): Complete data with request/response bodies, used by `bdg details`

This 241x size reduction enables efficient monitoring without stopping collection.

### Session Files

Session state tracked in `~/.bdg/`:
- `session.pid` - PID of running session
- `session.lock` - Lock file for atomic session acquisition
- `session.meta.json` - Session metadata (start time, Chrome PID, port, target info)
- `session.preview.json` - Lightweight preview data
- `session.full.json` - Complete data with bodies
- `session.json` - Final output from last session (written on stop)

All session files are automatically cleaned up on graceful shutdown.

## Requirements

- Node.js >= 18.0.0
- Chrome/Chromium with remote debugging

## Development Status

This tool is still under active development. If you're using it, I'd love to hear how you're using it and what works (or doesn't work) for your use case. Please [raise an issue](https://github.com/szymdzum/browser-debugger-cli/issues) with feedback, bug reports, or feature requests.

## License

MIT
