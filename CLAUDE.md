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
```
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

# CDP
bdg cdp Runtime.evaluate --params '{"expression":"document.title"}'
```

See `docs/CLI_REFERENCE.md` for complete reference.

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
