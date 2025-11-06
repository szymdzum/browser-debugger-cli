# M1 Implementation Guide: Agents Foundation

**Target**: v0.4.0  
**Timeline**: Weeks 1–4  
**Status**: Not started

---

## Philosophy

Agents can already use raw `bdg cdp` for 95% of operations. Our job is to:
1. **Document patterns** showing how to compose raw CDP commands effectively
2. **Build stateful wrappers** only where polling/streaming/file I/O adds complexity
3. **Validate with examples** that real agent workflows work smoothly

**Golden Rule**: Only add a wrapper if agents consistently struggle with the raw CDP approach.

---

## Deliverables

### 1. Documentation: `docs/AGENT_WORKFLOWS.md`

**Goal**: Teach agents how to use raw `bdg cdp` for common operations.

**Structure**:
```markdown
# Agent Workflows

## Core Patterns

### Element Queries
How to find and extract data from DOM elements using Runtime.evaluate

### Navigation and Page Control
Page lifecycle, navigation, reloads with raw CDP

### Waiting and Polling
Pattern for implementing waits (until wrapper exists)

### Error Handling
Retry strategies, timeout patterns, semantic exit codes

## Common Recipes

### Recipe 1: Extract Text from Element
### Recipe 2: Get Element Bounding Box
### Recipe 3: Navigate with Retry
### Recipe 4: Wait for Network Idle
### Recipe 5: Screenshot Full Page
### Recipe 6: Get All Cookies
### Recipe 7: Disable Cache
### Recipe 8: Throttle Network
### Recipe 9: Block URL Patterns
### Recipe 10: Evaluate JavaScript Safely
```

**Acceptance**:
- [ ] 10+ runnable snippets (bash examples)
- [ ] Each snippet includes error handling
- [ ] Each snippet shows composability with `jq`, `grep`

---

### 2. Output Schema v0

**Goal**: Standardize JSON output across all commands for agent parsing.

**Envelope Structure**:
```json
{
  "version": "0.4.0",
  "command": "dom.query",
  "status": "success" | "error",
  "timestamp": "2025-11-06T16:00:00.000Z",
  "data": { /* command-specific payload */ },
  "meta": {
    "duration_ms": 145,
    "session_id": "sess_123"
  },
  "errors": [
    {
      "code": 92,
      "type": "resource_not_found",
      "message": "Element not found",
      "recoverable": false,
      "suggestions": ["Check selector syntax", "Wait for element with dom.wait"]
    }
  ]
}
```

**Implementation**:
- [ ] Create `src/types/outputSchema.ts` with TypeScript types
- [ ] Update `CommandRunner` to wrap all command outputs
- [ ] Add global flags: `--json`, `--quiet`, `--schema-version`
- [ ] Add contract tests for output stability (golden files)
- [ ] Document in `docs/SCHEMA.md`

---

### 3. Stateful Wrapper: `dom.wait`

**Why needed**: Polling logic is complex and error-prone. Agents shouldn't reimplement wait loops.

**Command**:
```bash
bdg dom wait --selector <sel> --state <attached|visible|hidden> [--timeout 5000]
```

**Behavior**:
- Polls every 500ms until condition is met or timeout
- Returns success (exit 0) when condition met
- Returns error (exit 90) on timeout with helpful message

**Implementation**:
- [ ] Add `dom.wait` command to `src/commands/dom.ts`
- [ ] Use CDP `DOM.querySelectorAll` + `DOM.getBoxModel` for visibility checks
- [ ] Implement polling loop with configurable timeout
- [ ] Return structured JSON output following schema v0
- [ ] Add contract tests

**Example Usage**:
```bash
# Agent workflow: wait for element, then extract data
bdg dom wait --selector ".error" --state visible --timeout 5000
if [ $? -eq 0 ]; then
  bdg cdp Runtime.evaluate --params '{"expression": "document.querySelector(\".error\").innerText", "returnByValue": true}'
fi
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
- Optionally highlights selector before capture
- Saves to file (default: `screenshot-{timestamp}.png`)
- Returns path to saved file

**Implementation**:
- [ ] Add `page.screenshot` command to `src/commands/` (new file or add to existing)
- [ ] Use CDP `Page.captureScreenshot` with `clip` for selector-based screenshots
- [ ] Decode base64 and save to file system
- [ ] Optional: Use existing `dom.highlight` before screenshot for annotated captures
- [ ] Return JSON with file path following schema v0
- [ ] Add contract tests

**Example Usage**:
```bash
# Agent workflow: highlight errors and screenshot
bdg dom highlight ".error" --color red
bdg page screenshot --full --out debug-errors.png
# Returns: {"status": "success", "data": {"path": "/path/to/debug-errors.png"}}
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
Create `src/commands/__tests__/dom-wait.contract.test.ts`:
- Test timeout behavior
- Test successful wait
- Test invalid selectors
- Validate output schema

### Integration Tests
Create `src/__tests__/integration/agent-workflows.test.ts`:
- Run all 5 example scripts
- Validate exit codes
- Validate JSON output structure

### Smoke Tests
Run examples against real sites in CI:
- example.com
- github.com
- wikipedia.org

---

## Success Criteria Checklist

- [ ] `docs/AGENT_WORKFLOWS.md` published with 10+ CDP patterns
- [ ] `docs/SCHEMA.md` documents output envelope v0
- [ ] Output schema v0 implemented across all commands
- [ ] `dom.wait` command works reliably (contract tests pass)
- [ ] `page.screenshot` command works reliably (contract tests pass)
- [ ] 5 example scripts in `examples/agents/` pass CI
- [ ] Can automate 3 common agent tasks (scraping, waiting, screenshots)
- [ ] Semantic exit codes implemented (0, 80-89, 90-99, 100-109, 110-119)

---

## Implementation Order (Week by Week)

### Week 1: Schema & Documentation
1. Define output schema v0 (`src/types/outputSchema.ts`)
2. Update `CommandRunner` to use schema
3. Start `docs/AGENT_WORKFLOWS.md` with first 5 patterns
4. Write contract tests for schema validation

### Week 2: `dom.wait` Wrapper
1. Implement `dom.wait` command
2. Add polling logic with timeout
3. Write contract tests
4. Create example: `wait-for-element.sh`

### Week 3: `page.screenshot` Wrapper
1. Implement `page.screenshot` command
2. Handle file I/O and base64 decoding
3. Optional highlight integration
4. Write contract tests
5. Create example: `screenshot-with-highlight.sh`

### Week 4: Examples & Polish
1. Complete remaining example scripts (dom-scrape, network-cache, safe-navigation)
2. Finish `docs/AGENT_WORKFLOWS.md` (patterns 6-10)
3. Write `docs/SCHEMA.md`
4. Set up CI for example workflows
5. Tag v0.4.0

---

## Open Questions

1. **Screenshot format**: PNG only, or support JPEG/WebP?
   - **Decision**: PNG only for v0.4.0 (simplicity)

2. **`dom.wait` visibility check**: Use CDP `DOM.getBoxModel` or JavaScript `getBoundingClientRect()`?
   - **Decision**: CDP `DOM.getBoxModel` (no JavaScript execution needed)

3. **Global flags**: Should `--json` be default, or require explicit flag?
   - **Decision**: Default human-readable, `--json` for agents (opt-in)

4. **Schema versioning**: Include schema version in JSON output?
   - **Decision**: Yes, `{"version": "0.4.0", "schema": "v0", ...}`

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
