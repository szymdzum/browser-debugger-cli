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
```bash
# Collect all telemetry (default)
bdg localhost:3000

# Collect specific data
bdg dom localhost:3000
bdg network localhost:3000
bdg console localhost:3000

# Options
bdg localhost:3000 --port 9223              # Custom CDP port
bdg localhost:3000 --timeout 30             # Auto-stop after 30s
bdg localhost:3000 --no-launch              # Don't auto-launch Chrome
bdg localhost:3000 --wait-for-load          # Wait for page load before collecting
```

### Chrome Setup (Required)
Chrome must be launched with debugging enabled:
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
- **pageLoad.ts**: Wait for page load with network idle detection

### Type Definitions (`src/types.ts`)
- `CDPMessage`, `CDPTarget`: CDP protocol types
- `NetworkRequest`, `ConsoleMessage`, `DOMData`: Collected data types
- `BdgOutput`: Final JSON output structure
- `CollectorType`: 'dom' | 'network' | 'console'

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
2. Register event handlers: cdp.on('Domain.eventName', handler)
3. Accumulate data in shared array passed by reference
4. On shutdown, DOM snapshot is captured last
```

### Connection Management
- WebSocket stays open until stopped or connection lost
- Periodic connection checks (every 1s) detect tab closure
- Graceful error handling with structured JSON error output

### URL Normalization
- Automatically adds `http://` if no protocol specified
- Supports: `localhost:3000`, `example.com`, `http://localhost:8080/app`

## Adding New Collectors

1. Create `src/collectors/newcollector.ts`:
```typescript
import { CDPConnection } from '../connection/cdp.js';

export async function startNewCollection(
  cdp: CDPConnection,
  data: NewDataType[]
): Promise<void> {
  await cdp.send('Domain.enable');

  cdp.on('Domain.eventName', (params: any) => {
    data.push({
      field: params.field,
      timestamp: Date.now()
    });
  });
}
```

2. Add type to `src/types.ts`:
```typescript
export interface NewDataType {
  field: string;
  timestamp: number;
}

export type CollectorType = 'dom' | 'network' | 'console' | 'newcollector';
```

3. Import and wire in `src/index.ts`:
```typescript
import { startNewCollection } from './collectors/newcollector.js';

// Add to global state
let newData: NewDataType[] = [];

// Add to run() function
if (collectors.includes('newcollector')) {
  await startNewCollection(cdp, newData);
}

// Add to handleStop() output
if (activeCollectors.includes('newcollector')) {
  output.data.newcollector = newData;
}

// Add command
program
  .command('newcollector')
  .description('Collect new data')
  .argument('<url>', 'Target URL')
  .action(async (url, options) => {
    await run(url, { port: parseInt(options.port), ... }, ['newcollector']);
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
