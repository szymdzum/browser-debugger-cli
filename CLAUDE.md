# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git Commit Guidelines

**IMPORTANT**: Do NOT include Claude Code attribution in commit messages.

- ❌ **BAD**: Adding "🤖 Generated with [Claude Code]" or "Co-Authored-By: Claude" footers
- ✅ **GOOD**: Clean, professional commit messages without AI tool attribution

Rationale: Commits should focus on the technical changes, not the tools used to create them. Git history is for code changes, not tool credits.

## Project Overview

**bdg** is a CLI tool for collecting browser telemetry (DOM, network, console) via Chrome DevTools Protocol (CDP). It uses a daemon + IPC architecture where a background worker process maintains a persistent CDP connection, and CLI commands communicate via Unix domain sockets.

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

**MANDATORY**: All code must follow KISS, DRY, and YAGNI principles with TSDoc comments.

### Core Principles
- **KISS** (Keep It Simple, Stupid) - Simplicity over cleverness
- **DRY** (Don't Repeat Yourself) - Extract helpers for repeated patterns
- **YAGNI** (You Aren't Gonna Need It) - Build only what's needed now
- **TSDoc** - All functions, parameters, and return values must have TSDoc comments

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

### TSDoc Syntax Rules

**MANDATORY**: TSDoc comments require proper syntax to avoid parser warnings. These violations happen often and must be prevented.

**Common Violations** (based on analysis of 66 TSDoc warnings in this codebase):

1. **Curly Braces in @throws Tags** (Most common - 54 violations):
```typescript
// ❌ BAD - Don't use curly braces
/**
 * @throws {Error} When operation fails
 * @throws {never} This function always exits
 */

// ✅ GOOD - No curly braces, just the type name
/**
 * @throws Error When operation fails
 * @throws never This function always exits
 */
```

2. **Code with Curly Braces in @example** (12 violations):
```typescript
// ❌ BAD - Code not in code fence
/**
 * @example
 * buildOptions('.error', 123)  // → { nodeId: 123 }
 */

// ✅ GOOD - Wrap example code in code fences
/**
 * @example
 * ```typescript
 * buildOptions('.error', 123)  // → { nodeId: 123 }
 * ```
 */
```

3. **HTML/Angle Brackets in Descriptions**:
```typescript
// ❌ BAD - Angle brackets in description
/**
 * Handle <selector|index> command
 */

// ✅ GOOD - Remove or rephrase to avoid angle brackets
/**
 * Handle selector or index command
 */
```

**Why These Rules Exist**:
- TSDoc parser interprets `{...}` as inline tags like `{@link}` or `{@inheritDoc}`
- TSDoc parser interprets `<...>` as HTML/XML tags
- Code fences (triple backticks) tell TSDoc to ignore special characters in code examples

**Correct TSDoc Patterns**:
```typescript
/**
 * Brief description
 *
 * Longer description with details.
 *
 * @param name - Parameter description
 * @param options - Options object description
 * @returns Description of return value
 * @throws Error Description of when error is thrown (NO curly braces)
 *
 * @example
 * ```typescript
 * // Example code here - curly braces are safe in code fences
 * const result = myFunction({ foo: 'bar' });
 * ```
 */
```

**Bulk Fixes**:
```bash
# Remove curly braces from @throws tags
sed -i '' 's/@throws \\{Error\\}/@throws Error/g' file.ts
sed -i '' 's/@throws \\{never\\}/@throws never/g' file.ts
```

**Prevention**:
- Use code fences (triple backticks) for all @example blocks containing code
- Never use curly braces in @throws tags - just write the type name
- Avoid angle brackets in descriptions - rephrase or use code formatting
- Run `npm run lint` before committing (catches TSDoc warnings via eslint-plugin-tsdoc)
- CI enforces zero TSDoc warnings (see `.github/workflows/ci.yml`)

**Validation**:
```bash
npm run lint              # Shows TSDoc warnings
npm run build             # TypeScript compiler also reports TSDoc issues
```

**Reference**: [TSDoc Specification](https://tsdoc.org/) for full syntax rules.

## UI & Error Handling Patterns

### OutputFormatter (`src/ui/formatting.ts`)
Fluent builder for formatted console output:
```typescript
const fmt = new OutputFormatter();
return fmt
  .text('Session Status')
  .separator('━', 50)
  .keyValueList([['Status', 'ACTIVE'], ['Port', '9222']], 18)
  .blank()
  .section('Commands:', ['Stop: bdg stop', 'Peek: bdg peek'])
  .build();
```

**Methods:**
- `.text(content)` - Add line
- `.blank()` - Add empty line
- `.separator(char, width)` - Add horizontal rule
- `.keyValue(key, value, keyWidth?)` - Aligned key-value pair
- `.keyValueList(pairs, keyWidth?)` - Multiple aligned pairs
- `.list(items, indent)` - Indented list
- `.section(title, items, indent)` - Title with indented list
- `.indent(content, spaces)` - Indent multiline text
- `.build()` - Return formatted string

### CommandError (`src/ui/errors.ts`)
Structured error with metadata and exit codes:
```typescript
throw new CommandError(
  'Session not found',
  { suggestion: 'Start a session with: bdg <url>' },
  EXIT_CODES.RESOURCE_NOT_FOUND
);
```

CommandRunner automatically handles:
- **JSON mode**: Includes metadata as separate fields
- **Human mode**: Shows error + metadata as help text
- **Exit codes**: Uses error's exitCode instead of generic 1

### CommandRunner (`src/commands/shared/CommandRunner.ts`)
Wraps command logic with error handling:
```typescript
await runCommand(
  async () => {
    const response = await getStatus();
    if (response.status === 'error') {
      return { success: false, error: response.error };
    }
    return { success: true, data: response.data };
  },
  options,
  formatStatus  // Human-readable formatter
);
```

**Features:**
- Handles CommandError with metadata
- Daemon connection error detection
- JSON/human output formatting
- Automatic exit codes

### Common Options (`src/commands/shared/commonOptions.ts`)
Reusable Commander.js options:
```typescript
import { jsonOption, lastOption, filterOption } from '@/commands/shared/commonOptions.js';

program
  .command('peek')
  .addOption(jsonOption)           // Standard --json flag
  .addOption(lastOption)           // --last <n> with validation (0-10000)
  .addOption(filterOption(['log', 'error']))  // --filter with choices
```

### Message Centralization (`src/ui/messages/`)
All user-facing strings centralized in message functions:
```typescript
// ❌ Inline strings
console.error('Daemon not running');

// ✅ Centralized messages
import { daemonNotRunningError } from '@/ui/messages/errors.js';
console.error(daemonNotRunningError());
```

**Main Categories:**
- `errors.ts` - Error messages (daemon, session, generic errors)
- `commands.ts` - Command-specific messages (cleanup, validation)
- `chrome.ts` - Chrome launch/cleanup messages
- `preview.ts` - Preview/peek messages
- `consoleMessages.ts` - Console command messages
- `session.ts` - Session-related messages
- `validation.ts` - Input validation messages
- `debug.ts`, `internal.ts` - Internal/debug messages

## Architecture

### IPC Daemon Architecture

bdg uses a **daemon + IPC architecture** for persistent CDP connections and efficient command execution:

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│             │  Unix   │                  │  stdin  │                 │
│ CLI Command │ Socket  │  Daemon (IPC     │ ───────>│  Worker Process │
│             │ ──────> │   Server)        │         │  (CDP Handler)  │
│             │         │                  │<─────── │                 │
└─────────────┘         └──────────────────┘  stdout └─────────────────┘
                                 │                            │
                                 │                            │
                                 └────────────────────────────┘
                            Request/Response Matching
                                (via requestId)
```

**Components**:

1. **CLI Commands** (`src/commands/*.ts`)
   - User-facing command handlers
   - Use CommandRunner for error handling
   - Send requests via IPC client to daemon
   - Format output with OutputFormatter

2. **IPC Client** (`src/ipc/client.ts`)
   - Connects to daemon via Unix socket (`~/.bdg/daemon.sock`)
   - Sends JSONL requests
   - Waits for JSONL responses
   - Handles timeouts and errors

3. **Daemon IPC Server** (`src/daemon/ipcServer.ts`)
   - Listens on Unix socket for client connections
   - Tracks active worker process
   - Routes requests to worker via stdin
   - Routes responses back to clients via socket
   - Matches requests/responses by `requestId`

4. **Worker Process** (`src/daemon/worker.ts`)
   - Maintains persistent CDP connection
   - Listens on stdin for daemon commands
   - Executes CDP operations
   - Sends responses to stdout

**Benefits**:
- ✅ Faster commands (no connection overhead)
- ✅ Persistent state (DOM cache, session data)
- ✅ Reliable index-based references
- ✅ Concurrent command execution

**Related Documentation**: See `docs/BIDIRECTIONAL_IPC.md` for detailed pattern and examples.

### Entry Point (`src/index.ts`)
- CLI definition using Commander.js
- Daemon launcher integration
- Command registration

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

### Telemetry Modules (`src/telemetry/`)
Each collector is independent and enables its CDP domain:
- **dom.ts**: Captures DOM snapshot on shutdown via `DOM.getDocument` + `DOM.getOuterHTML`
- **network.ts**: Tracks HTTP requests/responses
  - Listens for `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFinished`
  - Stores request/response pairs with headers and bodies (JSON/text only)
  - MAX_REQUESTS limit (10,000) to prevent memory issues
  - Default filtering excludes 13 tracking/analytics domains (configurable via `--all` flag)
- **console.ts**: Captures console logs and exceptions via `Runtime.consoleAPICalled` and `Log.entryAdded`
  - Default filtering excludes 4 dev server noise patterns (configurable via `--all` flag)

### Daemon & IPC (`src/daemon/`, `src/ipc/`)
- **launcher.ts**: Spawns worker process, manages daemon lifecycle
- **ipcServer.ts**: Unix socket server for CLI → daemon communication
- **worker.ts**: Handles CDP commands, responds via stdout
- **workerIpc.ts**: Worker-side IPC message types
- **client.ts**: IPC client for CLI commands
- **types.ts**: IPC protocol types

### Session Management (`src/session/`)
- **metadata.ts**: Session metadata read/write
- **pid.ts**: Process ID tracking
- **paths.ts**: Session file path management

### UI Layer (`src/ui/`)
- **formatting.ts**: OutputFormatter class + utility functions (separator, truncate, etc.)
- **errors.ts**: CommandError class for structured error handling
- **messages/**: Centralized user-facing strings
  - `errors.ts` - Error messages
  - `commands.ts` - Command-specific messages  
  - `chrome.ts` - Chrome launch/cleanup messages
  - `preview.ts` - Preview/peek messages
  - `consoleMessages.ts`, `session.ts`, `validation.ts`, etc.
- **formatters/**: Output formatters for commands
  - `status.ts`, `preview.ts`, `cookies.ts`, `details.ts`, `dom.ts`

### Utilities (`src/utils/`)
- **url.ts**: URL normalization (`normalizeUrl`, `truncateUrl`)
- **validation.ts**: Input validation
- **filters.ts**: Default exclusion patterns
- **exitCodes.ts**: Exit code constants

### Type Definitions (`src/types.ts`)
- `CDPMessage`, `CDPTarget`: CDP protocol types
- `CDPNetworkRequestParams`, `CDPNetworkResponseParams`, etc.: Typed CDP event parameters
- `NetworkRequest`, `ConsoleMessage`, `DOMData`: Collected data types
- `BdgOutput`: Final JSON output structure
- `TelemetryType`: 'dom' | 'network' | 'console'
- `CleanupFunction`: Type for collector cleanup handlers

## Common Commands

### Session Lifecycle

**Start a session** (daemon mode is default):
```bash
bdg localhost:3000
# Launches daemon in background
# Returns immediately after handshake
```

**Check session status**:
```bash
bdg status                      # Basic status information
bdg status --verbose            # Include Chrome diagnostics
bdg status --json               # JSON output
```

**Stop the session**:
```bash
bdg stop
# Sends stop command via IPC
# Daemon shuts down gracefully
# Final output written to ~/.bdg/session.json
```

### Live Monitoring

**Preview collected data** (without stopping):
```bash
bdg peek                        # Last 10 items (compact format)
bdg peek --last 50              # Show last 50 items
bdg peek --network              # Show only network requests
bdg peek --console              # Show only console messages
bdg peek --follow               # Live updates every second
bdg peek --json                 # JSON output
bdg peek --verbose              # Verbose output (full URLs, emojis)
```

**Get full details** for specific items:
```bash
bdg details network <requestId>     # Full request/response with bodies
bdg details console <index>         # Full console message with args
```

### Maintenance

**Clean up stale sessions**:
```bash
bdg cleanup                     # Remove stale session files
bdg cleanup --force             # Force cleanup even if session appears active
bdg cleanup --aggressive        # Kill all Chrome processes
```

### Collection Options

**Note:** Currently, all three collectors (DOM, network, console) are always enabled by default.
DOM data is captured as a snapshot at session end, while network and console data stream continuously.

**Basic Options**:
```bash
bdg localhost:3000 --port 9223              # Custom CDP port
bdg localhost:3000 --timeout 30             # Auto-stop after timeout
bdg localhost:3000 --all                    # Include all data (disable filtering)
bdg localhost:3000 --user-data-dir ~/custom # Custom Chrome profile directory
```

**Performance Optimization**:
```bash
# Network Optimization (50-80% data reduction)
bdg localhost:3000 --fetch-all-bodies                          # Fetch all bodies (override auto-skip)
bdg localhost:3000 --fetch-bodies-include "*/api/*,*/graphql"  # Only fetch specific patterns
bdg localhost:3000 --fetch-bodies-exclude "*tracking*"         # Additional patterns to skip
bdg localhost:3000 --network-include "api.example.com"         # Only capture specific hosts
bdg localhost:3000 --network-exclude "*analytics*,*ads*"       # Exclude tracking domains

# Output Optimization (30% size reduction)
bdg localhost:3000 --compact                                    # Compact JSON (no indentation)
```

**Pattern Syntax**: Simple wildcards (* matches anything)
- `api.example.com` → matches all requests to that host
- `*/api/*` → matches any path containing /api/
- `*analytics*` → matches any hostname with "analytics"
- `*.png` → matches all PNG images

**Pattern Precedence**: Include always trumps exclude
```bash
--network-include "api.example.com" --network-exclude "*example.com"
# Result: api.example.com is captured despite exclude pattern
```

**Note:** Chrome 136+ requires `--user-data-dir` with a non-default directory. See CHROME_SETUP.md for details.

## Session Files

bdg stores session data in `~/.bdg/`:

- **daemon.pid** - Daemon process ID
- **daemon.sock** - Unix socket for IPC
- **session.meta.json** - Session metadata (Chrome PID, CDP port, target info)
- **session.json** - Final output (written on stop only)
- **chrome-profile/** - Chrome user data directory

**Key Behaviors**:
- **Only one session at a time**: Lock prevents concurrent sessions
- **Automatic cleanup**: All session files removed on stop
- **Stale session detection**: Automatically cleans up if PID is dead
- **No intermediate writes**: Data stays in memory until stop (IPC queries access live data)

## Output Format

JSON structure written to stdout on success:
```json
{
  "version": "0.2.0",
  "success": true,
  "timestamp": "2025-11-06T12:00:00.000Z",
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
  "version": "0.2.0",
  "success": false,
  "timestamp": "2025-11-06T12:00:00.000Z",
  "duration": 1234,
  "target": { "url": "", "title": "" },
  "data": {},
  "error": "Error message here"
}
```

## Key Design Patterns

### IPC-Based Data Access
- CLI commands query live data via IPC (no file reads during collection)
- Worker maintains persistent CDP connection and in-memory state
- Daemon routes requests/responses between CLI and worker
- Final output written to `session.json` only on stop

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

## Adding New Commands

### IPC-Based Commands (Standard Pattern)

For commands that query the worker:

1. **Define IPC types** (`src/ipc/types.ts`, `src/daemon/workerIpc.ts`)
2. **Implement worker handler** (`src/daemon/worker.ts`)
3. **Add daemon routing** (`src/daemon/ipcServer.ts`)
4. **Add IPC client function** (`src/ipc/client.ts`)
5. **Create command** (`src/commands/*.ts`):
   ```typescript
   await runCommand(
     async () => {
       const response = await ipcFunction(params);
       if (response.status === 'error') {
         return { success: false, error: response.error };
       }
       return { success: true, data: response.data };
     },
     options,
     formatFunction
   );
   ```

### Direct CDP Commands (Special Cases)

For commands needing direct CDP access (like `dom eval`):

1. **Create helpers** (`src/commands/*Helpers.ts`)
   - Use CommandError for validation failures
   - Keep CDP logic separate from command logic
2. **Use in command** with CommandRunner

See `src/commands/dom.ts` for examples of both patterns.

## Dependencies

### Production
- **commander** (^14.0.2): CLI framework with type-safe arguments
- **chrome-launcher** (^1.2.1): Cross-platform Chrome launcher
- **ws** (^8.18.0): WebSocket client for CDP connection

### Development
- **typescript** (^5.6.0): ES2022 target, strict mode, ES modules
- **@types/node** (^22.19.0), **@types/ws** (^8.5.10): Type definitions
- **tsx** (^4.19.0): TypeScript test runner
- **eslint** (^9.39.0): Linting with TSDoc validation

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

- **All imports use `.js` extensions** (Node.js ESM convention) even though source is `.ts`
- **Exit codes**: Semantic codes (0, 80-99, 100-119) - see Exit Codes section
- **Output streams**: Status messages → stderr, JSON output → stdout
- **Connection checks**: Prevent silent failures when tabs close
- **Response body fetching**: Intelligently fetches only JSON/text MIME types
- **IPC architecture**: No intermediate file writes during collection
- **Agent-optimized defaults**:
  - Compact output format by default (67-72% token reduction vs verbose)
  - Default filtering excludes tracking/analytics and dev server noise (9-16% data reduction)
  - Use `--verbose` flag for human-readable output with full URLs and emojis
  - Use `--all` flag to disable filtering when complete data is needed

## Quick Command Reference

```bash
# Session Lifecycle
bdg localhost:3000              # Start daemon (default mode)
bdg status                      # Check if session is running
bdg stop                        # Stop daemon and write output

# Live Monitoring
bdg peek                        # Quick preview (last 10 items, compact)
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

### Daemon Issues

**Check daemon status**:
```bash
bdg status --verbose
# Shows: Daemon PID, Worker PID, Chrome PID, target info
```

**Daemon not responding**:
```bash
# Kill stale daemon
bdg cleanup --force

# Check for stale processes
ps aux | grep -E "node.*daemon|node.*worker"

# Kill all Chrome processes
bdg cleanup --aggressive
```

**IPC connection failed**:
```bash
# Verify socket exists
ls -la ~/.bdg/daemon.sock

# Remove stale socket
rm ~/.bdg/daemon.sock
bdg cleanup
```

### Session Lock Issues

If session lock is stuck after a crash:
```bash
# Force cleanup of stale session files
bdg cleanup --force

# Check for stale PID
bdg status

# Manual cleanup (last resort)
rm -rf ~/.bdg/daemon.*
```

## Code Organization

### Import Paths
Use absolute imports with `@/` prefix:
```typescript
// ✅ Absolute import (refactor-safe)
import { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/ui/errors.js';

// ❌ Relative import (breaks on file moves)
import { CDPConnection } from '../connection/cdp.js';
```

### Exit Codes (`src/utils/exitCodes.ts`)
Use semantic exit codes for agent-friendly error handling:
```typescript
import { EXIT_CODES } from '@/utils/exitCodes.js';

throw new CommandError(
  'Resource not found',
  { suggestion: 'Try: bdg <url>' },
  EXIT_CODES.RESOURCE_NOT_FOUND  // Semantic code: 83
);
```

**Exit Code Ranges:**
- **0**: Success
- **1**: Generic failure (backward compatibility)
- **80-99**: User errors (invalid input, permissions, resource issues)
- **100-119**: Software errors (bugs, integration failures, timeouts)

**Common Exit Codes:**
- `SUCCESS` (0) - Command succeeded
- `GENERIC_FAILURE` (1) - Generic error
- `INVALID_URL` (80) - Invalid URL format
- `INVALID_ARGUMENTS` (81) - Invalid command arguments
- `PERMISSION_DENIED` (82) - Permission issues
- `RESOURCE_NOT_FOUND` (83) - Session/target not found
- `RESOURCE_ALREADY_EXISTS` (84) - Resource conflict
- `RESOURCE_BUSY` (85) - Resource in use
- `DAEMON_ALREADY_RUNNING` (86) - Session already active
- `CHROME_LAUNCH_FAILURE` (100) - Chrome launch failed
- `CDP_CONNECTION_FAILURE` (101) - CDP connection failed
- `CDP_TIMEOUT` (102) - CDP operation timeout
- `SESSION_FILE_ERROR` (103) - Session file issues
- `UNHANDLED_EXCEPTION` (104) - Unhandled error
- `SIGNAL_HANDLER_ERROR` (105) - Signal handling error

**Reference:** [Square's Semantic Exit Codes](https://developer.squareup.com/blog/command-line-observability-with-semantic-exit-codes/)
