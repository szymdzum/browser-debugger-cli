# CDP Method Exposure Design

## Overview

This document outlines how to expose Chrome DevTools Protocol (CDP) methods as CLI commands, giving power users direct access to the full protocol while maintaining our collector-centric UX and agent-friendly design.

---

## CDP Protocol Structure

### Organization
- **60+ domains**: Network, DOM, Runtime, Console, Performance, etc.
- **Methods**: Format `Domain.methodName` (e.g., `Network.enable`, `Runtime.evaluate`)
- **Parameters**: JSON objects with typed fields
- **Returns**: JSON objects with typed results
- **Events**: Domains emit events that clients subscribe to

### Available Resources
- **NPM Package**: `devtools-protocol` (v0.0.1538951) - TypeScript types and JSON schemas
- **Live Protocol**: `http://localhost:9222/json/protocol` - Full protocol spec when Chrome running
- **Documentation**: https://chromedevtools.github.io/devtools-protocol/

### Example Method Structure
```typescript
// Network.getCookies
{
  "name": "getCookies",
  "description": "Returns all browser cookies",
  "parameters": [
    {
      "name": "urls",
      "type": "array",
      "items": { "type": "string" },
      "optional": true,
      "description": "Filter cookies by URLs"
    }
  ],
  "returns": [
    {
      "name": "cookies",
      "type": "array",
      "items": { "$ref": "Cookie" }
    }
  ]
}
```

---

## Current Implementation

### CDPConnection.send()
We already have a generic CDP command sender:

```typescript
// src/connection/cdp.ts
async send(
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string
): Promise<unknown>
```

**Usage:**
```typescript
const cdp = new CDPConnection();
await cdp.connect(wsUrl);

// Execute any CDP method
const result = await cdp.send('Runtime.evaluate', {
  expression: 'document.title',
  returnByValue: true
});

const cookies = await cdp.send('Network.getCookies', {
  urls: ['https://example.com']
});
```

### Example: query Command
The `bdg query` command shows the pattern:

```typescript
// src/cli/commands/query.ts
const cdp = new CDPConnection();
await cdp.connect(metadata.webSocketDebuggerUrl);

const result = await cdp.send('Runtime.evaluate', {
  expression: script,
  returnByValue: true,
  awaitPromise: true,
});
```

---

## Design Options

### Option 1: Generic `bdg cdp` Command (Recommended)
**Direct access to any CDP method with automatic parameter parsing.**

```bash
# Basic usage
bdg cdp <Domain.method> [params...]

# Examples
bdg cdp Network.enable
bdg cdp Network.getCookies
bdg cdp Network.getCookies --urls='["https://example.com"]'
bdg cdp Runtime.evaluate --expression="document.title" --returnByValue=true
bdg cdp Page.captureScreenshot --format=png --json

# With JSON output
bdg cdp Network.getAllCookies --json
```

**Implementation:**
```typescript
// src/cli/commands/cdp.ts
export function registerCdpCommand(program: Command): void {
  program
    .command('cdp')
    .description('Execute raw CDP methods (advanced)')
    .argument('<method>', 'CDP method (e.g., Network.getCookies)')
    .option('--json', 'Output as JSON')
    .allowUnknownOption()  // Accept any --param flags
    .action(async (method: string, options: Record<string, unknown>) => {
      // 1. Validate method format (Domain.method)
      if (!method.includes('.')) {
        console.error('Invalid CDP method format. Use: Domain.method');
        process.exit(85);
      }

      // 2. Parse parameters from --flags
      const params = parseCdpParams(options);

      // 3. Connect to active session
      const cdp = await connectToActiveSession();

      // 4. Execute CDP method
      const result = await cdp.send(method, params);

      // 5. Output result
      if (options.json) {
        console.log(JSON.stringify({
          version: VERSION,
          method,
          params,
          result
        }));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    });
}

function parseCdpParams(options: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(options)) {
    if (key === 'json') continue;  // Skip our own flag

    // Try to parse JSON strings
    if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
      try {
        params[key] = JSON.parse(value);
      } catch {
        params[key] = value;
      }
    } else {
      params[key] = value;
    }
  }

  return params;
}
```

**Advantages:**
- ✅ Simple, powerful, flexible
- ✅ No need to manually add each method
- ✅ Works with future CDP additions automatically
- ✅ Agent-friendly (structured input/output)

**Disadvantages:**
- ❌ No autocomplete for method names
- ❌ No parameter validation (fails at runtime)
- ❌ Requires knowledge of CDP protocol

---

### Option 2: Domain-Specific Subcommands
**Integrate CDP methods into our collector commands.**

```bash
# Network domain
bdg network enable
bdg network disable
bdg network getCookies --urls='["https://example.com"]'
bdg network setCookie --name=foo --value=bar

# Runtime domain
bdg runtime evaluate --expression="document.title"
bdg runtime callFunctionOn --objectId=obj123 --functionDeclaration="function(){return this.value}"

# DOM domain
bdg dom getDocument
bdg dom querySelector --selector=".error"
bdg dom getOuterHTML --nodeId=123
```

**Implementation:**
```typescript
// src/cli/collectors/network.ts
export function makeNetworkCommand(): Command {
  const network = new Command('network');

  // High-level commands (existing)
  network.command('peek').action(handleNetworkPeek);
  network.command('errors').action(handleNetworkErrors);

  // Raw CDP methods (new)
  network
    .command('enable')
    .description('Enable network tracking (CDP: Network.enable)')
    .action(async () => {
      const cdp = await connectToActiveSession();
      await cdp.send('Network.enable');
      console.log('Network tracking enabled');
    });

  network
    .command('getCookies')
    .description('Get browser cookies (CDP: Network.getCookies)')
    .option('--urls <json>', 'Filter by URLs (JSON array)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const cdp = await connectToActiveSession();
      const params = options.urls ? { urls: JSON.parse(options.urls) } : {};
      const result = await cdp.send('Network.getCookies', params);

      if (options.json) {
        console.log(JSON.stringify(result));
      } else {
        // Format cookies for human readability
        const cookies = (result as any).cookies;
        console.log(`Found ${cookies.length} cookies`);
        cookies.forEach((c: any) => {
          console.log(`  ${c.name}=${c.value} (domain: ${c.domain})`);
        });
      }
    });

  return network;
}
```

**Advantages:**
- ✅ Discoverable (show up in help menus)
- ✅ Can add custom formatting for human output
- ✅ Type-safe parameter validation
- ✅ Fits naturally into collector-centric UX

**Disadvantages:**
- ❌ Requires manually adding each method
- ❌ High maintenance burden (CDP updates)
- ❌ Limits flexibility (only expose useful methods)

---

### Option 3: Hybrid Approach (Recommended for Production)
**Combine both: curated methods + raw CDP access.**

```bash
# Curated high-level commands (friendly)
bdg network peek
bdg network errors
bdg console warnings

# Curated CDP methods (common use cases)
bdg network getCookies
bdg runtime evaluate

# Raw CDP access (power users)
bdg cdp Network.setCacheDisabled --cacheDisabled=true
bdg cdp Performance.getMetrics
bdg cdp Emulation.setDeviceMetricsOverride --mobile=true --width=375 --height=812
```

**Structure:**
```
src/cli/
├── collectors/
│   ├── network.ts       # High-level + curated CDP methods
│   ├── dom.ts
│   └── console.ts
├── commands/
│   ├── cdp.ts           # Raw CDP command (advanced users)
│   ├── start.ts
│   └── status.ts
```

**Advantages:**
- ✅ Best of both worlds
- ✅ Progressive disclosure (simple → advanced)
- ✅ Safety net for uncovered use cases
- ✅ Extensible without code changes (raw CDP)

---

## Integration with Collector-Centric UX

### Network Collector Enhancement

```bash
$ bdg network

Network Inspector:
  # High-level commands (existing)
  bdg network peek        Show recent requests
  bdg network errors      Show failed requests
  bdg network slow        Show slow requests
  bdg network filter      Filter by URL pattern

  # CDP methods (new - curated)
  bdg network getCookies  Get all browser cookies
  bdg network setCookie   Set a cookie
  bdg network clearCache  Clear browser cache
  bdg network emulate     Emulate network conditions

Advanced:
  Use 'bdg cdp Network.<method>' for full CDP access

Examples:
  bdg network getCookies --json
  bdg cdp Network.setCacheDisabled --cacheDisabled=true
```

### DOM Collector Enhancement

```bash
$ bdg dom

DOM Inspector:
  # High-level commands (existing)
  bdg dom peek            Show DOM snapshot preview
  bdg dom query <sel>     Query by CSS selector
  bdg dom save <file>     Save DOM to file

  # CDP methods (new - curated)
  bdg dom getDocument     Get full DOM tree
  bdg dom highlight       Highlight elements in browser
  bdg dom scrollIntoView  Scroll element into view

Advanced:
  Use 'bdg cdp DOM.<method>' for full CDP access

Examples:
  bdg dom highlight --nodeId=123
  bdg cdp DOM.requestNode --objectId=obj456
```

---

## Agent-Friendly Design

### 1. Structured Input
```bash
# Parameters as JSON strings (parseable by agents)
bdg cdp Network.setCookie --name=test --value=123 --domain=example.com

# Complex parameters as JSON
bdg cdp Emulation.setDeviceMetricsOverride \
  --mobile=true \
  --width=375 \
  --height=812 \
  --deviceScaleFactor=2
```

### 2. Structured Output
```bash
# Default: Pretty JSON (human-readable)
$ bdg cdp Network.getCookies
{
  "cookies": [
    {
      "name": "session",
      "value": "abc123",
      "domain": "example.com"
    }
  ]
}

# With --json: Versioned wrapper (agent-friendly)
$ bdg cdp Network.getCookies --json
{
  "version": "0.0.1-alpha.0",
  "command": "cdp",
  "method": "Network.getCookies",
  "params": {},
  "result": {
    "cookies": [...]
  },
  "timestamp": "2025-11-04T12:00:00.000Z"
}
```

### 3. Semantic Exit Codes
```typescript
// Exit codes for CDP errors
const EXIT_CODES = {
  SUCCESS: 0,
  NO_SESSION: 90,           // No active session
  INVALID_METHOD: 85,       // Invalid CDP method format
  METHOD_NOT_FOUND: 92,     // CDP method doesn't exist
  INVALID_PARAMS: 85,       // Invalid parameters
  CDP_ERROR: 106,           // CDP protocol error
  UNHANDLED_EXCEPTION: 110, // Unexpected error
};
```

### 4. Error Messages with Suggestions
```bash
$ bdg cdp Network.invalidMethod
Error: CDP method not found: Network.invalidMethod

Suggestions:
  - Check method name: https://chromedevtools.github.io/devtools-protocol/tot/Network/
  - List available Network methods: bdg cdp --list Network
  - Use autocomplete: bdg network <tab>

Exit code: 92 (METHOD_NOT_FOUND)
```

---

## Implementation Plan

### Phase 1: Raw CDP Command (MVP)
**Goal**: Enable power users to call any CDP method

1. Create `src/cli/commands/cdp.ts`:
   - `bdg cdp <Domain.method>` command
   - Parameter parsing from CLI flags
   - JSON output support
   - Connect to active session

2. Add helper utilities:
   - `connectToActiveSession()` - Reusable session connection
   - `parseCdpParams()` - Parse CLI flags to CDP params
   - `validateCdpMethod()` - Check Domain.method format

3. Error handling:
   - Validate method format
   - Check for active session
   - Handle CDP errors gracefully

**Commands:**
```bash
bdg cdp Network.getCookies
bdg cdp Runtime.evaluate --expression="1+1"
bdg cdp Page.captureScreenshot --json
```

### Phase 2: Curated CDP Methods
**Goal**: Add common CDP methods to collector commands

1. Network collector:
   - `bdg network getCookies`
   - `bdg network clearCache`
   - `bdg network emulate` (network conditions)

2. DOM collector:
   - `bdg dom getDocument`
   - `bdg dom highlight` (visual debugging)
   - `bdg dom scrollIntoView`

3. Runtime collector (new):
   - `bdg runtime eval <expression>` (alias for Runtime.evaluate)
   - `bdg runtime heap` (heap snapshot)

**Features:**
- Human-readable output formatting
- Sensible parameter defaults
- Helpful error messages

### Phase 3: CDP Introspection
**Goal**: Help users discover available methods

1. Protocol schema loading:
   - Fetch from `http://localhost:9222/json/protocol`
   - Or bundle `devtools-protocol` package schemas

2. Discovery commands:
   - `bdg cdp --list` - List all domains
   - `bdg cdp --list Network` - List Network methods
   - `bdg cdp --help Network.getCookies` - Show method signature

3. Interactive help:
   ```bash
   $ bdg cdp --list Network
   Network domain methods:
     Network.enable
     Network.disable
     Network.getCookies
     Network.setCookie
     Network.clearBrowserCache
     ... (50+ methods)

   $ bdg cdp --help Network.getCookies
   Network.getCookies

   Description:
     Returns all browser cookies for the current URL.

   Parameters:
     --urls <array>  Optional. Filter cookies by URLs.

   Returns:
     cookies: Array of Cookie objects

   Example:
     bdg cdp Network.getCookies --json
   ```

### Phase 4: Advanced Features
**Goal**: Polish for production use

1. Parameter validation:
   - Use `devtools-protocol` TypeScript types
   - Validate parameters before sending
   - Helpful error messages for type mismatches

2. Response formatting:
   - Domain-specific formatters (e.g., pretty-print cookies)
   - Table output for arrays
   - Color-coded status codes

3. Batch operations:
   - Execute multiple CDP commands
   - `bdg cdp --batch commands.json`

4. Session recording:
   - `bdg cdp --record` - Save all CDP calls
   - Replay CDP sequences

---

## Example Workflows

### Workflow 1: Debug Cookie Issues
```bash
# Start session
bdg localhost:3000

# Check all cookies
bdg network getCookies --json

# Or use raw CDP for specific URL
bdg cdp Network.getCookies --urls='["https://example.com"]' --json

# Set a test cookie
bdg cdp Network.setCookie \
  --name=test \
  --value=123 \
  --domain=example.com \
  --path=/

# Verify it was set
bdg network getCookies | jq '.cookies[] | select(.name=="test")'
```

### Workflow 2: Performance Analysis
```bash
# Start session
bdg localhost:3000

# Enable performance tracking
bdg cdp Performance.enable

# Navigate and let collectors run
# ...

# Get performance metrics
bdg cdp Performance.getMetrics --json
{
  "metrics": [
    {"name": "Timestamp", "value": 123456.789},
    {"name": "Documents", "value": 3},
    {"name": "Frames", "value": 2},
    {"name": "JSHeapUsedSize", "value": 12582912}
  ]
}

# Get resource timing
bdg cdp Performance.getResourceTimingInfo --json
```

### Workflow 3: Mobile Emulation
```bash
# Start session
bdg localhost:3000

# Emulate iPhone 12
bdg cdp Emulation.setDeviceMetricsOverride \
  --mobile=true \
  --width=390 \
  --height=844 \
  --deviceScaleFactor=3

# Emulate slow 3G
bdg cdp Network.emulateNetworkConditions \
  --offline=false \
  --downloadThroughput=$((750 * 1024 / 8)) \
  --uploadThroughput=$((250 * 1024 / 8)) \
  --latency=100

# Test and collect data
bdg network slow --threshold 500
bdg stop
```

### Workflow 4: Visual Debugging (Agent Use Case)
```bash
# Agent workflow: Find and highlight error elements

# 1. Find error elements
bdg dom query ".error" --json | jq -r '.nodes[] | .nodeId' > error_nodes.txt

# 2. Highlight each error (visual feedback for user)
cat error_nodes.txt | while read nodeId; do
  bdg cdp DOM.highlightNode \
    --nodeId=$nodeId \
    --highlightConfig='{"contentColor":{"r":255,"g":0,"b":0,"a":0.5}}'
done

# 3. Get text content for each
cat error_nodes.txt | while read nodeId; do
  bdg cdp DOM.getOuterHTML --nodeId=$nodeId --json
done | jq -r '.result.outerHTML'
```

---

## Comparison with MCP

**CDP vs MCP Protocol Integration:**

| Aspect | Raw CDP Commands | MCP Integration |
|--------|------------------|-----------------|
| **Setup** | Zero config (Chrome provides protocol) | Requires MCP server setup |
| **Discovery** | Can fetch from Chrome directly | Dynamic capability advertisement |
| **Flexibility** | Full protocol access (60+ domains) | Limited to MCP server capabilities |
| **Type Safety** | Runtime validation | Schema-based validation |
| **Composability** | Unix pipes (jq, grep) | MCP request/response chains |
| **Learning Curve** | Requires CDP knowledge | Requires MCP + CDP knowledge |

**When to use CDP commands:**
- ✅ Direct browser automation needs
- ✅ One-off debugging tasks
- ✅ Power users familiar with CDP
- ✅ Scripting and batch operations

**When to use MCP:**
- ✅ Multi-tool integration (connect bdg to other tools)
- ✅ Agent-driven workflows (LLM orchestration)
- ✅ Complex stateful interactions
- ✅ Cross-platform consistency

**Our approach**: Provide raw CDP access for flexibility, consider MCP layer for orchestration.

---

## Security Considerations

### 1. Validate Session Access
```typescript
// Only allow CDP commands on user's own session
async function connectToActiveSession(): Promise<CDPConnection> {
  const metadata = readSessionMetadata();
  if (!metadata?.webSocketDebuggerUrl) {
    throw new Error('No active session');
  }

  const cdp = new CDPConnection();
  await cdp.connect(metadata.webSocketDebuggerUrl);
  return cdp;
}
```

### 2. Sandbox Dangerous Methods
```typescript
// Warn or block destructive operations
const DANGEROUS_METHODS = [
  'Network.clearBrowserCache',  // Destructive
  'Page.crash',                 // Crashes tab
  'Browser.close',              // Closes browser
];

function validateCdpMethod(method: string): void {
  if (DANGEROUS_METHODS.includes(method)) {
    console.warn(`Warning: ${method} is a destructive operation`);
    console.warn('Add --force to confirm');
    process.exit(EXIT_CODES.INVALID_ARGUMENT);
  }
}
```

### 3. Rate Limiting
```typescript
// Prevent CDP spam
const CDP_RATE_LIMIT = 100; // commands per second
const cdpCallTimestamps: number[] = [];

function checkRateLimit(): void {
  const now = Date.now();
  cdpCallTimestamps.push(now);

  // Remove timestamps older than 1 second
  while (cdpCallTimestamps.length && cdpCallTimestamps[0] < now - 1000) {
    cdpCallTimestamps.shift();
  }

  if (cdpCallTimestamps.length > CDP_RATE_LIMIT) {
    throw new Error('CDP rate limit exceeded');
  }
}
```

---

## Success Metrics

### Developer Experience
- [ ] Can execute any CDP method without code changes
- [ ] Discover methods with `--list` and `--help` flags
- [ ] Clear error messages with suggestions
- [ ] Examples in help text for common workflows

### Agent Friendliness
- [ ] All CDP commands support `--json` output
- [ ] Semantic exit codes for all error cases
- [ ] Structured input (CLI flags → JSON params)
- [ ] Composable with Unix tools (jq, grep, awk)

### Performance
- [ ] CDP commands execute in < 100ms (local)
- [ ] Parameter parsing is lazy (only when needed)
- [ ] No schema loading overhead (fetch on-demand)

---

## References

- **CDP Protocol Viewer**: https://chromedevtools.github.io/devtools-protocol/
- **devtools-protocol NPM**: https://www.npmjs.com/package/devtools-protocol
- **Protocol JSON**: https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json
- **Live Protocol**: `http://localhost:9222/json/protocol` (when Chrome running)
- **Agent-Friendly Principles**: `docs/principles/AGENT_FRIENDLY_TOOLS.md`
- **Collector-Centric UX**: `docs/COLLECTOR_CENTRIC_UX.md`
