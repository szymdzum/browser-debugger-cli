# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Available Helpers

Use these helpers in CLI commands. All follow KISS, DRY, YAGNI principles with TSDoc comments.

### Command Helpers (`src/cli/handlers/`)
- **CommandRunner** - Wraps handlers with error handling, JSON/human output, exit codes
  - `runCommand<TOptions, TResult>(handler, options, formatter?)`
  - Eliminates try-catch, process.exit, daemon error detection
- **commonOptions** - Shared Commander.js Option definitions
  - `jsonOption` - Standard `--json` flag
  - `lastOption` - Pagination `--last <n>` with validation (0-10000)
  - `filterOption(types)` - Factory for `--filter <type>` with .choices()

### IPC Helpers (`src/ipc/`)
- **responseValidator** - Type-safe IPC/CDP response validation
  - `validateIPCResponse<T>(response)` - Throws on error, narrows type
- **client** - IPC client functions for daemon communication
  - All CLI commands use IPC to communicate with the background worker

### Usage Example
```typescript
import { runCommand } from '@/cli/handlers/CommandRunner.js';
import { jsonOption } from '@/cli/handlers/commonOptions.js';
import { validateIPCResponse } from '@/ipc/responseValidator.js';

.addOption(jsonOption)
.action(async (options) => {
  await runCommand(async (opts) => {
    const response = await callIPCCommand('method', params);
    validateIPCResponse(response);
    return { success: true, data: response.data };
  }, options, humanFormatter);
});
```

See `src/cli/commands/network.ts` for complete example.

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

1. **CLI Commands** (`src/cli/commands/*.ts`)
   - User-facing command handlers
   - Send requests via IPC client to daemon
   - Format and display responses

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

### Type Definitions (`src/types.ts`)
- `CDPMessage`, `CDPTarget`: CDP protocol types
- `CDPNetworkRequestParams`, `CDPNetworkResponseParams`, etc.: Typed CDP event parameters
- `NetworkRequest`, `ConsoleMessage`, `DOMData`: Collected data types
- `BdgOutput`: Final JSON output structure
- `CollectorType`: 'dom' | 'network' | 'console'
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

**Collect specific data**:
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

Follow the bidirectional IPC pattern documented in `docs/BIDIRECTIONAL_IPC.md`:

1. Define worker IPC types (`src/daemon/workerIpc.ts`)
2. Define client IPC types (`src/ipc/types.ts`)
3. Implement worker handler (`src/daemon/worker.ts`)
4. Implement daemon forwarding (`src/daemon/ipcServer.ts`)
5. Implement IPC client helper (`src/ipc/client.ts`)
6. Use in CLI command (`src/cli/commands/*.ts`)

See existing DOM commands for complete examples.

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
- IPC architecture eliminates intermediate file writes during collection
- Agent-optimized defaults for token efficiency:
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
