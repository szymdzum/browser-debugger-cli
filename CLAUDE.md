# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Agent-Friendly Discovery (START HERE)

**bdg is self-documenting - use these FIRST:**

```bash
bdg --help --json                       # All commands, flags, exit codes
bdg cdp --list                          # All CDP domains
bdg cdp Network --list                  # Methods in a domain
bdg cdp Network.getCookies --describe   # Full method schema
bdg cdp --search cookie                 # Search methods
```

**Key Principle:** Discover capabilities programmatically before implementation.

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

**Convention:** `process.exit` and `console.error` belong at entrypoints only (`src/index.ts`, `CommandRunner`, signal handlers, daemon bootstrap). Below that layer, choose one of two structured styles:

- **Throw `CommandError`** — from deep helpers when the caller can't reasonably recover. `CommandRunner` catches and formats.
- **Return `{ success, error?, exitCode?, errorContext? }`** — from composable operations whose callers branch on failure (e.g., CLI command action handlers, `FetchResult`).

Never mix: a helper shouldn't log-and-exit when its surrounding function already returns a structured shape.

```typescript
import { CommandError } from '@/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

throw new CommandError(
  'Session not found',
  { suggestion: 'Start a session with: bdg <url>' },
  EXIT_CODES.RESOURCE_NOT_FOUND
);
```

### Message Centralization (`src/ui/messages/`)
All user-facing strings must use centralized functions - no inline strings.

### Error Messages with Suggestions (`src/errors/messages.ts`)
Common error patterns with recovery suggestions. Use existing functions or add new ones:
```typescript
// Existing: elementNotFoundError, sessionNotActiveError, daemonNotRunningError
const err = elementNotFoundError(selector);
throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.RESOURCE_NOT_FOUND);

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

// Selector-based failure (selector-specific suggestions)
const err = elementNotFoundError(selector);
throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.RESOURCE_NOT_FOUND);
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
CLI Command → Unix Socket → Daemon (= the session: Chrome + CDP connection)
```

### Key Modules
- `src/commands/` - CLI handlers using CommandRunner
- `src/connection/` - CDP WebSocket, Chrome launcher
- `src/daemon/` - IPC server, session controller, in-process session (`src/daemon/session/`)
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
# Session
bdg <url>                    # Start
bdg status                   # Check
bdg stop                     # End

# Inspection
bdg peek                     # Preview data
bdg network list             # Network requests
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

## Session Files

Location: `~/.bdg/` (override with `BDG_SESSION_DIR`)
- `daemon.sock` - Daemon socket; the **only** liveness signal (connectable = session running)
- `daemon.pid` - Informational; verified by command line before any signal
- `session.meta.json` - Session metadata
- `chrome.pid` - Launched Chrome, kept until Chrome is confirmed dead (crash recovery)
- `daemon.log` - Daemon output

The daemon hosts exactly one session and exits when it ends. Only `bdg <url>` spawns it.

---

## Troubleshooting

```bash
bdg status --verbose         # Diagnostics
bdg cleanup                  # Remove files left by a crashed session
bdg cleanup --force          # Kill a stuck session (daemon + its Chrome)
```
