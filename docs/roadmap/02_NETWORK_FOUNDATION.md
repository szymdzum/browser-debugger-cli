# 02: Network Foundation

**Target Version**: v0.5.0  
**Timeline**: Weeks 3-8  
**Status**: 🔜 Planned

## Philosophy

Most network operations work via raw CDP. Only wrap stateful operations (streaming, HAR transformation) and document the rest.

## Overview

Build network telemetry and inspection capabilities:
- **Stateful wrappers** for complex operations (event streaming, HAR export)
- **CDP documentation** for simple operations (cache control, throttling, blocking)
- **Example workflows** showing real-world network debugging

## Deliverables

### 1. Stateful Wrapper: `net.capture`

**Why**: Streaming network events to file requires lifecycle management

**Commands**:
- `bdg net.capture start --file <out.ndjson>` - Start capturing network events
- `bdg net.capture stop` - Stop capturing

**Features**:
- Stream events to NDJSON file as they occur (no memory buffering)
- Capture all network events: `requestWillBeSent`, `responseReceived`, `loadingFinished`, `loadingFailed`
- Automatic file rotation if size exceeds threshold
- Resume capability (append to existing file)

**Options**:
- `--file <path>` - Output file path (required for start)
- `--max-size <MB>` - Rotate file at size (default: 100MB)
- `--filter <pattern>` - Filter URLs by pattern (e.g., `*.example.com`)
- `--include-bodies` - Fetch request/response bodies (slow)

**Examples**:
```bash
# Start capturing
bdg net.capture start --file requests.ndjson

# Start with filtering
bdg net.capture start --file api-only.ndjson --filter '*/api/*'

# Stop capturing
bdg net.capture stop
```

**Output** (start):
```json
{
  "success": true,
  "data": {
    "file": "/path/to/requests.ndjson",
    "started": "2025-11-06T12:00:00Z"
  }
}
```

**NDJSON format** (streamed to file):
```json
{"type":"request","id":"req_1","url":"https://example.com","method":"GET","timestamp":"2025-11-06T12:00:01Z"}
{"type":"response","id":"req_1","status":200,"headers":{...},"timestamp":"2025-11-06T12:00:02Z"}
{"type":"finished","id":"req_1","bytesReceived":1234,"timestamp":"2025-11-06T12:00:03Z"}
```

**Implementation**:
- Worker maintains file handle and writes events as they arrive
- IPC messages: `start-network-capture`, `stop-network-capture`
- Handle file errors gracefully (disk full, permissions)

**Acceptance**:
- [ ] Streams events to NDJSON file
- [ ] File rotation works at size threshold
- [ ] Filtering by URL pattern works
- [ ] Stop command closes file and flushes buffers
- [ ] Integration tests verify file contents

---

### 2. Stateful Wrapper: `net.har`

**Why**: HAR format transformation is complex (timing calculations, nested structure)

**Command**: `bdg net.har --out <file.har> [--input <capture.ndjson>]`

**Purpose**: Transform captured network events into HAR (HTTP Archive) format

**Modes**:
- **Live mode** (no `--input`): Export current session's network data
- **Post-processing** (with `--input`): Transform NDJSON file to HAR

**Options**:
- `--out <file.har>` - Output HAR file path (required)
- `--input <file.ndjson>` - Input NDJSON file (optional, uses live data if omitted)
- `--include-bodies` - Include request/response bodies in HAR
- `--pretty` - Pretty-print JSON (default: false)

**Examples**:
```bash
# Export live session to HAR
bdg net.har --out session.har

# Transform captured NDJSON to HAR
bdg net.har --input requests.ndjson --out archive.har --pretty

# Include response bodies
bdg net.har --out full.har --include-bodies
```

**Output**:
```json
{
  "success": true,
  "data": {
    "file": "/path/to/session.har",
    "entries": 142,
    "size": 456789
  }
}
```

**HAR format** (follows [HAR 1.2 spec](http://www.softwareishard.com/blog/har-12-spec/)):
```json
{
  "log": {
    "version": "1.2",
    "creator": {
      "name": "browser-debugger-cli",
      "version": "0.5.0"
    },
    "entries": [
      {
        "startedDateTime": "2025-11-06T12:00:00Z",
        "time": 234,
        "request": { ... },
        "response": { ... },
        "timings": { ... }
      }
    ]
  }
}
```

**Implementation**:
- Parse NDJSON and group by request ID
- Calculate timing fields (wait, receive, send)
- Transform to HAR structure
- Optionally fetch bodies via CDP if `--include-bodies`

**Acceptance**:
- [ ] Produces valid HAR 1.2 format
- [ ] Timing calculations are correct
- [ ] Can import into Chrome DevTools
- [ ] Post-processing mode works with NDJSON input
- [ ] Integration tests verify HAR structure

---

### 3. CDP Documentation Patterns

**Purpose**: Show agents how to use raw CDP for common network operations

**Patterns to document** in `docs/AGENT_WORKFLOWS.md`:

#### Cache Control
```bash
# Disable cache
bdg cdp Network.enable
bdg cdp Network.setCacheDisabled '{"cacheDisabled": true}'

# Clear cache
bdg cdp Network.clearBrowserCache

# Verify cache headers
bdg peek --network | jq '.[] | select(.response.headers."cache-control")'
```

#### Network Throttling
```bash
# Apply preset throttling
bdg cdp Network.enable
bdg cdp Network.emulateNetworkConditions '{
  "offline": false,
  "latency": 100,
  "downloadThroughput": 750000,
  "uploadThroughput": 250000
}'

# Presets: slow-3g, fast-3g, offline
# slow-3g: latency=400, down=400000, up=400000
# fast-3g: latency=100, down=1500000, up=750000
# offline: offline=true
```

#### Request Blocking
```bash
# Block URL patterns
bdg cdp Network.enable
bdg cdp Network.setBlockedURLs '{"urls": ["*analytics*", "*tracking*"]}'

# Unblock
bdg cdp Network.setBlockedURLs '{"urls": []}'
```

#### Custom Headers
```bash
# Set extra headers
bdg cdp Network.enable
bdg cdp Network.setExtraHTTPHeaders '{
  "headers": {
    "X-Custom-Header": "value"
  }
}'
```

#### Cookies Management
```bash
# Get all cookies
bdg cdp Network.getCookies

# Get cookies for URL
bdg cdp Network.getCookies '{"urls": ["https://example.com"]}'

# Set cookie
bdg cdp Network.setCookie '{
  "name": "session",
  "value": "abc123",
  "domain": "example.com",
  "path": "/"
}'

# Delete cookie
bdg cdp Network.deleteCookies '{"name": "session", "domain": "example.com"}'
```

**Acceptance**:
- [ ] All patterns documented with examples
- [ ] Examples include error handling
- [ ] Patterns tested in CI
- [ ] Clear explanations of when to use each pattern

---

### 4. Human-Friendly Commands (Future)

**Note**: These are NOT part of M2 but planned for future milestones

**Preview of future commands**:
```bash
# List captured requests (human-readable)
bdg net.ls [--filter <pattern>] [--group-by <field>]

# Show detailed request
bdg net.show --id <request-id> [--waterfall]

# Cache commands
bdg net.cache --disable|--enable
bdg net.clear-cache

# Throttling presets
bdg net.throttle <slow-3g|fast-3g|offline>

# Blocking helpers
bdg net.block --url-pattern <pattern>
bdg net.unblock --url-pattern <pattern>
```

**Why defer?** Validate that raw CDP + wrappers are sufficient first. Add human commands only if there's proven demand.

---

### 5. Example Scripts: `examples/agents/`

**Scripts**:

#### 1. `network-capture-full.sh`
Capture all network traffic for a session:
```bash
#!/bin/bash
bdg start https://example.com
bdg net.capture start --file session.ndjson
# Perform actions...
bdg page.navigate https://example.com/page2
bdg net.capture stop
bdg net.har --input session.ndjson --out session.har --pretty
bdg stop
```

#### 2. `network-filter-api.sh`
Capture only API requests:
```bash
#!/bin/bash
bdg start https://app.example.com
bdg net.capture start --file api-only.ndjson --filter '*/api/*'
# Interact with app...
bdg net.capture stop
cat api-only.ndjson | jq -s 'group_by(.url) | map({url: .[0].url, count: length})'
```

#### 3. `cache-debugging.sh`
Debug cache behavior:
```bash
#!/bin/bash
bdg start https://example.com

# Request with cache
bdg page.navigate https://example.com/data
bdg peek --network --last 1 | jq '.[] | {url, cached: .response.fromCache}'

# Disable cache and retry
bdg cdp Network.setCacheDisabled '{"cacheDisabled": true}'
bdg page.navigate https://example.com/data
bdg peek --network --last 1 | jq '.[] | {url, cached: .response.fromCache}'

bdg stop
```

#### 4. `throttle-testing.sh`
Test under slow network conditions:
```bash
#!/bin/bash
bdg start https://example.com

# Apply slow 3G throttling
bdg cdp Network.enable
bdg cdp Network.emulateNetworkConditions '{
  "offline": false,
  "latency": 400,
  "downloadThroughput": 400000,
  "uploadThroughput": 400000
}'

bdg page.navigate https://example.com
bdg net.har --out slow-3g.har

bdg stop
```

#### 5. `block-tracking.sh`
Block analytics and tracking:
```bash
#!/bin/bash
bdg start https://example.com

# Block tracking domains
bdg cdp Network.enable
bdg cdp Network.setBlockedURLs '{
  "urls": ["*analytics*", "*tracking*", "*ads*", "*facebook.com/tr*"]
}'

bdg page.navigate https://example.com
bdg peek --network | jq '.[] | select(.status == null) | .url'

bdg stop
```

**Acceptance**:
- [ ] All 5 scripts run successfully in CI
- [ ] Each script demonstrates a real debugging scenario
- [ ] Scripts show error handling
- [ ] Output is parseable and useful

---

## Testing Strategy

### Integration Tests
Test stateful wrappers end-to-end:
```typescript
describe('net.capture', () => {
  it('streams events to NDJSON file', async () => {
    await page.goto('http://localhost:3000/test.html');
    execSync('bdg net.capture start --file test.ndjson');
    await page.reload();
    execSync('bdg net.capture stop');
    
    const events = readNDJSON('test.ndjson');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toHaveProperty('type', 'request');
  });
});

describe('net.har', () => {
  it('produces valid HAR format', async () => {
    const result = execSync('bdg net.har --out test.har');
    const har = JSON.parse(readFile('test.har'));
    
    expect(har).toHaveProperty('log.version', '1.2');
    expect(har.log.entries).toBeInstanceOf(Array);
    expect(har.log.entries[0]).toHaveProperty('request');
    expect(har.log.entries[0]).toHaveProperty('response');
  });
});
```

### CDP Pattern Tests
Verify CDP patterns work:
```bash
# Test cache disable
bdg cdp Network.enable
bdg cdp Network.setCacheDisabled '{"cacheDisabled": true}'
bdg page.navigate https://httpbin.org/cache
bdg peek --network --last 1 | jq -e '.[] | .request.headers."Cache-Control" == "no-cache"'
```

### HAR Validation
Use external tools to validate HAR:
```bash
# Validate HAR against spec
har-validator test.har

# Import into Chrome DevTools and verify
chromium --load-extension=./har-loader test.har
```

---

## Success Criteria

### Stateful Wrappers (Week 4-5)
- [ ] `net.capture start|stop` streams to NDJSON
- [ ] File rotation works at size threshold
- [ ] Filtering by URL pattern works
- [ ] `net.har` produces valid HAR 1.2 format
- [ ] HAR can be imported into Chrome DevTools
- [ ] Integration tests pass

### CDP Documentation (Week 6)
- [ ] Cache control patterns documented
- [ ] Throttling presets documented with examples
- [ ] Request blocking patterns documented
- [ ] Cookie management patterns documented
- [ ] All patterns tested in CI

### Examples (Week 7)
- [ ] 5 example scripts in `examples/agents/`
- [ ] Scripts demonstrate real debugging workflows
- [ ] All scripts run in CI
- [ ] Documentation references scripts

### Quality Gates (Week 8)
- [ ] `npm run check:enhanced` passes
- [ ] Test coverage >80% for new code
- [ ] All TSDoc comments complete
- [ ] No breaking changes to v0.4.0 commands
- [ ] HAR export validated against spec

---

## Implementation Order

### Week 3-4: Planning & Foundation
1. Design NDJSON event schema
2. Design HAR export transformation
3. Set up test fixtures (local HTTP server)
4. Write integration test framework

### Week 4-5: `net.capture` Implementation
1. Add IPC messages for start/stop capture
2. Implement file streaming in worker
3. Add URL filtering logic
4. Implement file rotation
5. Write integration tests
6. Document in CLI reference

### Week 5-6: `net.har` Implementation
1. Implement NDJSON to HAR transformation
2. Calculate timing fields correctly
3. Add live mode (export current session)
4. Add post-processing mode (from NDJSON file)
5. Validate HAR output against spec
6. Write integration tests

### Week 6-7: CDP Documentation
1. Document cache control patterns
2. Document throttling presets
3. Document request blocking
4. Document cookie management
5. Add patterns to AGENT_WORKFLOWS.md
6. Test all patterns in CI

### Week 7-8: Examples & Polish
1. Write 5 example scripts
2. Add scripts to CI
3. Final documentation review
4. Performance testing (large sessions)
5. Release v0.5.0

---

## Open Questions

### Pending
- ❓ NDJSON vs JSON Lines: Which format? (recommend NDJSON)
- ❓ File rotation: Keep old files or overwrite? (keep with numeric suffix)
- ❓ HAR bodies: Fetch automatically or require flag? (require `--include-bodies`)
- ❓ Should `net.capture` support multiple concurrent captures? (defer to M3)

### Decisions Needed
- Max file size default: 100MB or 500MB?
- NDJSON event schema: Minimal or full CDP event?
- HAR export: Include `_` fields (Chrome extensions) or strict spec only?

---

## Dependencies

**Required**:
- M1 completed (schema v0, `dom.wait`, `page.screenshot`)
- CDP `Network` domain enabled
- Worker can handle file I/O

**Blocked by**: None

---

## Next Steps After M2

1. Gather feedback on network capture workflows
2. Identify missing network debugging patterns
3. Evaluate need for human-friendly `net.ls`, `net.show` commands
4. Plan M3: Human DOM Beta features

---

## References

- [HAR 1.2 Spec](http://www.softwareishard.com/blog/har-12-spec/)
- [Network domain (CDP)](https://chromedevtools.github.io/devtools-protocol/tot/Network/)
- NDJSON format: http://ndjson.org/
- Current network implementation: `src/telemetry/network.ts`
