# 02a: Network Capture (net.capture)

**Parent Milestone**: [02_NETWORK_FOUNDATION.md](02_NETWORK_FOUNDATION.md)  
**Target Version**: v0.5.0  
**Timeline**: Weeks 3-5 (2 weeks)  
**Branch**: `feat/net-capture`  
**Status**: 🔜 Planned

## Overview

Build stateful wrapper for streaming network events to NDJSON file with lifecycle management.

## Goal

Enable capturing all network traffic to a file during a session, with filtering and file rotation support.

## Deliverable

### Command: `net.capture start|stop`

**Start capturing**:
```bash
bdg net.capture start --file <out.ndjson> [--max-size <MB>] [--filter <pattern>]
```

**Stop capturing**:
```bash
bdg net.capture stop
```

## Features

### Event Streaming
- Stream network events to NDJSON file as they occur (no buffering)
- Capture all CDP Network events:
  - `Network.requestWillBeSent`
  - `Network.responseReceived`
  - `Network.loadingFinished`
  - `Network.loadingFailed`
- One JSON object per line (NDJSON format)
- Append-only file writes

### File Management
- Automatic file rotation when size exceeds threshold
- Rotated files: `capture.ndjson` → `capture.1.ndjson` → `capture.2.ndjson`
- Resume capability (append to existing file if not rotated)
- Handle file errors gracefully (disk full, permissions)

### Filtering
- Filter by URL pattern (e.g., `*/api/*`, `*.example.com`)
- Support wildcards (`*`) in patterns
- Include/exclude logic

### Options

- `--file <path>` - Output file path (required for start)
- `--max-size <MB>` - Rotate file at size (default: 100MB)
- `--filter <pattern>` - Filter URLs by pattern
- `--include-bodies` - Fetch request/response bodies (slow, off by default)

## Examples

```bash
# Basic capture
bdg net.capture start --file requests.ndjson

# With filtering
bdg net.capture start --file api-only.ndjson --filter '*/api/*'

# With file rotation
bdg net.capture start --file capture.ndjson --max-size 50

# Stop capturing
bdg net.capture stop
```

## Output

**Start command output**:
```json
{
  "success": true,
  "data": {
    "file": "/path/to/requests.ndjson",
    "started": "2025-11-06T12:00:00Z",
    "filter": "*/api/*",
    "maxSizeMB": 100
  }
}
```

**Stop command output**:
```json
{
  "success": true,
  "data": {
    "file": "/path/to/requests.ndjson",
    "stopped": "2025-11-06T12:05:00Z",
    "eventsWritten": 1234,
    "filesCreated": 2,
    "totalSizeMB": 45.6
  }
}
```

**NDJSON file format** (streamed to file):
```json
{"type":"request","id":"req_1","url":"https://example.com/api/data","method":"GET","timestamp":"2025-11-06T12:00:01.234Z","headers":{...}}
{"type":"response","id":"req_1","status":200,"statusText":"OK","timestamp":"2025-11-06T12:00:02.456Z","headers":{...}}
{"type":"finished","id":"req_1","bytesReceived":1234,"timestamp":"2025-11-06T12:00:03.789Z"}
{"type":"request","id":"req_2","url":"https://example.com/api/users","method":"POST","timestamp":"2025-11-06T12:00:04.012Z","headers":{...}}
```

## Implementation Details

### IPC Messages

Add to `src/ipc/types.ts`:
```typescript
| { type: 'start-network-capture'; file: string; maxSizeMB?: number; filter?: string; includeBodies?: boolean }
| { type: 'stop-network-capture' }
```

### Worker Changes

In `src/daemon/worker.ts`:
- Maintain file handle for NDJSON output
- Register CDP Network event listeners
- Write events to file as they arrive (no buffering)
- Track file size and rotate when threshold exceeded
- Close file handle on stop

### File Streaming

```typescript
class NetworkCaptureWriter {
  private fileHandle: fs.promises.FileHandle;
  private currentSizeMB: number = 0;
  private eventsWritten: number = 0;
  
  async writeEvent(event: NetworkEvent): Promise<void> {
    const json = JSON.stringify(event) + '\n';
    await this.fileHandle.write(json);
    this.currentSizeMB += Buffer.byteLength(json) / 1024 / 1024;
    this.eventsWritten++;
    
    if (this.currentSizeMB >= this.maxSizeMB) {
      await this.rotate();
    }
  }
  
  async rotate(): Promise<void> {
    // Rename current file, open new one
    // capture.ndjson -> capture.1.ndjson
  }
}
```

### Event Transformation

Transform CDP events to simplified format:
```typescript
function transformNetworkEvent(cdpEvent: Protocol.Network.Event): NetworkEvent {
  switch (cdpEvent.method) {
    case 'Network.requestWillBeSent':
      return {
        type: 'request',
        id: cdpEvent.params.requestId,
        url: cdpEvent.params.request.url,
        method: cdpEvent.params.request.method,
        headers: cdpEvent.params.request.headers,
        timestamp: new Date().toISOString()
      };
    // ... other events
  }
}
```

### URL Filtering

```typescript
function matchesFilter(url: string, pattern: string): boolean {
  // Convert pattern to regex: */api/* -> ^.*/api/.*$
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return regex.test(url);
}
```

## Testing Strategy

### Integration Tests

```typescript
describe('net.capture', () => {
  it('streams events to NDJSON file', async () => {
    execSync('bdg start https://httpbin.org');
    execSync('bdg net.capture start --file test.ndjson');
    
    // Trigger some requests
    execSync('bdg page.navigate https://httpbin.org/get');
    
    execSync('bdg net.capture stop');
    
    const events = readNDJSONFile('test.ndjson');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toHaveProperty('type', 'request');
    expect(events[0]).toHaveProperty('url');
  });
  
  it('filters URLs by pattern', async () => {
    execSync('bdg start https://example.com');
    execSync('bdg net.capture start --file filtered.ndjson --filter "*/api/*"');
    
    // Trigger mixed requests
    execSync('bdg page.navigate https://example.com/page'); // filtered out
    execSync('bdg page.navigate https://example.com/api/data'); // captured
    
    execSync('bdg net.capture stop');
    
    const events = readNDJSONFile('filtered.ndjson');
    const urls = events.filter(e => e.type === 'request').map(e => e.url);
    expect(urls.every(url => url.includes('/api/'))).toBe(true);
  });
  
  it('rotates file at size threshold', async () => {
    execSync('bdg start https://httpbin.org');
    execSync('bdg net.capture start --file rotate.ndjson --max-size 1'); // 1MB
    
    // Generate lots of requests
    for (let i = 0; i < 1000; i++) {
      execSync('bdg page.navigate https://httpbin.org/bytes/10000');
    }
    
    execSync('bdg net.capture stop');
    
    // Check that files were rotated
    expect(fs.existsSync('rotate.ndjson')).toBe(true);
    expect(fs.existsSync('rotate.1.ndjson')).toBe(true);
  });
});
```

### Error Handling Tests

```typescript
describe('net.capture error handling', () => {
  it('handles disk full error gracefully', async () => {
    // Mock fs.write to throw ENOSPC
    const result = execSync('bdg net.capture start --file full.ndjson', { reject: false });
    expect(result.exitCode).toBe(EXIT_CODES.RESOURCE_ERROR);
    expect(result.stderr).toContain('disk full');
  });
  
  it('handles permission denied', async () => {
    // Try writing to read-only location
    const result = execSync('bdg net.capture start --file /read-only/file.ndjson', { reject: false });
    expect(result.exitCode).toBe(EXIT_CODES.PERMISSION_DENIED);
  });
});
```

### File Format Tests

```typescript
describe('NDJSON format', () => {
  it('produces valid NDJSON', async () => {
    execSync('bdg start https://example.com');
    execSync('bdg net.capture start --file valid.ndjson');
    execSync('bdg page.navigate https://example.com');
    execSync('bdg net.capture stop');
    
    const lines = fs.readFileSync('valid.ndjson', 'utf-8').split('\n').filter(Boolean);
    
    lines.forEach(line => {
      expect(() => JSON.parse(line)).not.toThrow();
    });
  });
});
```

## Success Criteria

- [ ] `net.capture start` begins streaming to file
- [ ] Events written as they occur (no buffering)
- [ ] NDJSON format is valid (one JSON per line)
- [ ] URL filtering works with wildcard patterns
- [ ] File rotation works at size threshold
- [ ] `net.capture stop` closes file cleanly
- [ ] Handles file errors gracefully (disk full, permissions)
- [ ] Integration tests pass
- [ ] Documentation complete
- [ ] Exit codes follow semantic conventions

## Implementation Checklist

### Week 3: Foundation
- [ ] Add IPC message types
- [ ] Create `NetworkCaptureWriter` class
- [ ] Implement NDJSON streaming
- [ ] Add event transformation logic

### Week 4: Features
- [ ] Implement URL filtering
- [ ] Implement file rotation
- [ ] Add error handling (disk full, permissions)
- [ ] Handle start/stop lifecycle

### Week 5: Testing & Polish
- [ ] Write integration tests
- [ ] Test file rotation with large sessions
- [ ] Test URL filtering with various patterns
- [ ] Add CLI documentation
- [ ] Update AGENT_WORKFLOWS.md

## Dependencies

**Required**:
- Worker IPC infrastructure
- CDP Network domain enabled
- File system access from worker

**Blocks**:
- [02b_network_har.md](02b_network_har.md) - HAR export needs NDJSON input

## Open Questions

- ❓ File rotation: Keep old files or delete? → **Keep with numeric suffix**
- ❓ Max file size default: 100MB or 500MB? → **100MB (configurable)**
- ❓ Resume behavior: Append or overwrite? → **Overwrite by default, add `--append` flag?**
- ❓ Include bodies by default or opt-in? → **Opt-in via `--include-bodies`**

## Related Files

- `src/commands/net.ts` - Command implementation
- `src/daemon/worker.ts` - Worker event handling
- `src/ipc/types.ts` - IPC message types
- `src/telemetry/network.ts` - Existing network collector (reference)

## Example Script

After implementation, add to `examples/agents/`:

```bash
#!/bin/bash
# network-capture-full.sh
# Capture all network traffic for a session

bdg start https://example.com

# Start capturing
bdg net.capture start --file session.ndjson

# Perform actions...
bdg page.navigate https://example.com/page1
sleep 2
bdg page.navigate https://example.com/page2
sleep 2

# Stop capturing
bdg net.capture stop

# Analyze captured data
echo "Total requests:"
cat session.ndjson | jq -s 'map(select(.type == "request")) | length'

echo "Unique domains:"
cat session.ndjson | jq -s 'map(select(.type == "request") | .url) | map(split("/")[2]) | unique'

bdg stop
```

## References

- [NDJSON Specification](http://ndjson.org/)
- [Network domain (CDP)](https://chromedevtools.github.io/devtools-protocol/tot/Network/)
- Parent milestone: [02_NETWORK_FOUNDATION.md](02_NETWORK_FOUNDATION.md)
