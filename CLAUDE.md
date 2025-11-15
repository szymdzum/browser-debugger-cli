# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🤖 Agent-Friendly Discovery (START HERE!)

**bdg is self-documenting at TWO levels - use these FIRST before asking questions:**

### 1. CLI Tool Discovery (`--help --json`)
```bash
bdg --help --json              # Machine-readable tool structure
# Returns: All commands, flags, defaults, exit codes, descriptions
```

**Provides:**
- 10 commands with arguments and options
- All default values (no guessing needed)
- 13 exit codes with semantic meanings
- Complete option descriptions

### 2. CDP Protocol Discovery (53 domains, 300+ methods)
```bash
bdg cdp --list                          # List all 53 CDP domains
bdg cdp Network --list                  # List all 39 Network methods
bdg cdp Network.getCookies --describe   # Full schema with params/types/examples
bdg cdp --search cookie                 # Search for cookie-related methods (14 results)
```

**Provides:**
- Self-documenting CDP API (no external docs needed)
- Method parameters, types, return values
- Usage examples for every method
- Case-insensitive search (Network.getCookies = network.getcookies)

**Key Design Principle:** bdg is designed for agent autonomy. Discover capabilities programmatically before implementation.

---

## Quick Start Guide

**Essential patterns you'll use in every command:**

### 1. CommandRunner Pattern (`src/commands/shared/CommandRunner.ts`)
Wraps command logic with automatic error handling, JSON/human output, exit codes:
```typescript
import { runCommand } from '@/commands/shared/CommandRunner.js';

await runCommand(
  async () => {
    const response = await ipcFunction(params);
    if (response.status === 'error') {
      return { success: false, error: response.error };
    }
    return { success: true, data: response.data };
  },
  options,
  formatFunction  // Human-readable formatter (optional)
);
```

### 2. OutputFormatter (`src/ui/formatting.ts`)
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

### 3. Message Centralization (`src/ui/messages/`)
All user-facing strings must use centralized message functions:
```typescript
// ❌ Inline strings
console.error('Daemon not running');

// ✅ Centralized messages
import { daemonNotRunningError } from '@/ui/messages/errors.js';
console.error(daemonNotRunningError());
```

**Message modules:** `errors.ts`, `commands.ts`, `chrome.ts`, `preview.ts`, `validation.ts`, etc.

### 4. Error Handling (Domain-specific modules)
Structured errors with metadata and semantic exit codes, organized by domain:
```typescript
// CLI-level errors (user-facing commands)
import { CommandError } from '@/ui/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

throw new CommandError(
  'Session not found',
  { suggestion: 'Start a session with: bdg <url>' },
  EXIT_CODES.RESOURCE_NOT_FOUND
);

// Connection errors (CDP, Chrome, timeouts)
import { ChromeLaunchError, CDPConnectionError, getErrorMessage } from '@/connection/errors.js';

throw new ChromeLaunchError('Chrome binary not found', cause);
```

**Error modules by domain:**
- `ui/errors/CommandError.ts` - CLI-level user-facing errors
- `connection/errors.ts` - Connection layer (CDPConnectionError, ChromeLaunchError, CDPTimeoutError, getErrorMessage)
- `ui/errors/utils.ts` - Helper functions (isDaemonConnectionError)
- `ui/errors/index.ts` - Barrel export (re-exports connection errors for backward compatibility)

### 5. Logging (`src/ui/logging/`)
Consistent logging with context prefixes and debug mode support:
```typescript
import { createLogger } from '@/ui/logging/index.js';

const log = createLogger('daemon');

// Always shown (even without --debug)
log.info('Daemon started on port 9222');

// Only shown in debug mode (--debug or BDG_DEBUG=1)
log.debug('Processing IPC request from client');
```

**Logging modules:**
- `logger.ts` - Logger implementation (createLogger, enableDebugLogging, isDebugEnabled)
- `index.ts` - Barrel export for all logging utilities

### 6. Common Options (`src/commands/shared/commonOptions.ts`)
Reusable Commander.js options:
```typescript
import { jsonOption, lastOption, filterOption } from '@/commands/shared/commonOptions.js';

program
  .command('peek')
  .addOption(jsonOption)           // Standard --json flag
  .addOption(lastOption)           // --last <n> with validation
  .addOption(filterOption(['log', 'error']))  // --filter with choices
```

## Browser Automation with bdg

**When using bdg for browser automation tasks, use the `bdg` skill.**

The skill is located at `.claude/skills/bdg/SKILL.md` and provides:
- Quick start guide with common patterns
- Error handling with exit codes and retries
- Best practices for CDP usage
- Common tasks quick reference table
- Example scraper workflows

**Key principle**: Use raw `bdg cdp` commands instead of inventing wrappers. The CDP protocol is the interface.

**Example workflow**:
```bash
bdg https://example.com
bdg cdp Runtime.evaluate --params '{"expression": "document.title", "returnByValue": true}'
bdg stop
```

**Essential documentation**:
- `.claude/skills/bdg/SKILL.md` - Skill for agents (auto-loaded when needed)
- `.claude/skills/bdg/WORKFLOWS.md` - Comprehensive guide with 15+ recipes
- `.claude/skills/bdg/TROUBLESHOOTING.md` - Common issues and solutions
- `.claude/skills/bdg/EXIT_CODES.md` - Exit code reference for error handling
- `docs/CLI_REFERENCE.md` - Complete command reference (human-focused)

## Git Commit Guidelines

**IMPORTANT**: Do NOT include Claude Code attribution in commit messages.

- ❌ **BAD**: Adding "🤖 Generated with [Claude Code]" or "Co-Authored-By: Claude" footers
- ✅ **GOOD**: Clean, professional commit messages without AI tool attribution

Rationale: Commits should focus on the technical changes, not the tools used to create them.

**CRITICAL**: Never auto-commit changes. Always wait for user review.

- ❌ **BAD**: Committing changes immediately after implementing them
- ✅ **GOOD**: Implementing changes, showing diff, waiting for user to review and commit

Process:
1. Implement requested changes
2. Show `git diff` or `git status` to user
3. Wait for user approval before running `git commit`
4. User reviews, may request changes, then commits when ready

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

### TSDoc Syntax Rules (Critical Violations)

**MANDATORY**: Avoid these common TSDoc parser errors:

1. **No curly braces in @throws tags**:
```typescript
// ❌ BAD: @throws {Error} When operation fails
// ✅ GOOD: @throws Error When operation fails
```

2. **Wrap code in @example with code fences**:
```typescript
// ❌ BAD - Code not in fence
/**
 * @example
 * myFunc({ foo: 'bar' })
 */

// ✅ GOOD - Code wrapped in fence
/**
 * @example
 * (triple backticks)typescript
 * myFunc({ foo: 'bar' })
 * (triple backticks)
 */
```

3. **Avoid angle brackets in descriptions**:
```typescript
// ❌ BAD: Handle <selector|index> command
// ✅ GOOD: Handle selector or index command
```

**Validation:** `npm run lint` catches TSDoc warnings via eslint-plugin-tsdoc

### Inline Comments vs TSDoc

**Prefer TSDoc over inline comments.** Refactor complex logic into well-named helpers with TSDoc instead of adding inline comments.

```typescript
// ❌ BAD - Inline comment
function processData(items: Item[]) {
  // Filter valid items and extract IDs
  return items.filter(i => i.valid).map(i => i.id);
}

// ✅ GOOD - TSDoc on helper function
/** Extracts IDs from valid items. */
function getValidItemIds(items: Item[]): string[] {
  return items.filter(item => item.valid).map(item => item.id);
}
```

**Exceptions:** Inline comments acceptable for non-obvious regex, workarounds (with issue link), or complex algorithms.

## Architecture Overview

### IPC Daemon Architecture

```
CLI Command → Unix Socket → Daemon → stdin → Worker (CDP)
                              ↓         ↑
                            Routes responses
```

**Components:**
- **CLI Commands** (`src/commands/*.ts`) - User-facing handlers, use CommandRunner
- **IPC Client** (`src/ipc/client.ts`) - Connects to daemon via Unix socket
- **Daemon** (`src/daemon/ipcServer.ts`) - Routes requests/responses between CLI and worker
- **Worker** (`src/daemon/worker.ts`) - Maintains persistent CDP connection

**Benefits:** Faster commands, persistent state, reliable index-based references

**Detailed docs:** `docs/BIDIRECTIONAL_IPC.md`

### Key Modules

- **CDP Connection** (`src/connection/`) - WebSocket client, target discovery, Chrome launcher
  - `cdp.ts` - Core CDP WebSocket connection
  - `typed-cdp.ts` - **Type-safe CDP wrapper** with Protocol types (autocomplete for 300+ methods)
  - `handlers.ts` - Event handler registry with cleanup
- **Telemetry** (`src/telemetry/`) - DOM, network, console collectors (enable CDP domain → listen for events → accumulate data)
- **Session Management** (`src/session/`) - Metadata, PID tracking, file paths
- **UI Layer** (`src/ui/`) - Presentation layer for user-facing output
  - `errors/` - Error classes (CommandError, SystemErrors, utilities)
  - `logging/` - Logger with debug mode support
  - `messages/` - Centralized message functions
  - `formatters/` - Output formatters for different commands
  - `formatting.ts` - OutputFormatter builder
- **Utilities** (`src/utils/`) - Pure utility functions (URL normalization, validation, filters, exit codes)
- **CDP Protocol** (`src/cdp/`) - Protocol schema and introspection
  - `protocol.ts` - Protocol loader with case-insensitive lookup
  - `schema.ts` - Agent-friendly method schemas with examples
  - `types.ts` - Schema structure types

**Type Definitions:** 
- `src/types.ts` - Application types (NetworkRequest, ConsoleMessage, output structure)
- `devtools-protocol` package - Official CDP type definitions (Protocol namespace)
- See `docs/TYPE_SAFE_CDP.md` for type-safe CDP API documentation

## Code Organization

### Import Paths
Use absolute imports with `@/` prefix:
```typescript
// ✅ Absolute import (refactor-safe)
import { CDPConnection } from '@/connection/cdp.js';

// ❌ Relative import (breaks on file moves)
import { CDPConnection } from '../connection/cdp.js';
```

**Note:** All imports use `.js` extensions (Node.js ESM convention) even though source is `.ts`

### Exit Codes (`src/utils/exitCodes.ts`)
Use semantic exit codes for agent-friendly error handling:
```typescript
import { EXIT_CODES } from '@/utils/exitCodes.js';

throw new CommandError(
  'Resource not found',
  { suggestion: 'Try: bdg <url>' },
  EXIT_CODES.RESOURCE_NOT_FOUND  // 83
);
```

**Exit Code Ranges:**
- **0**: Success
- **1**: Generic failure
- **80-99**: User errors (invalid input, permissions, resource issues)
- **100-119**: Software errors (bugs, integration failures, timeouts)

**Common codes:** `SUCCESS` (0), `INVALID_URL` (80), `INVALID_ARGUMENTS` (81), `RESOURCE_NOT_FOUND` (83), `DAEMON_ALREADY_RUNNING` (86), `CHROME_LAUNCH_FAILURE` (100), `CDP_CONNECTION_FAILURE` (101), `CDP_TIMEOUT` (102)

**Reference:** [Square's Semantic Exit Codes](https://developer.squareup.com/blog/command-line-observability-with-semantic-exit-codes/)

## Adding New Commands

### IPC-Based Commands (Standard Pattern)

For commands that query the worker:

1. **Define IPC types** (`src/ipc/types.ts`, `src/daemon/workerIpc.ts`)
2. **Implement worker handler** (`src/daemon/worker.ts`)
3. **Add daemon routing** (`src/daemon/ipcServer.ts`)
4. **Add IPC client function** (`src/ipc/client.ts`)
5. **Create command** using CommandRunner pattern (see Quick Start Guide)

### Direct CDP Commands (Special Cases)

For commands needing direct CDP access (like `dom eval`):

1. **Create helpers** (`src/commands/*Helpers.ts`)
   - Use CommandError for validation failures
   - Keep CDP logic separate from command logic
2. **Use in command** with CommandRunner

**Examples:** See `src/commands/dom.ts` for both patterns

## Common Commands

### Session Lifecycle
```bash
bdg localhost:3000              # Start daemon
bdg status                      # Check status
bdg status --verbose            # Include Chrome diagnostics
bdg stop                        # Stop daemon and write output
```

### Live Monitoring
```bash
bdg peek                        # Preview (last 10 items, compact)
bdg peek --verbose              # Verbose format (full URLs, emojis)
bdg peek --last 50              # Show last 50 items
bdg peek --network              # Only network requests
bdg peek --console              # Only console messages
bdg peek --follow               # Live updates every second
bdg details network <id>        # Full request/response details
bdg details console <index>     # Full console message details
```

### Maintenance
```bash
bdg cleanup                     # Clean stale sessions
bdg cleanup --force             # Force cleanup even if active
bdg cleanup --aggressive        # Kill all Chrome processes
```

**For complete CLI reference:** See `docs/CLI_REFERENCE.md`

## Collection Options

**Note:** All three collectors (DOM, network, console) are always enabled by default. DOM captured as snapshot at session end, network/console stream continuously.

### Basic Options
```bash
bdg localhost:3000 --port 9223              # Custom CDP port
bdg localhost:3000 --timeout 30             # Auto-stop after timeout (seconds)
bdg localhost:3000 --all                    # Include all data (disable filtering)
bdg localhost:3000 --user-data-dir ~/custom # Custom Chrome profile directory
bdg localhost:3000 --max-body-size 10       # Max response body size in MB (default: 5)
bdg localhost:3000 --compact                # Compact JSON output (no indentation)
bdg localhost:3000 --headless               # Launch Chrome in headless mode
bdg localhost:3000 --chrome-ws-url ws://... # Connect to existing Chrome instance
```

**Output Optimization**: Use `--compact` for 30% size reduction (67-72% token reduction vs verbose)  
**Default Filtering**: Automatically excludes tracking/analytics and dev server noise (9-16% data reduction). Use `--all` to disable.

## Session Files

bdg stores session data in `~/.bdg/`:

- **daemon.pid** - Daemon process ID
- **daemon.sock** - Unix socket for IPC
- **session.meta.json** - Session metadata (Chrome PID, CDP port, target info)
- **session.json** - Final output (written on stop only)
- **chrome-profile/** - Chrome user data directory

**Key Behaviors:**
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

Error format includes `"success": false` and `"error": "Error message here"`

See `src/types.ts` for complete type definitions.

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
2. Register event handlers: cdp.on('Domain.eventName', handler)
3. Store handler IDs: handlers.push({ event, id })
4. Accumulate data in shared array passed by reference
5. Return cleanup function that removes handlers
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

## Troubleshooting

### Chrome Launch Failures

When Chrome fails to launch, bdg displays diagnostic information including detected Chrome installations, default binary path, and troubleshooting steps.

**Common Issues:**
1. **No Chrome installations detected** - Install from https://www.google.com/chrome/
2. **Port already in use** - Use `--port 9223` to specify a different port
3. **Permission denied** - Check Chrome binary permissions with `ls -l`
4. **Connection timeout** - Check Chrome is running and port is accessible

### Daemon Issues

```bash
bdg status --verbose            # Check daemon/worker/Chrome PIDs
bdg cleanup --force             # Kill stale daemon
bdg cleanup --aggressive        # Kill all Chrome processes
ps aux | grep -E "node.*daemon|node.*worker"  # Check for stale processes
```

### Session Lock Issues

```bash
bdg cleanup --force             # Force cleanup of stale session files
rm -rf ~/.bdg/daemon.*          # Manual cleanup (last resort)
```

## Important Notes

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

## Dependencies

See `package.json` for current versions. Key dependencies:
- **commander**: CLI framework
- **chrome-launcher**: Chrome launcher
- **ws**: WebSocket client for CDP
- **typescript**: ES2022, strict mode, ESM

## Enhanced Code Quality Rules

### TypeScript Compiler
**`noUncheckedSideEffectImports` (TypeScript 5.6+)**: Prevents accidental side-effect imports with `--verbatimModuleSyntax`. Use `import type` for type-only imports.

### ESLint Rules
- **Switch exhaustiveness** (`@typescript-eslint/switch-exhaustiveness-check`) - Ensures all switch cases handled
- **Import path consistency** (`no-relative-import-paths`) - Enforces absolute imports (`@/*`)

### Validation Scripts
```bash
npm run check:enhanced          # Full validation (formatting, types, linting, imports)
npm run lint:imports            # Check import path consistency
npm run validate:module-type    # Ensure "type": "module" is set
npm run validate:ts-version     # Verify TypeScript 5.6+ compatibility
```

## Distribution

This package is designed for npm distribution:
```bash
npm publish  # Publishes to npm registry
```

The `.npmignore` file ensures only `dist/` and `README.md` are published, keeping the package small.
