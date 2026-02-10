# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Agent-Friendly Discovery (START HERE)

**bdg is self-documenting - use these FIRST:**

```bash
bdg --help --json                       # All commands, flags, exit codes
bdg cdp --list                          # 53 CDP domains
bdg cdp Network --list                  # Methods in a domain
bdg cdp Network.getCookies --describe   # Full method schema
bdg cdp --search cookie                 # Search methods
```

**Key Principle:** Discover capabilities programmatically before implementation.

### Chrome Connection Scenarios (Auto-Detect)

bdg supports multiple Chrome connection modes. Use auto-detection to identify the appropriate mode:

```bash
CHROME_PORT=${CHROME_DEBUG_PORT:-9222}

for port in $CHROME_PORT 9222 9223 9224; do
  if curl -s http://localhost:$port/json/version &>/dev/null; then
    echo "Chrome accessible on port $port"
    export CHROME_DEBUG_PORT=$port
    break
  fi
done

which google-chrome chromium-browser chromium chrome &>/dev/null && echo "Chrome binary found"
echo "CHROME_PATH: ${CHROME_PATH:-not set}"
```

**Decision tree:**
- **Chrome debugging port accessible** → Use `--chrome-ws-url` (external/remote Chrome)
- **Chrome binary found** → Use `bdg <url>` (bdg launches Chrome)
- **Neither** → Install Chrome or configure remote debugging

**Environment variables:**
- `CHROME_DEBUG_PORT` - Chrome debugging port (default: 9222, but can be any port)
- `CHROME_PATH` - Path to Chrome binary for managed mode (file path only, not URLs)

**Port flexibility:**
Chrome's remote debugging port is configurable. Common ports: 9222 (default), 9223, 9224, 9333.
Always check multiple ports or use `CHROME_DEBUG_PORT` to specify. The auto-detection script
checks common ports automatically.

See "Chrome Connection Modes" section for detailed workflows.

---

## Essential Patterns

### CommandRunner (`src/commands/shared/CommandRunner.ts`)
All commands use this wrapper for consistent error handling and JSON/human output:
```typescript
await runCommand(
  async () => {
    const response = await ipcFunction(params);
    return response.status === 'error'
      ? { success: false, error: response.error }
      : { success: true, data: response.data };
  },
  options,
  formatFunction
);
```

### Error Handling
```typescript
import { CommandError } from '@/ui/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

throw new CommandError(
  'Session not found',
  { suggestion: 'Start a session with: bdg <url>' },
  EXIT_CODES.RESOURCE_NOT_FOUND
);
```

### Message Centralization (`src/ui/messages/`)
All user-facing strings must use centralized functions - no inline strings.

### Error Messages with Suggestions (`src/ui/messages/errors.ts`)
Common error patterns with recovery suggestions. Use existing functions or add new ones:
```typescript
// Existing: elementNotFoundError, sessionNotActiveError, daemonNotRunningError
throw new CommandError(elementNotFoundError(selector), {}, EXIT_CODES.RESOURCE_NOT_FOUND);

// Context-specific: pass suggestion inline
throw new CommandError(
  `Index ${index} out of range (found ${count} nodes)`,
  { suggestion: 'Re-run query to refresh cache' },
  EXIT_CODES.STALE_CACHE
);
```

### Option Behaviors (`src/commands/optionBehaviors.ts`)
When adding commands/flags with non-obvious behaviors, register in `OPTION_BEHAVIORS`:
```typescript
'commandName:--flag': {
  default: 'What happens without this flag',
  whenEnabled: 'What happens with this flag',
  automaticBehavior: 'Hidden behaviors agents should know',
  tokenImpact: 'Token cost implications (if relevant)',
}
```

### Logging (`src/ui/logging/`)
```typescript
const log = createLogger('module-name');
log.info('Always shown');
log.debug('Only in debug mode');
```

---

## Agent-Friendly Consistency Patterns

### JSON Output Envelope
All `--json` output must follow `BdgResponse` structure:
```typescript
// Success
{ version: "x.y.z", success: true, data: {...} }

// Error
{ version: "x.y.z", success: false, error: "msg", exitCode: 83, suggestion: "..." }
```

### Exit Codes
Use semantic codes from `src/utils/exitCodes.ts`:
- **0**: Success
- **80-99**: User errors (invalid input, resources)
- **100-119**: Software errors (bugs, timeouts)

Common: `INVALID_ARGUMENTS` (81), `RESOURCE_NOT_FOUND` (83), `STALE_CACHE` (87), `CDP_TIMEOUT` (102)

### Index vs Selector Errors
When operations fail on numeric indices, use index-specific errors:
```typescript
// Index-based failure (stale nodeId)
throw new CommandError(
  `Element at index ${index} not accessible`,
  { suggestion: 'Re-run query to refresh cache' },
  EXIT_CODES.STALE_CACHE  // 87, not RESOURCE_NOT_FOUND
);

// Selector-based failure
throw new CommandError(
  elementNotFoundError(selector),  // Uses selector-specific suggestions
  {},
  EXIT_CODES.RESOURCE_NOT_FOUND
);
```

### Typo Detection
For options with limited choices, provide suggestions:
```typescript
// In validation
if (!VALID_PRESETS.includes(preset)) {
  const suggestions = findSimilar(preset, VALID_PRESETS);
  throw new CommandError(
    `Unknown preset: "${preset}"`,
    { suggestion: suggestions.length ? `Did you mean: ${suggestions[0]}?` : `Available: ${VALID_PRESETS.join(', ')}` },
    EXIT_CODES.INVALID_ARGUMENTS
  );
}
```

### 0-Based Indexing
All indices are 0-based everywhere (query output, `--index` option, `dom get`).

---

## Git Commit Guidelines

**Do NOT include Claude Code attribution** - no footers, no Co-Authored-By.

**Never auto-commit** - implement changes, show diff, wait for user approval.

---

## Project Overview

**bdg** is a CLI for browser telemetry via Chrome DevTools Protocol. Architecture:
```text
CLI Command → Unix Socket → Daemon → Worker (CDP connection)
```

### Key Modules
- `src/commands/` - CLI handlers using CommandRunner
- `src/connection/` - CDP WebSocket, Chrome launcher
- `src/daemon/` - IPC server, worker process
- `src/telemetry/` - DOM, network, console collectors
- `src/ui/` - Errors, logging, messages, formatters
- `src/utils/` - Exit codes, validation, suggestions

### Import Paths
Use absolute imports: `import { X } from '@/module/file.js';`

---

## Development

```bash
npm install && npm run build && npm link  # Setup
npm run build                              # Compile
npm run watch                              # Dev mode
bdg --help                                 # Run (after npm link)
```

### Code Quality
- **KISS/DRY/YAGNI** - Simple, no duplication, no speculative features
- **TSDoc** - All functions documented
- **No dead code** - Delete unused code, don't comment out
- **No empty catch** - Use `log.debug()` for visibility
- **No inline comments** - Use TSDoc comments

#### Function Design
- **Single responsibility** - Extract large functions into smaller, focused units
- **Max ~30 lines** - If longer, consider splitting
- **Consolidate patterns** - Identify repeated logic, use appropriate abstractions

#### Readability
- **Descriptive names** - Functions/variables should be self-documenting
- **Early returns** - Reduce nesting with guard clauses
- **Consistent structure** - Similar operations should look similar

---

## Common Commands

```bash
# Session (Managed Chrome)
bdg <url>                    # Start
bdg status                   # Check
bdg stop                     # End

# Session (External/Remote Chrome)
CHROME_PORT=9333  # Or any port Chrome is running on
WS_URL=$(curl -s http://localhost:$CHROME_PORT/json/list | jq -r '.[0].webSocketDebuggerUrl')
bdg --chrome-ws-url "$WS_URL" <url>

# Inspection
bdg peek                     # Preview data
bdg network list             # Network requests
bdg network websockets       # WebSocket connections and frames
bdg console                  # Console messages

# DOM (0-based indices)
bdg dom query "selector"     # Find elements [0], [1], [2]...
bdg dom get 0                # Get first element
bdg dom fill "input" "val"   # Fill form
bdg dom click "button"       # Click
bdg dom scroll "footer"      # Scroll to element (or --down 500, --bottom)

# CDP
bdg cdp Runtime.evaluate --params '{"expression":"document.title"}'
```

See `docs/CLI_REFERENCE.md` for complete reference.

---

## Chrome Connection Modes

### Mode 1: Managed Chrome (Default)

Chrome is installed locally and bdg launches it.

```bash
bdg <url>
bdg network websockets --verbose
```

**Requirements:**
- Chrome/Chromium binary installed
- `CHROME_PATH` env var set to Chrome binary (optional)
- Process launch permissions

**WebSocket Capture:**
- CDP events (native support)
- No fallback needed

---

### Mode 2: External Chrome (Same Machine)

Chrome is already running locally with debugging enabled.

```bash
CHROME_PORT=9222
google-chrome --remote-debugging-port=$CHROME_PORT --user-data-dir=/tmp/chrome-debug &

WS_URL=$(curl -s http://localhost:$CHROME_PORT/json/list | \
  jq -r '.[] | select(.url | contains("your-url")) | .webSocketDebuggerUrl')

bdg --chrome-ws-url "$WS_URL" <url>
bdg network websockets --verbose
```

**Requirements:**
- Chrome running with `--remote-debugging-port=<PORT>`
- Debugging port accessible locally
- Target tab identified via URL pattern

**WebSocket Capture:**
- JavaScript fallback (activates after 3s)
- CDP events unavailable for external Chrome

---

### Mode 3: Remote Chrome (Port Forwarding)

Chrome runs on a different machine with port forwarding.

**Local machine setup:**
```bash
CHROME_PORT=9222
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=$CHROME_PORT \
  --user-data-dir="$HOME/.chrome-debug-profile"
```

**Cloud workspace:**
```bash
CHROME_PORT=${CHROME_DEBUG_PORT:-9222}

curl -s http://localhost:$CHROME_PORT/json/version | jq .

WS_URL=$(curl -s http://localhost:$CHROME_PORT/json/list | \
  jq -r '.[] | select(.url | contains("localhost:5173")) | .webSocketDebuggerUrl')

bdg --chrome-ws-url "$WS_URL" <url>
bdg network websockets --verbose --last 20
```

**Requirements:**
- Chrome running on local machine with debugging port
- Port forwarded via SSH/VSCode/IDE (any port supported)
- Stable network connection

**WebSocket Capture:**
- JavaScript fallback (same as Mode 2)
- CDP events unavailable for remote Chrome

---

### Mode 4: Docker/Headless Chrome

Chrome runs in containers or CI/CD environments.

```bash
CHROME_PORT=9222
docker run -d -p $CHROME_PORT:9222 zenika/alpine-chrome \
  --remote-debugging-address=0.0.0.0 --remote-debugging-port=9222

bdg --chrome-ws-url "ws://localhost:$CHROME_PORT/devtools/page/..." <url>
```

---

### Auto-Detection Script

```bash
#!/bin/bash
detect_chrome_mode() {
  local chrome_port=""
  local common_ports=(${CHROME_DEBUG_PORT:-9222} 9222 9223 9224 9333)

  for port in "${common_ports[@]}"; do
    if curl -s --max-time 1 http://localhost:$port/json/version &>/dev/null; then
      chrome_port=$port
      break
    fi
  done

  if [ -n "$chrome_port" ]; then
    echo "Mode: External/Remote Chrome (port $chrome_port)"

    local tabs_json=$(curl -s http://localhost:$chrome_port/json/list)
    local tab_count=$(echo "$tabs_json" | jq '. | length')

    echo "Found $tab_count open tab(s)"
    echo "$tabs_json" | jq -r '.[] | "  [\(.id[0:8])...] \(.title) - \(.url)"' | head -5

    local ws_url=$(echo "$tabs_json" | jq -r '.[0].webSocketDebuggerUrl')
    echo ""
    echo "Example command (first tab):"
    echo "  WS_URL=\"$ws_url\""
    echo "  bdg --chrome-ws-url \"\$WS_URL\" <url>"
    echo ""
    echo "To target specific tab by URL pattern:"
    echo "  WS_URL=\$(curl -s http://localhost:$chrome_port/json/list | \\"
    echo "    jq -r '.[] | select(.url | contains(\"your-pattern\")) | .webSocketDebuggerUrl')"
    return 0
  fi

  if which google-chrome chromium-browser chromium chrome &>/dev/null || [ -n "$CHROME_PATH" ]; then
    echo "Mode: Managed Chrome"
    echo "Command: bdg <url>"
    [ -n "$CHROME_PATH" ] && echo "Using CHROME_PATH: $CHROME_PATH"
    return 0
  fi

  echo "Mode: No Chrome detected"
  echo "Options:"
  echo "  1. Install Chrome/Chromium locally"
  echo "  2. Start Chrome with --remote-debugging-port=<PORT>"
  echo "  3. Forward debugging port from remote machine"
  echo "  4. Set CHROME_PATH to Chrome binary location"
  return 1
}

detect_chrome_mode
```

---

### Key Differences

| Feature | Managed Chrome | External/Remote Chrome |
|---------|----------------|------------------------|
| Launch | bdg launches | User launches |
| WebSocket Capture | CDP events (native) | JavaScript fallback |
| Command | `bdg <url>` | `bdg --chrome-ws-url <ws-url> <url>` |
| Setup | `CHROME_PATH` to binary | Port 9222 accessible |
| Use Case | Development, local testing | Cloud workspace, existing browser |

---

### Configuration Guidelines

| Scenario | Correct | Incorrect |
|----------|---------|-----------|
| Remote Chrome | `--chrome-ws-url ws://localhost:<PORT>/devtools/...` | `CHROME_PATH=http://...` |
| Local binary | `CHROME_PATH=/usr/bin/chrome` | `CHROME_PATH` as URL |
| Port detection | Check multiple ports (9222, 9223, etc.) | Assume port 9222 only |
| WebSocket capture | Start bdg, then reload page | Expect existing connections |
| External Chrome | JavaScript fallback (automatic) | Assume CDP events work |
| Port variable | `CHROME_DEBUG_PORT=9333` | Hardcode port numbers |

---

## Session Files

Location: `~/.bdg/`
- `daemon.pid`, `daemon.sock` - Daemon state
- `session.meta.json` - Session metadata
- `session.json` - Final output (on stop)

---

## Troubleshooting

```bash
bdg status --verbose         # Diagnostics
bdg cleanup --force          # Kill stale session
bdg cleanup --aggressive     # Kill all Chrome processes
```

### Common Issues

**"CHROME_PATH environment variable must be set"**

Managed Chrome mode active but Chrome binary not found.

Solutions:
1. Install Chrome/Chromium locally
2. Switch to External/Remote Chrome mode with `--chrome-ws-url`

Note: `CHROME_PATH` accepts file paths only, not URLs.

**"No WebSocket connections found"**

WebSocket connections created before bdg session started.

Resolution:
```bash
bdg <url>
bdg dom eval "window.location.reload()"
sleep 10
bdg network websockets --verbose
```

JavaScript fallback activates after 3 seconds for external Chrome.

**"Session target not found (tab may have been closed)"**

Chrome tab closed or navigated when using `--chrome-ws-url`.

Solution: Obtain fresh WebSocket URL and reconnect.

**Port forwarding verification**

```bash
CHROME_PORT=${CHROME_DEBUG_PORT:-9222}

for port in $CHROME_PORT 9222 9223 9224; do
  if curl -s --max-time 1 http://localhost:$port/json/version &>/dev/null; then
    echo "Chrome found on port $port"
    curl -s http://localhost:$port/json/version | jq .
    curl -s http://localhost:$port/json/list | jq -r '.[] | "\(.title) -> \(.url)"'
    export CHROME_DEBUG_PORT=$port
    break
  fi
done
```

Verify:
- Chrome running with `--remote-debugging-port=<PORT>`
- Port forwarding active (IDE/SSH/VSCode)
- Firewall allows the debugging port
- Check multiple common ports (9222, 9223, 9224, 9333)

**Mode selection**

Run auto-detection script in Chrome Connection Modes section.
