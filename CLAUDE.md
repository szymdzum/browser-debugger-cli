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

## Code Quality Guidelines

### No Dead Code
**IMPORTANT**: Remove all dead code immediately. Delete don't disable:

- Unused variables, imports, functions, parameters - **delete entirely** (no `_` prefix)
- Unreachable code after `return`/`throw` - **delete**
- Commented-out code - **delete** (use git history if needed)

```typescript
// ❌ BAD
try { ... } catch (_error) { console.error('failed'); }

// ✅ GOOD
try { ... } catch { console.error('failed'); }
```

Rationale: Dead code obscures behavior and increases maintenance burden.

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
# Additive flags (enable only specific collectors)
bdg localhost:3000 --dom                    # DOM snapshot only
bdg localhost:3000 --network                # Network requests only
bdg localhost:3000 --console                # Console logs only
bdg localhost:3000 --dom --console          # DOM and console only

# Subtractive flags (disable specific collectors)
bdg localhost:3000 --skip-console             # Network and DOM only
bdg localhost:3000 --skip-dom --skip-network  # Console only
```

**Basic Options**:
```bash
bdg localhost:3000 --port 9223              # Custom CDP port
bdg localhost:3000 --timeout 30             # Auto-stop after timeout
bdg localhost:3000 --all                    # Include all data (disable filtering)
bdg localhost:3000 --user-data-dir ~/custom # Custom Chrome profile directory
```

**Advanced Chrome Options**:
```bash
# Chrome Launcher Configuration
bdg localhost:3000 --log-level verbose      # Chrome launcher logging (verbose|info|error|silent)
bdg localhost:3000 --connection-poll-interval 1000  # CDP readiness check interval (ms)
bdg localhost:3000 --max-connection-retries 100     # Maximum connection retry attempts
bdg localhost:3000 --port-strict            # Fail if port is already in use (lenient by default)

# Chrome Preferences
bdg localhost:3000 --chrome-prefs '{"download.default_directory":"/tmp"}'  # Inline JSON prefs
bdg localhost:3000 --chrome-prefs-file ./prefs.json                        # Load prefs from file

# Chrome Flags
bdg localhost:3000 --chrome-flags --disable-gpu --no-sandbox  # Additional Chrome command-line flags
```

**Performance Optimization Options**:
```bash
# Network Optimization (50-80% data reduction)
bdg localhost:3000 --fetch-all-bodies                          # Fetch all bodies (override auto-skip)
bdg localhost:3000 --fetch-bodies-include "*/api/*,*/graphql"  # Only fetch specific patterns
bdg localhost:3000 --fetch-bodies-exclude "*tracking*"         # Additional patterns to skip
bdg localhost:3000 --network-include "api.example.com"         # Only capture specific hosts
bdg localhost:3000 --network-exclude "*analytics*,*ads*"       # Exclude tracking domains

# Output Optimization (30% size reduction)
bdg localhost:3000 --compact                                    # Compact JSON (no indentation)

# Pattern Syntax: Simple wildcards (* matches anything)
#   api.example.com         -> matches all requests to that host
#   */api/*                 -> matches any path containing /api/
#   *analytics*             -> matches any hostname with "analytics"
#   *.png                   -> matches all PNG images
#
# Pattern Precedence: Include always trumps exclude
#   --network-include "api.example.com" --network-exclude "*example.com"
#   -> api.example.com is captured despite exclude pattern
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
- `session.lock` - Lock file for atomic session acquisition
- `session.meta.json` - Session metadata (start time, Chrome PID, port, target info)
- `session.preview.json` - Lightweight preview data (metadata only, ~360KB)
- `session.full.json` - Complete data with request/response bodies (~87MB)
- `session.json` - Final output from last session (written on stop)

**Session Commands**:
```bash
# Start a session
bdg localhost:3000
# Creates ~/.bdg/session.pid and starts collection
# Collects data until stopped

# Check session status (without stopping)
bdg status                      # Basic status information
bdg status --verbose            # Include Chrome diagnostics (binary path, installations)
bdg status --json               # JSON output

# Preview collected data (without stopping)
bdg peek
# Shows last 10 network requests and console messages (compact format)
bdg peek --last 50              # Show last 50 items
bdg peek --network              # Show only network requests
bdg peek --console              # Show only console messages
bdg peek --follow               # Live updates every second
bdg peek --json                 # JSON output
bdg peek --verbose              # Verbose output (full URLs, emojis)

# Get full details for specific items
bdg details network <requestId>     # Full request/response with bodies
bdg details console <index>         # Full console message with args

# Stop the session
bdg stop
# Sends SIGKILL to process
# Cleans up all session files (PID, lock, metadata, preview, full)

# Clean up stale session files
bdg cleanup                     # Remove stale session files
bdg cleanup --force             # Force cleanup even if session appears active
bdg cleanup --aggressive        # Kill all Chrome processes (uses chrome-launcher killAll)
bdg cleanup --all               # Also remove session.json output file
```

**Session Behaviors**:
- **Only one session at a time**: Starting bdg when a session is already running will error
- **Automatic cleanup**: All session files removed on graceful shutdown (Ctrl+C or `bdg stop`)
- **Stale session detection**: If a PID file exists but the process is dead, bdg will clean it up automatically
- **Output persistence**: Session data is written to `~/.bdg/session.json` even if the process crashes
- **Two-tier preview system**: Writes both lightweight preview and full data every 5 seconds for efficient monitoring

**Two-Tier Preview System**:
bdg uses a two-tier file system to optimize performance:

1. **Lightweight Preview** (`session.preview.json` - ~360KB):
   - Metadata only (no request/response bodies)
   - Last 1000 network requests and console messages
   - Used by `bdg peek` for fast previews
   - 241x smaller than full data

2. **Full Data** (`session.full.json` - ~87MB):
   - Complete data with all request/response bodies and headers
   - All network requests and console messages
   - Used by `bdg details` for on-demand deep inspection
   - Only read when detailed information is needed

**Workflow Example**:
```bash
# 1. Start collection
bdg localhost:3000

# 2. Quick preview (fast - reads 360KB file, compact format)
bdg peek --last 10
# Output shows: 200 POST api.example.com/users [12345.678]

# 3. Get full details (reads 87MB file, extracts one request)
bdg details network 12345.678
# Shows complete request/response headers and bodies

# 4. Stop when done
bdg stop
```

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

### Output Formatting & Filtering

**Compact Output Format (Default)**:
By default, `bdg peek` uses a compact, agent-optimized output format that reduces token consumption by 67-72%:
- No Unicode box-drawing characters (━━━)
- No emojis (✓, ❌, ⚠️, ℹ️)
- Truncated URLs: `api.example.com/users` instead of full URLs
- Truncated stack traces: Limited to 2-3 lines with "... (N more lines)" indicator

```bash
# Default: compact output (optimized for AI agents)
bdg peek

# Verbose output (full URLs, emojis, for human readability)
bdg peek --verbose
```

**Default Filtering & Optimization**:
By default, bdg applies multiple optimization layers to reduce data volume by 50-80%:

**Network Request Filtering** (13 domains excluded):
- `analytics.google.com`, `googletagmanager.com`, `googleadservices.com`
- `doubleclick.net`, `clarity.ms`, `facebook.com`, `connect.facebook.net`
- `tiktok.com`, `bat.bing.com`, `exactag.com`
- `fullstory.com`, `hotjar.com`, `confirmit.com`

**Automatic Body Skipping** (response bodies auto-skipped for non-essential assets):
- Images: `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.svg`, `*.ico`, `*.webp`
- Fonts: `*.woff`, `*.woff2`, `*.ttf`, `*.eot`, `*.otf`
- Stylesheets: `*.css`
- Source maps: `*.map`, `*.js.map`, `*.css.map`
- Videos: `*.mp4`, `*.webm`, `*.ogg`, `*.avi`, `*.mov`
- Audio: `*.mp3`, `*.wav`, `*.flac`, `*.aac`

**Console Filtering** (4 patterns excluded):
- `webpack-dev-server`, `[HMR]`, `[WDS]`
- `Download the React DevTools`

```bash
# Default: filtering and auto-optimization enabled
bdg localhost:3000

# Include all data (disable all filtering and optimization)
bdg localhost:3000 --all

# Override just body skipping (still filters tracking domains)
bdg localhost:3000 --fetch-all-bodies
```

**Why These Defaults?**
- Designed for agentic/automated use where token efficiency is critical
- Filtering removes noise that's rarely relevant for debugging (tracking, dev server logs)
- Auto-skip optimization reduces bandwidth and storage without losing critical data (API responses, HTML, JS)
- Verbose/unfiltered modes available when human readability or complete data is needed

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
  - Default filtering excludes 13 tracking/analytics domains (configurable via `--all` flag)
- **console.ts**: Captures console logs and exceptions via `Runtime.consoleAPICalled` and `Log.entryAdded`
  - Default filtering excludes 4 dev server noise patterns (configurable via `--all` flag)

### Utilities (`src/utils/`)
- **url.ts**: Centralized URL normalization and truncation
  - `normalizeUrl()` - Adds protocol if missing, validates URLs
  - `truncateUrl()` - Shortens URLs for compact output (e.g., `api.example.com/users`)
  - `truncateText()` - Limits text to N lines for stack traces
- **validation.ts**: Input validation for collector types
- **filters.ts**: Default filtering for tracking/analytics and dev server noise
  - `DEFAULT_EXCLUDED_DOMAINS` - 13 tracking/analytics domains
  - `DEFAULT_EXCLUDED_CONSOLE_PATTERNS` - 4 dev server patterns
  - `shouldExcludeDomain()` - Network request domain filtering
  - `shouldExcludeConsoleMessage()` - Console message pattern filtering
- **session.ts**: Session management (PID tracking, output persistence, two-tier preview)
  - File operations for session files in `~/.bdg/`
  - Process alive checking (cross-platform)
  - Stale session cleanup with atomic lock file
  - Two-tier preview system:
    - `writePartialOutput()` - Writes lightweight preview (metadata only)
    - `writeFullOutput()` - Writes complete data with bodies
    - `readPartialOutput()` - Reads preview for `bdg peek`
    - `readFullOutput()` - Reads full data for `bdg details`
  - Atomic writes with tmp file + rename pattern

### Session Management (`src/session/`)
- **BdgSession.ts**: Encapsulates CDP session lifecycle
  - Connection management with retry and keepalive
  - Collector lifecycle management
  - Cleanup and graceful shutdown
  - Getter methods for live preview:
    - `getNetworkRequests()` - Returns collected network requests
    - `getConsoleLogs()` - Returns collected console messages
    - `getStartTime()` - Returns session start timestamp
    - `getActiveCollectors()` - Returns list of active collectors
    - `getTarget()` - Returns CDP target information

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

### Two-Tier Preview Pattern
- **Lightweight preview** (metadata only) enables fast monitoring without stopping collection
- **Full data** (with bodies) available on-demand for detailed inspection
- Preview written every 5 seconds using atomic writes (tmp file + rename)
- Reduces disk I/O from 87MB to 360KB for preview operations (241x reduction)
- Both files cleaned up automatically on session stop

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
- Two-tier preview system enables efficient monitoring:
  - Preview operations read only 360KB (lightweight metadata)
  - Details operations read 87MB (complete data with bodies)
  - Both files written atomically every 5 seconds during collection
  - All session files automatically cleaned up on stop
- Agent-optimized defaults for token efficiency:
  - Compact output format by default (67-72% token reduction vs verbose)
  - Default filtering excludes tracking/analytics and dev server noise (9-16% data reduction)
  - Use `--verbose` flag for human-readable output with full URLs and emojis
  - Use `--all` flag to disable filtering when complete data is needed

## Quick Command Reference

```bash
# Session Lifecycle
bdg localhost:3000              # Start collection (filtering enabled)
bdg localhost:3000 --all        # Start with all data (no filtering)
bdg status                      # Check if session is running
bdg stop                        # Stop and cleanup

# Monitoring (without stopping)
bdg peek                        # Quick preview, compact format (last 10 items)
bdg peek --verbose              # Verbose format (full URLs, emojis)
bdg peek --last 50              # Show more items
bdg peek --network              # Only network requests
bdg peek --console              # Only console messages
bdg peek --follow               # Live updates

# Detailed Inspection
bdg details network <id>        # Full request/response details
bdg details console <index>     # Full console message details

# Maintenance
bdg cleanup                     # Clean stale sessions
bdg cleanup --all               # Also remove session.json output file
```

## Troubleshooting

### Chrome Launch Failures

When Chrome fails to launch, bdg automatically displays diagnostic information including:
- Detected Chrome installations on your system
- Default Chrome binary path
- Actionable troubleshooting steps

**Common Issues**:

1. **No Chrome installations detected**
   ```bash
   # Install Chrome from https://www.google.com/chrome/
   ```

2. **Port already in use**
   ```bash
   # Use a different port
   bdg localhost:3000 --port 9223

   # Or use strict mode to fail fast
   bdg localhost:3000 --port-strict
   ```

3. **Permission denied**
   ```bash
   # Check Chrome binary permissions
   ls -l $(which google-chrome)  # Linux
   ls -l /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome  # macOS

   # Fix permissions if needed
   chmod +x /path/to/chrome/binary
   ```

4. **Connection timeout**
   ```bash
   # Increase retry attempts and polling interval
   bdg localhost:3000 \
     --max-connection-retries 100 \
     --connection-poll-interval 1000  # 1 second intervals
   ```

### Chrome Diagnostics

Check Chrome installation status:
```bash
# View Chrome diagnostics in status
bdg status --verbose
# Shows: Chrome binary path, number of installations found

# View detailed launch telemetry (in stderr during launch)
# Shows: Binary path, connection config, launch duration
```

### Stale Chrome Processes

If Chrome processes are left running after bdg crashes:
```bash
# Kill all Chrome processes (aggressive cleanup)
bdg cleanup --aggressive

# Manually check for Chrome processes
ps aux | grep -i chrome
```

### Session Lock Issues

If session lock is stuck after a crash:
```bash
# Force cleanup of stale session files
bdg cleanup --force

# Check for stale PID
bdg status

# Manual cleanup (last resort)
rm -rf ~/.bdg/session.*
```

## Enhanced Code Quality Rules

### Installation Requirements

To use the enhanced import path validation, install the ESLint plugin:
```bash
npm install --save-dev eslint-plugin-no-relative-import-paths
```

Then update `eslint.config.js` to include:
```javascript
import noRelativeImportPaths from 'eslint-plugin-no-relative-import-paths';

// Add to plugins:
'no-relative-import-paths': noRelativeImportPaths,

// Add to rules:
'no-relative-import-paths/no-relative-import-paths': [
  'error',
  { allowSameFolder: true, rootDir: 'src', prefix: '@' }
],
```

### TypeScript Compiler Enhancements

**`noUncheckedSideEffectImports` (TypeScript 5.6+)**:
This compiler option prevents accidental side-effect imports when using `--verbatimModuleSyntax`. It catches imports that might leave behind unintended side effects at runtime.

```typescript
// ❌ Could leave behind side-effect import
import { type A, type B } from 'module';
// Transpiles to: import 'module';

// ✅ Explicit type-only import
import type { A, B } from 'module';
// Transpiles to: (nothing - fully removed)
```

### ESLint Rule Enhancements

**Switch Exhaustiveness Check**:
The `@typescript-eslint/switch-exhaustiveness-check` rule ensures all switch statements handle every case in union types or enums, preventing runtime errors.

```typescript
type Status = 'pending' | 'completed' | 'failed';

function handleStatus(status: Status) {
  switch (status) {
    case 'pending':
      return 'In progress...';
    case 'completed':  
      return 'Done!';
    // ❌ Missing 'failed' case - ESLint will error
  }
}
```

**Import Path Consistency**:
Custom validation ensures all imports use absolute paths (`@/*`) instead of relative paths (`../`), improving refactoring safety and code consistency.

```typescript
// ❌ Relative import (harder to refactor)
import { CDPConnection } from '../connection/cdp.js';

// ✅ Absolute import (refactor-safe)
import { CDPConnection } from '@/connection/cdp.js';
```

### Validation Scripts

**Enhanced Check Command**:
```bash
npm run check:enhanced
```

This runs comprehensive validation including:
- Code formatting (Prettier)
- Type checking (TypeScript)
- Linting (ESLint)
- Import path validation
- Module type validation  
- TypeScript version validation

**Individual Validations**:
```bash
npm run lint:imports        # Check import path consistency
npm run validate:module-type # Ensure "type": "module" is set
npm run validate:ts-version  # Verify TypeScript 5.6+ compatibility
```

### Benefits

1. **Refactoring Safety**: Absolute imports don't break when moving files
2. **Runtime Safety**: Exhaustive switches prevent missing case errors  
3. **Import Safety**: Side-effect validation prevents accidental runtime imports
4. **Team Consistency**: Automated validation ensures consistent practices
5. **Modern Standards**: Uses cutting-edge TypeScript and ESLint features

