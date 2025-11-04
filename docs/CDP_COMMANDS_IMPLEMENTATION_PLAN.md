# CDP Commands Implementation Plan

Implementation roadmap for live CDP query commands (`bdg network`, `bdg console`, `bdg dom`, `bdg cdp`).

---

## Vision

Enable live querying of browser state without stopping the session:

```bash
# Session running in background
bdg example.com

# Live queries (in another terminal)
bdg network getCookies              # Human-readable cookie list
bdg network getCookies --json       # JSON output for scripting
bdg dom query "document.title"      # Evaluate JS expression
bdg console --last 10               # Last 10 console messages
bdg cdp Network.getCookies --json   # Direct CDP passthrough
```

---

## Architecture Overview

### Three Command Patterns

1. **Direct CDP Call** - Forward CDP method to daemon
   - Example: `bdg cdp Network.getCookies`
   - CLI → IPC → Daemon → CDP → Response

2. **CDP with Parameters** - CLI args become CDP params
   - Example: `bdg dom query "document.title"`
   - CLI parses args → IPC → Daemon → CDP → Response

3. **Query Collected Data** - Read daemon's in-memory state
   - Example: `bdg console --last 10`
   - CLI → IPC → Daemon returns stored logs

### IPC Message Protocol

Extend existing IPC protocol with new message types:

```typescript
interface IPCMessage {
  type: 'start' | 'stop' | 'status' | 'peek' | 'details' | 'cdp-call' | 'query-data';
  data?: any;
}

// New message types
interface CDPCallMessage {
  type: 'cdp-call';
  data: {
    method: string;      // e.g., 'Network.getCookies'
    params?: object;     // CDP method parameters
  };
}

interface QueryDataMessage {
  type: 'query-data';
  data: {
    domain: 'network' | 'console' | 'dom';
    query: string;       // e.g., 'last' | 'filter' | 'all'
    params?: object;     // Query parameters
  };
}
```

---

## Phase 1: Foundation - `bdg cdp` (Direct CDP Passthrough)

**Goal**: Enable direct CDP method calls with JSON output.

### Commands
```bash
bdg cdp Network.getCookies
bdg cdp Runtime.evaluate --params '{"expression": "document.title"}'
bdg cdp Page.captureScreenshot --params '{"format": "png"}'
```

### Implementation

**1. CLI Command** (`src/index.ts`)
```typescript
program
  .command('cdp <method>')
  .description('Execute CDP method directly')
  .option('--params <json>', 'CDP method parameters (JSON)')
  .option('--json', 'Output as JSON (always true for cdp)', { default: true })
  .action(async (method: string, options) => {
    const params = options.params ? JSON.parse(options.params) : {};
    const response = await sendIPCMessage({
      type: 'cdp-call',
      data: { method, params }
    });
    console.log(JSON.stringify(response, null, 2));
  });
```

**2. Daemon Handler** (`src/daemon.ts`)
```typescript
async function handleCDPCall(message: CDPCallMessage): Promise<any> {
  const { method, params } = message.data;

  if (!activeSession) {
    throw new Error('No active session');
  }

  try {
    const result = await activeSession.cdp.send(method, params);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

**3. IPC Message Routing** (`src/services/ipc.ts`)
```typescript
export async function handleIPCMessage(message: IPCMessage): Promise<any> {
  switch (message.type) {
    case 'cdp-call':
      return handleCDPCall(message as CDPCallMessage);
    // ... existing cases
  }
}
```

### Testing
```bash
# Start session
bdg example.com

# Test CDP calls
bdg cdp Network.getCookies
bdg cdp Runtime.evaluate --params '{"expression": "window.location.href"}'
bdg cdp DOM.getDocument
```

### Success Criteria
- ✅ Can call any CDP method from CLI
- ✅ Parameters passed as JSON work correctly
- ✅ Response is valid JSON
- ✅ Error handling works (invalid method, no session, etc.)

---

## Phase 2: Network Commands - `bdg network getCookies`

**Goal**: High-level network commands with human-readable output.

### Commands
```bash
bdg network getCookies              # Pretty-printed cookie list
bdg network getCookies --json       # JSON output
bdg network getCookies --url <url>  # Cookies for specific URL
```

### Implementation

**1. CLI Command** (`src/index.ts`)
```typescript
const networkCmd = program
  .command('network')
  .description('Inspect network state');

networkCmd
  .command('getCookies')
  .description('List cookies')
  .option('--url <url>', 'Filter by URL')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const params = options.url ? { urls: [options.url] } : {};
    const response = await sendIPCMessage({
      type: 'cdp-call',
      data: { method: 'Network.getCookies', params }
    });

    if (options.json) {
      console.log(JSON.stringify(response.result.cookies, null, 2));
    } else {
      formatCookies(response.result.cookies);
    }
  });
```

**2. Formatter** (`src/formatters/network.ts`)
```typescript
export function formatCookies(cookies: any[]): void {
  console.log(`[bdg] Cookies (${cookies.length}):`);
  cookies.forEach((cookie) => {
    console.log(`  - name: ${cookie.name}`);
    console.log(`    value: ${cookie.value}`);
    console.log(`    domain: ${cookie.domain}`);
    console.log(`    path: ${cookie.path}`);
    console.log(`    expires: ${cookie.expires ? new Date(cookie.expires * 1000).toISOString() : 'Session'}`);
    console.log(`    httpOnly: ${cookie.httpOnly}`);
    console.log(`    secure: ${cookie.secure}`);
    console.log(`    sameSite: ${cookie.sameSite || 'None'}`);
    console.log();
  });
}
```

### Testing
```bash
bdg example.com
bdg network getCookies
bdg network getCookies --json
bdg network getCookies --url "https://example.com"
```

### Success Criteria
- ✅ Human-readable output matches README example
- ✅ JSON output is valid and complete
- ✅ URL filtering works
- ✅ Handles empty cookie list gracefully

---

## Phase 3: DOM/Runtime Commands - `bdg dom query`

**Goal**: Evaluate JavaScript expressions in the page context.

### Commands
```bash
bdg dom query "document.title"
bdg dom query "document.querySelectorAll('a').length"
bdg dom query "Array.from(document.links).map(l => l.href)"
bdg dom query "window.performance.timing.loadEventEnd - window.performance.timing.navigationStart"
```

### Implementation

**1. CLI Command** (`src/index.ts`)
```typescript
const domCmd = program
  .command('dom')
  .description('Inspect DOM state');

domCmd
  .command('query <expression>')
  .description('Evaluate JavaScript expression')
  .option('--json', 'Output as JSON')
  .action(async (expression: string, options) => {
    const response = await sendIPCMessage({
      type: 'cdp-call',
      data: {
        method: 'Runtime.evaluate',
        params: {
          expression,
          returnByValue: true,
          awaitPromise: true
        }
      }
    });

    if (response.result.exceptionDetails) {
      console.error('Error:', response.result.exceptionDetails.text);
      process.exit(1);
    }

    const value = response.result.result.value;
    if (options.json) {
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log(formatValue(value));
    }
  });
```

**2. Value Formatter** (`src/formatters/runtime.ts`)
```typescript
export function formatValue(value: any): string {
  if (typeof value === 'string') {
    return `'${value}'`;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}
```

### Testing
```bash
bdg example.com
bdg dom query "document.title"
bdg dom query "document.querySelectorAll('a').length"
bdg dom query "navigator.userAgent" --json
```

### Success Criteria
- ✅ Can evaluate simple expressions (strings, numbers)
- ✅ Can evaluate complex expressions (arrays, objects)
- ✅ Error handling for syntax errors
- ✅ Handles promises correctly (`awaitPromise: true`)

---

## Phase 4: Console Commands - `bdg console`

**Goal**: Query collected console logs without stopping the session.

### Commands
```bash
bdg console                    # All console messages
bdg console --last 10          # Last 10 messages
bdg console --filter error     # Only error messages
bdg console --filter warning   # Only warnings
bdg console --json             # JSON output
```

### Implementation

**1. CLI Command** (`src/index.ts`)
```typescript
program
  .command('console')
  .description('Query console logs')
  .option('--last <n>', 'Show last N messages', '10')
  .option('--filter <type>', 'Filter by type (log, error, warning, info)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const response = await sendIPCMessage({
      type: 'query-data',
      data: {
        domain: 'console',
        query: 'filter',
        params: {
          last: parseInt(options.last),
          type: options.filter
        }
      }
    });

    if (options.json) {
      console.log(JSON.stringify(response.data, null, 2));
    } else {
      formatConsoleLogs(response.data);
    }
  });
```

**2. Daemon Handler** (`src/daemon.ts`)
```typescript
function handleQueryData(message: QueryDataMessage): any {
  if (message.data.domain === 'console') {
    const { last, type } = message.data.params || {};
    let logs = [...activeSession.consoleLogs];

    if (type) {
      logs = logs.filter(log => log.type === type);
    }

    if (last) {
      logs = logs.slice(-last);
    }

    return { success: true, data: logs };
  }
}
```

**3. Formatter** (`src/formatters/console.ts`)
```typescript
export function formatConsoleLogs(logs: any[]): void {
  logs.forEach((log) => {
    const icon = getLogIcon(log.type);
    const timestamp = new Date(log.timestamp).toISOString();
    console.log(`${icon} [${timestamp}] ${log.text}`);

    if (log.args && log.args.length > 0) {
      log.args.forEach(arg => {
        console.log(`    ${JSON.stringify(arg)}`);
      });
    }
  });
}

function getLogIcon(type: string): string {
  const icons = {
    log: 'ℹ',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  return icons[type] || 'ℹ';
}
```

### Testing
```bash
bdg example.com
bdg console --last 5
bdg console --filter error
bdg console --json
```

### Success Criteria
- ✅ Shows collected console messages
- ✅ Filtering by type works
- ✅ Last N messages works
- ✅ Human-readable format is clear
- ✅ JSON output is complete

---

## Phase 5: Additional High-Level Commands

### Network Domain
```bash
bdg network requests              # List all network requests
bdg network requests --filter api # Filter by URL pattern
bdg network headers <requestId>   # Show request/response headers
bdg network body <requestId>      # Show request/response body
```

### DOM Domain
```bash
bdg dom snapshot                  # Full DOM snapshot
bdg dom search <selector>         # Find elements by selector
bdg dom attributes <nodeId>       # Get element attributes
```

### Performance Domain (new)
```bash
bdg performance metrics           # Navigation timing metrics
bdg performance memory            # Heap usage
```

---

## Implementation Order

1. **Phase 1: `bdg cdp`** - Foundation for all CDP calls (1-2 days)
2. **Phase 2: `bdg network getCookies`** - First high-level command (1 day)
3. **Phase 3: `bdg dom query`** - Runtime evaluation (1 day)
4. **Phase 4: `bdg console`** - Query collected data (1 day)
5. **Phase 5: Additional commands** - Expand based on user feedback (ongoing)

---

## Technical Considerations

### IPC Message Timeout
- CDP calls can take time (especially screenshots, large responses)
- Default IPC timeout: 5 seconds
- Consider adding `--timeout` option for long-running commands

### Session State
- Commands should gracefully handle "no active session" error
- Clear error messages: "No session running. Start one with: bdg <url>"

### Output Formatting
- All commands support `--json` for scripting
- Human-readable format optimized for terminal width (80-120 chars)
- Color output optional (check if stdout is TTY)

### Error Handling
- CDP errors (method not found, invalid params)
- Network errors (daemon unreachable)
- Session errors (Chrome crashed, tab closed)
- Validation errors (invalid JSON, wrong param types)

### Testing Strategy
- Unit tests for formatters
- Integration tests for IPC message handling
- E2E tests for CLI commands (start session → run command → verify output)

---

## Success Metrics

- ✅ All README examples work without modification
- ✅ CLI help is clear and comprehensive (`bdg --help`, `bdg network --help`)
- ✅ Error messages are actionable
- ✅ JSON output is parseable by `jq`
- ✅ Human-readable output is clear and concise
- ✅ Commands respond within 1 second (excluding CDP call time)

---

## Future Enhancements

- **Tab completion** - Bash/Zsh completion for commands and CDP methods
- **Interactive mode** - `bdg shell` for REPL-style debugging
- **CDP method discovery** - `bdg cdp --list` to show available methods
- **Parameter validation** - Validate CDP params before sending to daemon
- **Response caching** - Cache expensive CDP calls (e.g., DOM snapshots)
