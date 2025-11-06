# M1 Implementation Guide: Agents Foundation

**Target**: v0.4.0
**Timeline**: Weeks 0–4 (5 weeks total)
**Status**: Not started

---

## Philosophy

Agents can already use raw `bdg cdp` for 95% of operations. Our job is to:
1. **Document patterns** showing how to compose raw CDP commands effectively
2. **Build stateful wrappers** only where polling/streaming/file I/O adds complexity
3. **Validate with examples** that real agent workflows work smoothly

**Golden Rule**: Only add a wrapper if agents consistently struggle with the raw CDP approach.

**Architecture Note**: All stateful wrappers require IPC architecture (daemon + worker). Commands must be implemented in both `src/commands/` (CLI) and `src/daemon/worker.ts` (worker handler).

---

## Deliverables

### 0. Week 0 Foundation ✅ COMPLETE

**Goal**: Validate that `bdg cdp` works end-to-end and plan schema evolution carefully.

**Tasks**:
1. ✅ Test `bdg cdp Runtime.evaluate` with real examples
2. ✅ Create "golden example" script showing full raw CDP workflow
3. ✅ Audit existing output schema (`BdgOutput` in `src/types.ts`)
4. ✅ Plan schema migration path (add new fields without breaking v0.2.0 users)
5. ✅ Document exit code mappings for new commands
6. ✅ Create contract tests with golden files
7. ✅ Design schema versioning strategy

**Acceptance**:
- [x] Raw CDP works: `bdg cdp Runtime.evaluate --params '{"expression": "document.title", "returnByValue": true}'`
- [x] Golden example script runs successfully (query title, check element existence, extract data)
- [x] Schema migration plan documented (incremental evolution, not breaking change)
- [x] Exit code table created for `dom screenshot` command
- [x] Contract tests with golden files implemented (`src/__tests__/schema.contract.test.ts`)
- [x] Schema versioning strategy documented (hybrid: implicit now, explicit at v1.0)

**Deliverables**:
- `tests/agent-benchmark/scenarios/00-golden-cdp-workflow.sh` - Golden workflow example
- `docs/roadmap/SCHEMA_MIGRATION_PLAN.md` - Complete schema evolution plan
- `docs/roadmap/WEEK_0_COMPLETION_REPORT.md` - Detailed completion report
- `src/__tests__/schema.contract.test.ts` - 12 contract tests (all passing)
- `src/__tests__/fixtures/schema-v0.2.1.golden.json` - Canonical schema example

---

### 1. Documentation: `docs/AGENT_WORKFLOWS.md`

**Goal**: Teach agents how to use raw `bdg cdp` for common operations.

**Structure**:
```markdown
# Agent Workflows

## Getting Started

### Golden Example: Full CDP Workflow
Complete example showing session start, raw CDP queries, and cleanup

## Core Patterns

### Element Queries
How to find and extract data from DOM elements using Runtime.evaluate

### Navigation and Page Control
Page lifecycle, navigation, reloads with raw CDP

### Waiting and Polling
Manual polling pattern (before wrapper exists) and when to use dom.wait wrapper

### Error Handling
Retry strategies, timeout patterns, semantic exit codes

## Common Recipes

### Recipe 1: Extract Text from Element
### Recipe 2: Get Element Bounding Box
### Recipe 3: Check Element Visibility
### Recipe 4: Navigate with Retry
### Recipe 5: Get All Cookies
### Recipe 6: Disable Cache
### Recipe 7: Throttle Network
### Recipe 8: Block URL Patterns
### Recipe 9: Evaluate JavaScript Safely
### Recipe 10: Wait for Element (Manual Polling)
```

**Acceptance**:
- [ ] Golden example runs successfully and demonstrates full workflow
- [ ] 10+ runnable snippets (bash examples)
- [ ] Each snippet includes error handling
- [ ] Each snippet shows composability with `jq`, `grep`
- [ ] Patterns work with current `bdg cdp` implementation

---

### 2. Output Schema v0

**Goal**: Standardize JSON output across all commands for agent parsing.

**Current Schema** (v0.2.0):
```json
{
  "version": "0.2.0",
  "success": boolean,
  "timestamp": "2025-11-06T16:00:00.000Z",
  "duration": 45230,
  "target": {"url": "...", "title": "..."},
  "data": { /* command-specific payload */ },
  "error": "error string",
  "partial": boolean
}
```

**Enhanced Schema v0** (v0.4.0 - Incremental Evolution):
```json
{
  "version": "0.4.0",
  "schema": "v0",
  "success": boolean,
  "command": "dom.query",
  "timestamp": "2025-11-06T16:00:00.000Z",
  "duration": 145,
  "target": {"url": "...", "title": "..."},
  "data": { /* command-specific payload */ },
  "meta": {
    "session_id": "sess_123",
    "exit_code": 0
  },
  "error": "legacy error string",
  "errors": [
    {
      "code": 83,
      "type": "RESOURCE_NOT_FOUND",
      "message": "Element not found",
      "recoverable": false,
      "suggestions": ["Check selector syntax", "Wait for element with dom.wait"]
    }
  ],
  "partial": boolean
}
```

**Migration Strategy**:
- Keep existing fields (`success`, `error`, `partial`) for backward compatibility
- Add new fields (`schema`, `command`, `meta`, `errors[]`) alongside existing ones
- New commands use enhanced schema from day 1
- Existing commands migrate incrementally
- Both formats supported until v1.0.0

**Implementation**:
- [ ] Audit current `BdgOutput` type and all formatters
- [ ] Create `src/types/outputSchemaV0.ts` with enhanced types
- [ ] Update `CommandRunner` to support both schemas (transitional)
- [ ] Add `schema: "v0"` field to distinguish from legacy format
- [ ] Add global flags: `--json` (existing), `--quiet`, `--schema-version`
- [ ] Add contract tests for output stability (golden files)
- [ ] Document both schemas in `docs/SCHEMA.md` with migration guide

---

### 3. Stateful Wrapper: `dom.wait`

**Why needed**: Polling logic is complex and error-prone. Agents shouldn't reimplement wait loops.

**Command**:
```bash
bdg dom wait --selector <sel> --state <attached|visible|hidden> [--timeout 5000] [--poll-interval 500]
```

**Behavior**:
- Polls every 500ms (configurable) until condition is met or timeout
- Returns success (exit 0) when condition met
- Returns error (exit 102 - CDP_TIMEOUT) on timeout with helpful message
- Returns error (exit 83 - RESOURCE_NOT_FOUND) if selector is invalid

**Exit Code Mapping**:
| Exit Code | Constant | Scenario |
|-----------|----------|----------|
| 0 | SUCCESS | Element found in desired state |
| 81 | INVALID_ARGUMENTS | Invalid selector or state parameter |
| 83 | RESOURCE_NOT_FOUND | Valid selector but element doesn't exist |
| 102 | CDP_TIMEOUT | Timeout reached before condition met |

**Implementation Approach**:
Use `Runtime.evaluate` with JavaScript for simplicity (single CDP call per poll):

```javascript
// For state: "attached"
!!document.querySelector(selector)

// For state: "visible"
(() => {
  const el = document.querySelector(selector);
  return el && el.offsetParent !== null;
})()

// For state: "hidden"
(() => {
  const el = document.querySelector(selector);
  return el && el.offsetParent === null;
})()
```

**Architecture Requirements**:
1. **IPC Types** (`src/ipc/types.ts`):
   - Add `DomWaitRequest` type
   - Add `DomWaitResponse` type
2. **Worker Handler** (`src/daemon/worker.ts`):
   - Implement polling loop using `Runtime.evaluate`
   - Handle timeout with proper cleanup
3. **Daemon Routing** (`src/daemon/ipcServer.ts`):
   - Route `dom.wait` requests to worker
4. **IPC Client** (`src/ipc/client.ts`):
   - Add `waitForElement(selector, state, timeout)` function
5. **CLI Command** (`src/commands/dom.ts`):
   - Add subcommand using CommandRunner pattern
   - Format output with exit codes

**Implementation Tasks**:
- [ ] Define IPC types for `dom.wait` request/response
- [ ] Implement worker handler with `Runtime.evaluate`-based polling
- [ ] Add daemon routing for `dom.wait` IPC message type
- [ ] Add IPC client function `waitForElement()`
- [ ] Add CLI command to `src/commands/dom.ts`
- [ ] Return structured JSON output following enhanced schema v0
- [ ] Add contract tests for timeout, success, and error cases

**Example Usage**:
```bash
# Agent workflow: wait for element, then extract data
bdg dom wait --selector ".error" --state visible --timeout 5000
if [ $? -eq 0 ]; then
  bdg cdp Runtime.evaluate --params '{"expression": "document.querySelector(\".error\").innerText", "returnByValue": true}'
fi

# With custom poll interval (reduce CPU usage)
bdg dom wait --selector ".slow-loader" --state attached --timeout 30000 --poll-interval 1000
```

---

### 4. Stateful Wrapper: `page.screenshot`

**Why needed**: Screenshot involves file I/O, base64 decoding, and optional overlays.

**Command**:
```bash
bdg page screenshot [--selector <sel>] [--full] [--out <file.png>]
```

**Behavior**:
- Captures screenshot (viewport or full page)
- Optionally captures specific element by selector (crops to bounding box)
- Saves to file (default: `screenshot-{timestamp}.png`)
- Returns absolute path to saved file
- PNG format only (JPEG/WebP support deferred to M2+)

**Exit Code Mapping**:
| Exit Code | Constant | Scenario |
|-----------|----------|----------|
| 0 | SUCCESS | Screenshot saved successfully |
| 81 | INVALID_ARGUMENTS | Invalid selector or file path |
| 82 | PERMISSION_DENIED | Cannot write to output directory |
| 83 | RESOURCE_NOT_FOUND | Selector doesn't match any element |
| 101 | CDP_CONNECTION_FAILURE | Failed to capture screenshot via CDP |

**Architecture Requirements**:
1. **New Domain**: Create `src/commands/page.ts` for page-level operations
2. **IPC Types** (`src/ipc/types.ts`):
   - Add `PageScreenshotRequest` type
   - Add `PageScreenshotResponse` type (includes base64 data)
3. **Worker Handler** (`src/daemon/worker.ts`):
   - Use `Page.captureScreenshot` CDP method
   - Handle `clip` parameter for selector-based screenshots
4. **Daemon Routing** (`src/daemon/ipcServer.ts`):
   - Route `page.screenshot` requests to worker
5. **IPC Client** (`src/ipc/client.ts`):
   - Add `captureScreenshot(options)` function
6. **CLI Command** (`src/commands/page.ts`):
   - Decode base64 response from IPC
   - Write to filesystem with proper error handling
   - Return absolute file path in response

**Implementation Tasks**:
- [ ] Create `src/commands/page.ts` for page domain commands
- [ ] Define IPC types for `page.screenshot` request/response
- [ ] Implement worker handler using `Page.captureScreenshot`
- [ ] Add daemon routing for `page.screenshot` IPC message type
- [ ] Add IPC client function `captureScreenshot()`
- [ ] Implement base64 decoding and file write in CLI command
- [ ] Return structured JSON with absolute file path
- [ ] Add contract tests for full page, viewport, and selector screenshots
- [ ] Optional (time permitting): Integrate with `dom.highlight` for annotated screenshots

**Example Usage**:
```bash
# Full page screenshot
bdg page screenshot --full --out debug.png
# Returns: {"success": true, "data": {"path": "/absolute/path/to/debug.png"}}

# Element screenshot (crops to bounding box)
bdg page screenshot --selector ".error" --out error.png

# Default filename with timestamp
bdg page screenshot
# Returns: {"success": true, "data": {"path": "/cwd/screenshot-2025-11-06-16-30-45.png"}}

# Combined workflow: highlight + screenshot (manual)
bdg dom highlight ".error" --color red
bdg page screenshot --full --out debug-errors.png
```

---

### 5. Example Scripts in `examples/agents/`

**Goal**: Demonstrate real agent workflows using CDP patterns + stateful wrappers.

#### Example 1: `dom-scrape.sh`
Extract structured data from a page (prices, titles, links) using raw CDP.

```bash
#!/bin/bash
# Extract product data from example e-commerce site

bdg example.com
bdg dom wait --selector ".product" --timeout 10000

# Extract product names
PRODUCTS=$(bdg cdp Runtime.evaluate --params '{"expression": "Array.from(document.querySelectorAll(\".product-name\")).map(e => e.innerText)", "returnByValue": true}' | jq -r '.result.value')

echo "$PRODUCTS"
bdg stop
```

#### Example 2: `wait-for-element.sh`
Polling pattern using `dom.wait` wrapper.

```bash
#!/bin/bash
# Wait for dynamic content to load, then extract

bdg localhost:3000
bdg dom wait --selector ".loaded" --state visible --timeout 30000 || exit 1

# Content is ready, extract it
bdg cdp Runtime.evaluate --params '{"expression": "document.querySelector(\".data\").innerText", "returnByValue": true}'
bdg stop
```

#### Example 3: `network-cache-control.sh`
Disable cache using raw CDP, navigate, verify headers.

```bash
#!/bin/bash
# Test cache-disabled behavior

bdg localhost:3000
bdg cdp Network.setCacheDisabled --params '{"cacheDisabled": true}'
bdg cdp Page.navigate --params '{"url": "https://example.com"}'

# Capture and verify Cache-Control headers
# (Implementation depends on network capture wrapper from M2)

bdg stop
```

#### Example 4: `screenshot-with-highlight.sh`
Annotated screenshot showing errors.

```bash
#!/bin/bash
# Visual debugging: screenshot with error highlights

bdg localhost:3000
bdg dom wait --selector ".error" --timeout 5000

bdg dom highlight ".error" --color red --opacity 0.7
bdg page screenshot --full --out debug-screenshot.png

echo "Screenshot saved to debug-screenshot.png"
bdg stop
```

#### Example 5: `safe-navigation.sh`
Navigation with retry and error handling.

```bash
#!/bin/bash
# Robust navigation pattern

MAX_RETRIES=3
ATTEMPT=0

bdg localhost:3000

while [ $ATTEMPT -lt $MAX_RETRIES ]; do
  bdg cdp Page.navigate --params '{"url": "https://example.com"}'
  
  # Wait for page load
  sleep 2
  
  # Check if navigation succeeded
  TITLE=$(bdg cdp Runtime.evaluate --params '{"expression": "document.title", "returnByValue": true}' | jq -r '.result.value')
  
  if [ -n "$TITLE" ]; then
    echo "Navigation successful: $TITLE"
    break
  fi
  
  ATTEMPT=$((ATTEMPT + 1))
  echo "Retry $ATTEMPT/$MAX_RETRIES"
done

bdg stop
```

**Acceptance**:
- [ ] All 5 examples run successfully in CI
- [ ] Each example includes error handling
- [ ] Each example documents the pattern it demonstrates

---

## Testing Strategy

### Contract Tests
Create contract tests for each new command to lock down behavior:

**`src/commands/__tests__/dom-wait.contract.test.ts`**:
- Test timeout behavior (should exit 102)
- Test successful wait for attached element (exit 0)
- Test successful wait for visible element (exit 0)
- Test successful wait for hidden element (exit 0)
- Test invalid selector (exit 81)
- Test element never appears (exit 102 after timeout)
- Validate output schema matches enhanced schema v0
- Test configurable poll interval

**`src/commands/__tests__/page-screenshot.contract.test.ts`**:
- Test full page screenshot (exit 0, file exists)
- Test viewport screenshot (exit 0)
- Test selector-based screenshot (exit 0, correct crop)
- Test invalid selector (exit 83)
- Test write permission denied (exit 82)
- Test default filename generation
- Validate output schema and absolute path

**`src/commands/__tests__/schema-v0.contract.test.ts`**:
- Test schema v0 fields present in all commands
- Test backward compatibility with legacy schema
- Golden JSON file comparison (snapshot testing)
- Validate exit codes match `meta.exit_code` in JSON

### Integration Tests
Create `src/__tests__/integration/agent-workflows.test.ts`:
- Run all 5 example scripts end-to-end
- Validate exit codes for each script
- Validate JSON output structure (parse and assert fields)
- Test script composition (pipe to `jq`, check exit codes in bash)
- Test against static fixtures in `examples/fixtures/`

### CI Test Fixtures
Create static HTML files for deterministic testing:
- `examples/fixtures/simple.html` - Basic page with known elements
- `examples/fixtures/dynamic.html` - Elements that appear after delay (for wait tests)
- `examples/fixtures/large.html` - Large page for full-page screenshot tests
- `examples/fixtures/empty.html` - Minimal page for edge cases

### Smoke Tests (Optional for M1)
If time permits, add smoke tests against real public sites:
- example.com (stable, rarely changes)
- wikipedia.org (international CDN, reliable)
- httpbin.org (HTTP testing service)

**Note**: Real site tests are brittle and slow. Prioritize static fixtures for M1.

---

## Success Criteria Checklist

### Foundation (Week 0) ✅ COMPLETE
- [x] `bdg cdp Runtime.evaluate` works end-to-end with real examples
- [x] Golden example script demonstrates full CDP workflow
- [x] Schema migration strategy documented (incremental, not breaking)
- [x] Exit code mappings defined for new commands
- [x] Contract tests with golden files implemented
- [x] Schema versioning strategy designed

### Documentation (Weeks 1, 4)
- [ ] `docs/AGENT_WORKFLOWS.md` published with 10+ CDP patterns and runnable code
- [ ] `docs/SCHEMA.md` documents both legacy and enhanced schemas with migration guide
- [ ] Golden example included in AGENT_WORKFLOWS.md showing session lifecycle

### Schema Evolution (Week 1)
- [ ] Enhanced schema v0 types created in `src/types/outputSchemaV0.ts`
- [ ] `CommandRunner` supports both legacy and enhanced schemas
- [ ] `schema: "v0"` field distinguishes new format from legacy
- [ ] Contract tests validate schema stability with golden JSON files

### Stateful Wrappers (Weeks 2-3)
- [ ] `dom.wait` command works reliably via IPC architecture:
  - [ ] Worker handler implements polling with `Runtime.evaluate`
  - [ ] Exit codes match specification (0, 81, 83, 102)
  - [ ] Contract tests pass (timeout, success, invalid selector)
- [ ] `page.screenshot` command works reliably via IPC architecture:
  - [ ] Worker returns base64 data, CLI writes files
  - [ ] Full page, viewport, and selector modes work
  - [ ] Exit codes match specification (0, 81, 82, 83, 101)
  - [ ] Contract tests pass (all modes, edge cases)

### Examples & Validation (Week 4)
- [ ] 5 example scripts in `examples/agents/` pass CI:
  - [ ] `golden-cdp-example.sh` - Full workflow demonstration
  - [ ] `wait-for-element.sh` - Using dom.wait wrapper
  - [ ] `screenshot-with-highlight.sh` - Annotated screenshots
  - [ ] `dom-scrape.sh` - Extract structured data with raw CDP
  - [ ] `safe-navigation.sh` - Navigation with retry pattern
- [ ] CI runs examples against static fixtures in `examples/fixtures/`
- [ ] All examples include error handling and demonstrate composability

### Quality Gates
- [ ] Can automate 3 common agent tasks using raw CDP + stateful wrappers
- [ ] All new commands use semantic exit codes consistently
- [ ] No breaking changes to existing v0.2.0 commands
- [ ] CHANGELOG.md documents all changes and migration notes
- [ ] v0.4.0 tagged and ready for release

---

## Implementation Order (Week by Week)

### Week 0: Foundation Validation
**Goal**: Validate assumptions and plan migrations

1. Test `bdg cdp Runtime.evaluate` end-to-end with real examples
2. Create golden example script: session start → CDP queries → cleanup
3. Audit `BdgOutput` type and all command formatters in `src/ui/formatters/`
4. Document schema migration strategy (incremental, not breaking)
5. Create exit code mapping table for new commands
6. Test that daemon mode (default) works reliably

**Deliverables**:
- [ ] Golden example script (`examples/golden-cdp-example.sh`)
- [ ] Schema migration plan document (inline in this guide)
- [ ] Exit code table (see deliverable sections above)
- [ ] Verified: `bdg cdp` works for Runtime.evaluate, Page.navigate, Network.enable

### Week 1: Schema Enhancement & Documentation Foundation
**Goal**: Evolve schema incrementally and start documentation

1. Create `src/types/outputSchemaV0.ts` with enhanced types
2. Update `CommandRunner` to support both legacy and enhanced schemas
3. Add `schema: "v0"` field to distinguish formats
4. Start `docs/AGENT_WORKFLOWS.md` with:
   - Golden example (from Week 0)
   - First 3 CDP patterns (element queries, visibility checks, navigation)
5. Write contract tests for new schema fields (use golden JSON files)

**Deliverables**:
- [ ] Enhanced schema types implemented
- [ ] CommandRunner supports both schemas
- [ ] First 3 patterns in AGENT_WORKFLOWS.md with runnable code
- [ ] Contract tests for schema v0

### Week 2: `dom.wait` Wrapper
**Goal**: Implement first stateful wrapper with full IPC architecture

1. Define IPC types (`DomWaitRequest`, `DomWaitResponse`)
2. Implement worker handler in `src/daemon/worker.ts`:
   - Polling loop using `Runtime.evaluate`
   - Timeout handling with proper cleanup
   - Support for attached/visible/hidden states
3. Add daemon routing in `src/daemon/ipcServer.ts`
4. Add IPC client function in `src/ipc/client.ts`
5. Add CLI command in `src/commands/dom.ts` using CommandRunner
6. Write contract tests (timeout, success, invalid selector)
7. Create example: `examples/agents/wait-for-element.sh`

**Deliverables**:
- [ ] `dom.wait` command works end-to-end via IPC
- [ ] Exit codes match specification (0, 81, 83, 102)
- [ ] Contract tests cover all scenarios
- [ ] Example script runs successfully

### Week 3: `page.screenshot` Wrapper
**Goal**: Implement second stateful wrapper with file I/O

1. Create `src/commands/page.ts` for page domain
2. Define IPC types (`PageScreenshotRequest`, `PageScreenshotResponse`)
3. Implement worker handler using `Page.captureScreenshot`:
   - Full page vs viewport
   - Selector-based cropping (use `DOM.getBoxModel` for clip coordinates)
   - Return base64 data via IPC
4. Add daemon routing
5. Add IPC client function
6. Implement CLI command with base64 decode and file write
7. Write contract tests (full page, selector, file permissions)
8. Create example: `examples/agents/screenshot-with-highlight.sh`

**Deliverables**:
- [ ] `page.screenshot` command works with all options
- [ ] Files written with correct permissions
- [ ] Exit codes match specification
- [ ] Contract tests cover edge cases
- [ ] Example script demonstrates highlight + screenshot workflow

### Week 4: Examples, Documentation & Polish
**Goal**: Complete documentation and validate with examples

1. Complete remaining example scripts:
   - `dom-scrape.sh` (extract structured data)
   - `network-cache-control.sh` (raw CDP for cache disable)
   - `safe-navigation.sh` (retry pattern)
2. Finish `docs/AGENT_WORKFLOWS.md`:
   - Add patterns 4-10 (cookies, cache, throttling, etc.)
   - Document when to use wrappers vs raw CDP
3. Write `docs/SCHEMA.md`:
   - Document both legacy and enhanced schemas
   - Provide migration guide
   - Show per-command data shapes
4. Set up CI workflow for example scripts:
   - Use static test fixtures (HTML files in `examples/fixtures/`)
   - Assert exit codes and JSON schema
5. Final testing and bug fixes
6. Update CHANGELOG.md
7. Tag v0.4.0

**Deliverables**:
- [ ] 5 example scripts run successfully in CI
- [ ] AGENT_WORKFLOWS.md complete with 10+ patterns
- [ ] SCHEMA.md documents both formats with examples
- [ ] CI validates all examples on every commit
- [ ] v0.4.0 tagged and released

---

## Open Questions & Decisions

1. **Screenshot format**: PNG only, or support JPEG/WebP?
   - **✅ Decision**: PNG only for v0.4.0 (simplicity first, other formats in M2+ if requested)

2. **`dom.wait` visibility check**: Use CDP `DOM.getBoxModel` or JavaScript?
   - **✅ Decision**: Use `Runtime.evaluate` with JavaScript `offsetParent !== null` check
   - **Rationale**: Simpler (one CDP call instead of two), faster, less IPC overhead

3. **Global flags**: Should `--json` be default, or require explicit flag?
   - **✅ Decision**: Human-readable default, `--json` opt-in for agents
   - **Note**: `bdg cdp` always outputs JSON since it's low-level API

4. **Schema versioning**: Include schema version in JSON output?
   - **✅ Decision**: Yes, add `{"schema": "v0", "version": "0.4.0", ...}`
   - **Rationale**: Distinguish tool version from schema version for future compatibility

5. **Command domain structure**: Where does `page.screenshot` belong?
   - **✅ Decision**: Create new `src/commands/page.ts` for page domain
   - **Rationale**: Aligns with CDP domain structure, leaves room for future page commands

6. **Daemon mode requirement**: Do all commands work without daemon?
   - **✅ Decision**: Stateful wrappers (`dom.wait`, `page.screenshot`) require daemon mode
   - **Note**: Daemon mode is default, so this is transparent to users

7. **CI test fixtures**: Use real websites or static HTML?
   - **✅ Decision**: Use static HTML files in `examples/fixtures/` for deterministic tests
   - **Rationale**: Faster, more reliable, no network dependencies in CI

---

## Next Steps After M1

Once M1 is complete, evaluate:
1. **Did agents struggle with any raw CDP patterns?** → Consider convenience wrappers
2. **Are there common multi-step workflows?** → Consider composite commands
3. **What feedback from early users?** → Prioritize M2 network wrappers

Then move to **M2: Network Foundation** (stateful wrappers: `net.capture`, `net.har`)

---

## References

- [Roadmap](./ROADMAP.md)
- [CDP Method Exposure Design](./CDP_METHOD_EXPOSURE.md)
- [Agent-Friendly CLI Principles](./AGENT_FRIENDLY_TOOLS.md)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
