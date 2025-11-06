# 01: Agents Foundation

**Target Version**: v0.4.0  
**Timeline**: Weeks 0-4  
**Status**: 🎯 Current Focus

## Philosophy

Agents can already use raw `bdg cdp` for most operations. Focus on documentation and only build wrappers for stateful/complex operations.

## Deliverables

### Week 0: Foundation Validation (NEW)
Before building new wrappers, validate that the foundation works end-to-end:

**Tasks**:
- [ ] Write golden example script using only `bdg cdp` (connect → query → evaluate → exit)
- [ ] Document all exit codes currently in use
- [ ] Catalog all IPC message types
- [ ] List all CDP domains already exposed
- [ ] Identify gaps where raw CDP is too painful (candidates for wrappers)

**Acceptance**:
- [ ] Golden script runs successfully in CI
- [ ] Exit code documentation complete in `docs/EXIT_CODES.md`
- [ ] IPC message catalog in `docs/IPC_MESSAGES.md`
- [ ] Gap analysis document identifies exactly 2-3 wrapper candidates

**Why Week 0?**  
Prevents building wrappers we don't need. Validates the "raw CDP first" philosophy works in practice.

---

### 1. Documentation: `docs/AGENT_WORKFLOWS.md`

**Purpose**: Show agents how to compose raw CDP commands for common tasks

**Content**:
- **Golden example**: Full workflow (start → navigate → query → extract → stop)
- **Core patterns**:
  - Element queries using `Runtime.evaluate`
  - Getting element properties and bounding boxes
  - Navigation and page control via `Page` domain
  - Waiting strategies (polling with timeout)
  - Error handling and retry logic
- **10+ recipes**: Copy-paste examples for common scenarios
  - Extract text from element
  - Get element bounding box
  - Check element visibility
  - Navigate with retry
  - Get all cookies
  - Disable cache
  - Throttle network
  - Block URL patterns
  - Evaluate JavaScript safely
  - Wait for element (manual polling)

**Acceptance**:
- [ ] Documentation shows 10+ working CDP patterns
- [ ] Each pattern includes error handling
- [ ] Golden example runs in CI
- [ ] Agents can complete 3 common tasks using only documentation

---

### 2. Output Schema v0

**Goal**: Enhanced schema with incremental evolution (keeps backward compatibility)

**Current Schema** (implicit):
```json
{
  "version": "0.2.0",
  "success": true,
  "timestamp": "...",
  "duration": 123,
  "target": { "url": "...", "title": "..." },
  "data": { ... },
  "error": "..." // if failed
}
```

**Enhanced Schema v0** (additive only):
```json
{
  "version": "0.4.0",           // existing
  "schema": "v0",               // NEW: schema version (enables evolution)
  "command": "dom.eval",        // NEW: command that was executed
  "timestamp": "...",           // existing
  "duration": 123,              // existing
  "target": { ... },            // existing
  "data": { ... },              // existing
  "meta": {                     // NEW: session context
    "session_id": "abc123",
    "exit_code": 0
  },
  "error": "...",               // DEPRECATED: keep for compat
  "errors": [                   // NEW: structured errors
    {
      "code": "CDP_TIMEOUT",
      "type": "system",
      "message": "Connection timeout",
      "recoverable": true,
      "suggestions": ["Increase --timeout", "Check Chrome is running"]
    }
  ]
}
```

**Migration Strategy**:
- Add new fields alongside existing ones (non-breaking)
- Keep `error` field populated until v1.0
- Document both formats in `docs/SCHEMA.md`
- Add contract tests to lock schema shape

**Acceptance**:
- [ ] All commands return enhanced schema
- [ ] `error` field still populated (backward compat)
- [ ] New `errors` array has structured data
- [ ] Contract tests validate schema
- [ ] `docs/SCHEMA.md` documents v0 format

---

### 3. Stateful Wrapper: `dom.wait`

**Why**: Polling loops with timeout are complex and error-prone in raw CDP

**Command**: `bdg dom.wait --selector <sel> [--state <state>] [--timeout <ms>] [--poll-interval <ms>]`

**States**:
- `attached` (default) - Element exists in DOM
- `visible` - Element is visible (not `display: none`, not `visibility: hidden`)
- `hidden` - Element is hidden or doesn't exist

**Options**:
- `--timeout <ms>` - Max wait time (default: 5000ms)
- `--poll-interval <ms>` - Polling frequency (default: 500ms)
- `--absent` - Wait for element to NOT exist (alias for `--state hidden`)

**Examples**:
```bash
# Wait for element to exist
bdg dom.wait --selector '#login-button' --timeout 10000

# Wait for element with specific text
bdg dom.wait --selector 'button' --text 'Submit' --timeout 5000

# Wait for element to disappear
bdg dom.wait --selector '.loading' --absent --timeout 3000
```

**Output**:
```json
{
  "success": true,
  "data": {
    "found": true,
    "elapsed": 234,
    "nodeId": 42
  }
}
```

**Error handling**:
- Exit code `102` (CDP_TIMEOUT) if timeout exceeded
- Exit code `101` (CDP_CONNECTION_FAILURE) if connection lost
- Clear suggestions in error message

**Implementation**:
- Use `Runtime.evaluate` to query DOM in loop
- Poll every `poll-interval` until condition met or timeout
- Return nodeId on success (agents can query details separately)

**Acceptance**:
- [ ] Finds element within timeout
- [ ] Returns appropriate exit code on timeout
- [ ] `--absent` mode works for removal detection
- [ ] Integration tests pass
- [ ] Documented in AGENT_WORKFLOWS.md

---

### 4. Stateful Wrapper: `page.screenshot`

**Why**: Screenshot + file I/O + optional highlighting is multi-step

**Command**: `bdg page.screenshot [--selector <sel>] [--full] [--out <file>] [--format <png|jpeg>]`

**Modes**:
- Default: Viewport screenshot
- `--full`: Full page screenshot (scrolls and stitches)
- `--selector <sel>`: Screenshot with element highlighted

**Options**:
- `--out <file>` - Output file path (if omitted, outputs base64 to stdout)
- `--format <png|jpeg>` - Image format (default: png)
- `--quality <0-100>` - JPEG quality (default: 80)

**Examples**:
```bash
# Full page screenshot
bdg page.screenshot --output screenshot.png

# Screenshot with element highlight
bdg page.screenshot --selector '#error-message' --output error.png

# Viewport only (faster)
bdg page.screenshot --viewport --output viewport.png

# Base64 output (no file)
bdg page.screenshot --format base64
```

**Output**:
```json
{
  "success": true,
  "data": {
    "format": "png",
    "size": 45678,
    "path": "/path/to/screenshot.png",
    "dimensions": {
      "width": 1920,
      "height": 1080
    }
  }
}
```

**Implementation**:
- Use `Page.captureScreenshot` CDP method
- If `--selector`: Use `DOM.highlightNode` before capture
- If `--full`: Capture with `captureBeyondViewport: true`
- Write to file or output base64

**Acceptance**:
- [ ] Creates valid PNG/JPEG files
- [ ] Element highlighting draws overlay
- [ ] Base64 output works without file
- [ ] Full page mode captures entire page
- [ ] Integration tests pass
- [ ] Documented in AGENT_WORKFLOWS.md

---

### 5. Example Scripts: `examples/agents/`

**Purpose**: Battle-tested workflows that prove the primitives work

**Scripts**:

#### 1. `dom-scrape.sh`
Extract structured data from multiple elements:
```bash
#!/bin/bash
bdg start https://example.com
bdg dom.eval "Array.from(document.querySelectorAll('h2')).map(h => h.textContent)"
bdg stop
```

#### 2. `wait-for-element.sh`
Navigation with polling:
```bash
#!/bin/bash
bdg start https://example.com
bdg page.navigate https://example.com/slow-page
bdg dom.wait --selector '.content' --timeout 10000
bdg dom.eval "document.querySelector('.content').innerText"
bdg stop
```

#### 3. `network-cache-control.sh`
Disable cache and verify:
```bash
#!/bin/bash
bdg start https://example.com
bdg cdp Network.enable
bdg cdp Network.setCacheDisabled '{"cacheDisabled": true}'
bdg page.navigate https://example.com
bdg peek --network | jq '.[] | select(.response.headers."cache-control")'
bdg stop
```

#### 4. `screenshot-with-highlight.sh`
Error detection with visual proof:
```bash
#!/bin/bash
bdg start https://example.com
bdg dom.wait --selector '.error' --timeout 5000 || {
  echo "No errors found"
  exit 0
}
bdg page.screenshot --selector '.error' --out error.png
bdg stop
```

#### 5. `safe-navigation.sh`
Navigation with retry and error recovery:
```bash
#!/bin/bash
MAX_RETRIES=3
for i in $(seq 1 $MAX_RETRIES); do
  bdg start https://example.com && break
  echo "Retry $i/$MAX_RETRIES"
  sleep 2
done
bdg status --json | jq -e '.success' || exit 1
```

**Acceptance**:
- [ ] All 5 scripts run successfully in CI
- [ ] Each script has README with explanation
- [ ] Scripts demonstrate error handling
- [ ] Scripts are agent-friendly (parseable output)

---

## Testing Strategy

### Contract Tests
Ensure output schema stability:
```typescript
describe('Output Schema v0', () => {
  it('includes all required fields', () => {
    const output = execSync('bdg status --json');
    expect(output).toHaveProperty('schema', 'v0');
    expect(output).toHaveProperty('command');
    expect(output).toHaveProperty('meta.exit_code');
  });
});
```

### Integration Tests
Test stateful wrappers end-to-end:
```typescript
describe('dom.wait', () => {
  it('finds element within timeout', async () => {
    await page.goto('http://localhost:3000/test.html');
    const result = execSync('bdg dom.wait --selector "#target" --timeout 5000');
    expect(result.exitCode).toBe(0);
    expect(result.data.found).toBe(true);
  });
  
  it('times out when element not found', async () => {
    const result = execSync('bdg dom.wait --selector "#missing" --timeout 1000');
    expect(result.exitCode).toBe(102); // CDP_TIMEOUT
  });
});
```

### CI Test Fixtures
Static HTML files in `examples/fixtures/`:
```html
<!-- examples/fixtures/wait-test.html -->
<!DOCTYPE html>
<html>
<body>
  <div id="immediate">Already here</div>
  <script>
    setTimeout(() => {
      const delayed = document.createElement('div');
      delayed.id = 'delayed';
      document.body.appendChild(delayed);
    }, 1000);
  </script>
</body>
</html>
```

### Smoke Tests (Optional for M1)
Test against real websites:
```bash
# Smoke test suite
./scripts/smoke-tests.sh example.com github.com wikipedia.org
```

---

## Success Criteria Checklist

### Foundation (Week 0)
- [ ] Golden example script using only `bdg cdp` works end-to-end
- [ ] Exit code documentation complete
- [ ] IPC message catalog complete
- [ ] Gap analysis identifies 2-3 wrapper candidates

### Documentation (Weeks 1, 4)
- [ ] `docs/AGENT_WORKFLOWS.md` published with golden example
- [ ] 10+ recipes covering common CDP patterns
- [ ] Error handling guide with retry strategies
- [ ] Examples are copy-pastable and work

### Schema Evolution (Week 1)
- [ ] Enhanced schema v0 defined in `docs/SCHEMA.md`
- [ ] All commands migrated to new schema
- [ ] Backward compatibility maintained (`error` field)
- [ ] Contract tests lock schema shape

### Stateful Wrappers (Weeks 2-3)
- [ ] `dom.wait` implemented with all options
- [ ] `page.screenshot` implemented with highlighting
- [ ] Both commands have integration tests
- [ ] Error handling returns correct exit codes
- [ ] Clear error messages with suggestions

### Examples & Validation (Week 4)
- [ ] 5 example scripts in `examples/agents/`
- [ ] All examples run in CI against fixtures
- [ ] Documentation updated with script walkthroughs
- [ ] Scripts demonstrate real-world workflows

### Quality Gates
- [ ] `npm run check:enhanced` passes
- [ ] Test coverage >80% for new code
- [ ] All TSDoc comments complete
- [ ] No dead code or unused imports
- [ ] No breaking changes to v0.2.0 commands

---

## Implementation Order

### Week 0: Foundation Validation
1. Write golden example script using `bdg cdp`
2. Document all exit codes in use
3. Catalog IPC message types
4. List CDP domains exposed
5. Identify 2-3 wrapper candidates via gap analysis

### Week 1: Schema & Documentation Foundation
1. Define enhanced schema v0 in `docs/SCHEMA.md`
2. Migrate `status` command to new schema (pilot)
3. Update CommandRunner to support new schema
4. Start `docs/AGENT_WORKFLOWS.md` with golden example
5. Write 3 recipes using raw CDP

### Week 2: `dom.wait` Implementation
1. Create `src/commands/domHelpers.ts::waitForElement()`
2. Add `dom.wait` subcommand to `src/commands/dom.ts`
3. Implement polling logic with timeout
4. Write integration tests
5. Add recipe to AGENT_WORKFLOWS.md

### Week 3: `page.screenshot` Implementation
1. Create or extend `src/commands/page.ts`
2. Implement `page.screenshot` using `Page.captureScreenshot`
3. Add element highlighting support via `DOM.highlightNode`
4. Handle file I/O and base64 output
5. Write integration tests
6. Add recipe to AGENT_WORKFLOWS.md

### Week 4: Examples, Documentation & Polish
1. Write 5 example scripts in `examples/agents/`
2. Add scripts to CI workflow with fixtures
3. Complete AGENT_WORKFLOWS.md with all 10+ recipes
4. Add error handling examples
5. Final documentation review
6. Run full test suite and fix any issues

---

## Open Questions & Decisions

### Resolved
- ✅ Should `dom.wait` return nodeId or full element data? → **NodeId only** (agents can query separately)
- ✅ Screenshot format defaults? → **PNG** (best compatibility)
- ✅ Should we build `dom.wait` or just document polling pattern? → **Build it** (too complex to get right)

### Pending
- ❓ Should `dom.wait` support custom JavaScript conditions? (e.g., "wait until element has class X")
- ❓ Do we need `--poll-interval` or is 500ms always reasonable?
- ❓ Should screenshot highlighting persist or clear immediately?
- ❓ Full page screenshots: Auto-scroll behavior? (may need M2)

### Decisions Needed
- Week 0 findings may reveal additional wrapper needs
- Monitor agent feedback during implementation
- Be willing to cut features if raw CDP proves sufficient

---

## Next Steps After M1

1. Review agent feedback on documentation and wrappers
2. Identify missing patterns from AGENT_WORKFLOWS.md
3. Plan M2: Network Foundation with similar approach
4. Consider adding more CDP domain wrappers based on usage data

---

## References

- Detailed implementation guide: [M1_IMPLEMENTATION_GUIDE.md](M1_IMPLEMENTATION_GUIDE.md)
- [CDP Protocol Viewer](https://chromedevtools.github.io/devtools-protocol/)
- [Square's Semantic Exit Codes](https://developer.squareup.com/blog/command-line-observability-with-semantic-exit-codes/)
- Current implementation: `src/commands/dom.ts`, `src/daemon/worker.ts`
