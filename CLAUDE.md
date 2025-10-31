# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**bdg** is a CLI tool for collecting browser telemetry (DOM, network, console) via Chrome DevTools Protocol (CDP). It's designed for agentic/automated use with a simple run-until-stopped pattern where a human or agent controls collection timing via Ctrl+C.

## Development Workflow

### Setup
```bash
npm install           # Install dependencies
npm run build         # Compile TypeScript to dist/
npm link              # Install globally as 'bdg' command
```

### Development Commands
```bash
npm run build         # Compile TypeScript
npm run watch         # Watch mode for development
npm run dev           # Build and run (tsc && node dist/index.js)
node dist/index.js    # Run compiled version directly
```

### Testing Locally
After building, test the CLI:
```bash
node dist/index.js --help
node dist/index.js --version
node dist/index.js localhost:3000
```

## Common Commands

### Running the Tool

**Default Behavior: Runs Until Stopped**
By default, bdg runs indefinitely until you stop it with `Ctrl+C` or `bdg stop`:

```bash
# Start collection (runs indefinitely)
bdg localhost:3000

# In another terminal or via agent: stop and get results
bdg stop
```

**Agent-Friendly Workflow** (for AI assistants like Claude Code):
```bash
# 1. Agent starts collection in background
bdg "localhost:3000/customer/signin?redirectTo=%2F"

# 2. User interacts with the browser manually
#    (fills form, clicks button, sees error, etc.)

# 3. User tells agent: "analyze the errors now"

# 4. Agent stops collection and captures output
bdg stop > analysis.json

# 5. Agent analyzes the JSON data
jq '.data.console[] | select(.type == "error")' analysis.json
```

**Traditional Workflow with Timeout**:
```bash
# Auto-stop after timeout (optional)
bdg localhost:3000 --timeout 30             # Stops after 30s
```

**Collect Specific Data**:
```bash
bdg dom localhost:3000        # DOM snapshot only
bdg network localhost:3000    # Network requests only
bdg console localhost:3000    # Console logs only
```

**Options**:
```bash
bdg localhost:3000 --port 9223              # Custom CDP port
bdg localhost:3000 --timeout 30             # Auto-stop after timeout
```

### Chrome Setup (Optional)
Chrome is **auto-launched** if not already running. You can also manually start Chrome with debugging:
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

**Note:** Chrome 136+ requires `--user-data-dir` with a non-default directory. See CHROME_SETUP.md for details.

### Session Management

**Session State Files**:
bdg tracks active sessions using files in `~/.bdg/`:
- `session.pid` - PID of currently running session
- `session.json` - Output from last session (written on stop)

**Session Commands**:
```bash
# Start a session
bdg localhost:3000
# Creates ~/.bdg/session.pid
# Collects data until stopped

# Stop the session
bdg stop
# Sends SIGINT to process
# Waits for graceful shutdown
# Outputs JSON from ~/.bdg/session.json
# Cleans up PID file
```

**Session Behaviors**:
- **Only one session at a time**: Starting bdg when a session is already running will error
- **Automatic cleanup**: PID file is removed on graceful shutdown (Ctrl+C or `bdg stop`)
- **Stale session detection**: If a PID file exists but the process is dead, bdg will clean it up automatically
- **Output persistence**: Session data is written to `~/.bdg/session.json` even if the process crashes

**Error Handling**:
```bash
# No session running
$ bdg stop
Error: No active session found
Start a session with: bdg <url>

# Session already running
$ bdg localhost:3000
{
  "success": false,
  "error": "Session already running (PID 12345). Stop it with: bdg stop"
}
```

## Architecture

### Entry Point (`src/index.ts`)
- CLI definition using Commander.js
- Signal handlers (SIGINT/SIGTERM) for graceful shutdown
- Global state management for collectors
- Output formatting (JSON to stdout)

### CDP Connection Layer (`src/connection/`)
- **cdp.ts**: WebSocket client for Chrome DevTools Protocol
  - Request/response handling with message ID tracking
  - Event subscription system for CDP events
  - Connection lifecycle management
  - 30s timeout for commands, 10s for connection
- **finder.ts**: Target discovery - finds browser tabs by URL
  - Tries exact match → URL contains → hostname match
  - Shows available tabs on failure for helpful error messages
- **launcher.ts**: Auto-launches Chrome with CDP if not already running

### Data Collectors (`src/collectors/`)
Each collector is independent and enables its CDP domain:
- **dom.ts**: Captures DOM snapshot on shutdown via `DOM.getDocument` + `DOM.getOuterHTML`
- **network.ts**: Tracks HTTP requests/responses
  - Listens for `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFinished`
  - Stores request/response pairs with headers and bodies (JSON/text only)
  - MAX_REQUESTS limit (10,000) to prevent memory issues
- **console.ts**: Captures console logs and exceptions via `Runtime.consoleAPICalled` and `Log.entryAdded`

### Utilities (`src/utils/`)
- **url.ts**: Centralized URL normalization
- **validation.ts**: Input validation for collector types
- **session.ts**: Session management (PID tracking, output persistence)
  - File operations for `~/.bdg/session.pid` and `~/.bdg/session.json`
  - Process alive checking (cross-platform)
  - Stale session cleanup

### Session Management (`src/session/`)
- **BdgSession.ts**: Encapsulates CDP session lifecycle
  - Connection management with retry and keepalive
  - Collector lifecycle management
  - Cleanup and graceful shutdown

### Type Definitions (`src/types.ts`)
- `CDPMessage`, `CDPTarget`: CDP protocol types
- `CDPNetworkRequestParams`, `CDPNetworkResponseParams`, etc.: Typed CDP event parameters
- `NetworkRequest`, `ConsoleMessage`, `DOMData`: Collected data types
- `BdgOutput`: Final JSON output structure
- `CollectorType`: 'dom' | 'network' | 'console'
- `CleanupFunction`: Type for collector cleanup handlers

## Key Design Patterns

### Signal-Based Lifecycle
- Collectors start immediately on connection
- Events accumulate in arrays during session
- Ctrl+C (SIGINT) triggers graceful shutdown with final DOM snapshot
- Output is JSON to stdout, logs/status to stderr

### Event Collection Pattern
```typescript
// Pattern used by all collectors:
1. Enable CDP domain: await cdp.send('Domain.enable')
2. Register event handlers with typed params: cdp.on('Domain.eventName', handler)
3. Store handler IDs with event names: handlers.push({ event, id })
4. Accumulate data in shared array passed by reference
5. Return cleanup function that properly removes handlers
6. On shutdown, DOM snapshot is captured last
```

### Connection Management
- WebSocket stays open until stopped or connection lost
- Event-driven monitoring using `Target.targetDestroyed` for tab closure
- Keepalive pings (every 30s) detect connection health
- Graceful error handling with structured JSON error output

### URL Normalization
- Automatically adds `http://` if no protocol specified
- Supports: `localhost:3000`, `example.com`, `http://localhost:8080/app`

## Adding New Collectors

1. Create `src/collectors/newcollector.ts`:
```typescript
import { CDPConnection } from '../connection/cdp.js';
import { CleanupFunction, CDPNewEventParams } from '../types.js';

/**
 * Start collecting new telemetry data.
 *
 * @param cdp - CDP connection instance
 * @param data - Array to populate with collected data
 * @returns Cleanup function to remove event handlers
 */
export async function startNewCollection(
  cdp: CDPConnection,
  data: NewDataType[]
): Promise<CleanupFunction> {
  const handlers: Array<{ event: string; id: number }> = [];

  // Enable CDP domain
  await cdp.send('Domain.enable');

  // Register event handler with typed params
  const handlerId = cdp.on('Domain.eventName', (params: CDPNewEventParams) => {
    data.push({
      field: params.field,
      timestamp: Date.now()
    });
  });
  handlers.push({ event: 'Domain.eventName', id: handlerId });

  // Return cleanup function
  return () => {
    handlers.forEach(({ event, id }) => cdp.off(event, id));
  };
}
```

2. Add types to `src/types.ts`:
```typescript
export interface NewDataType {
  field: string;
  timestamp: number;
}

export interface CDPNewEventParams {
  field: string;
  // ... other parameters
}

export type CollectorType = 'dom' | 'network' | 'console' | 'newcollector';
```

3. Wire into `src/session/BdgSession.ts`:
```typescript
import { startNewCollection } from '../collectors/newcollector.js';

// In BdgSession class:
private newData: NewDataType[] = [];

// Add case to startCollector():
case 'newcollector':
  cleanup = await startNewCollection(this.cdp, this.newData);
  break;

// Add to stop() method output:
if (this.activeCollectors.includes('newcollector')) {
  output.data.newcollector = this.newData;
}
```

4. Add CLI command in `src/index.ts`:
```typescript
program
  .command('newcollector')
  .description('Collect new telemetry data')
  .argument('<url>', 'Target URL')
  .option('-p, --port <number>', 'Chrome debugging port', '9222')
  .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    await run(url, { port, timeout }, ['newcollector']);
  });
```

## Output Format

JSON structure written to stdout on success:
```json
{
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
  "success": false,
  "timestamp": "2025-10-31T12:00:00.000Z",
  "duration": 1234,
  "target": { "url": "", "title": "" },
  "data": {},
  "error": "Error message here"
}
```

## Dependencies

### Production
- **commander** (^12.1.0): CLI framework with type-safe arguments
- **ws** (^8.18.0): WebSocket client for CDP connection

### Development
- **typescript** (^5.6.0): ES2022 target, strict mode, ES modules
- **@types/node** (^20.0.0), **@types/ws** (^8.5.10): Type definitions

## Build Output

After running `npm run build`:
- **dist/**: Compiled JavaScript files (~160KB)
- **node_modules/**: Dependencies (~28MB, shared across projects)

## Distribution

This package is designed for npm distribution:
```bash
npm publish  # Publishes to npm registry
```

The `.npmignore` file ensures only the compiled `dist/` folder and README.md are published, keeping the package small.

## Important Notes

- All imports use `.js` extensions (Node.js ESM convention) even though source is `.ts`
- This is standard for Node.js ESM modules with TypeScript
- Exit codes: 0 = success, 1 = error
- Status messages go to stderr, JSON output to stdout
- Connection checks prevent silent failures when tabs close
- Network collector intelligently fetches response bodies only for JSON/text MIME types
