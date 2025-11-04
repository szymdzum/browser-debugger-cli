# Refactor: IPC-Based Live Data Streaming

**Branch:** `refactor/ipc-streaming-data-access`  
**Status:** Planning Complete, Ready for Implementation  
**Priority:** High - Removes dead code, simplifies architecture, improves performance

---

## Executive Summary

### The Problem

Current architecture uses a **hybrid file + socket system** that is inefficient and incomplete:

- **Worker** writes `session.preview.json` (360KB) + `session.full.json` (87MB) to disk every 5 seconds
- **Daemon** reads these files from disk and proxies them over IPC
- **CLI** reads files directly (`bdg details`) or via daemon proxy (`bdg peek`)

**Result:** IPC infrastructure exists but acts as a dumb file proxy instead of live data streaming.

### The Solution

Complete the IPC migration by:

1. Add `worker_peek` and `worker_details` IPC commands
2. Worker responds with live in-memory data (no file writes)
3. Daemon proxies these commands like existing DOM commands
4. CLI uses IPC exclusively (no file reads)
5. Remove file-based preview system (~500-800 lines)

### Benefits

✅ **Performance:** No blocking 5-second file writes (87MB + 360KB)  
✅ **Latency:** Instant peek responses (no disk I/O)  
✅ **Simplicity:** Single IPC path, no hybrid file+socket  
✅ **Memory:** No duplicate serialization for file writes  
✅ **Maintainability:** ~500-800 lines of dead code removed

---

## Current Architecture Analysis

### Data Flow (Hybrid File+Socket)

```
┌─────────┐     ┌──────────┐     ┌──────────┐     ┌─────┐
│ Worker  │────▶│   Disk   │────▶│  Daemon  │────▶│ CLI │
│         │     │  Files   │     │  (proxy) │     │     │
└─────────┘     └──────────┘     └──────────┘     └─────┘
   5s writes     .preview.json      reads file      peek
   blocking      .full.json         over IPC
```

**Problems:**
- Worker has data in memory but writes to disk unnecessarily
- Daemon reads stale files instead of querying worker
- CLI bypasses IPC for `details` command (direct file read)
- Preview loop blocks event loop every 5 seconds

### IPC Infrastructure (80% Complete)

**✅ Working:**
- Daemon ↔ Worker: stdin/stdout JSONL protocol
- CLI ↔ Daemon: Unix socket JSONL protocol  
- Command routing: `dom_query`, `dom_highlight`, `dom_get`
- Request correlation: requestId + pending map + timeout

**❌ Missing:**
- Worker handlers for `worker_peek` and `worker_details`
- Daemon proxy for peek/details (currently reads files)
- CLI integration with IPC for details (currently reads files)

---

## Target Architecture

### Data Flow (Pure IPC Streaming)

```
┌─────────┐     ┌──────────┐     ┌─────┐
│ Worker  │────▶│  Daemon  │────▶│ CLI │
│ (live)  │ IPC │  (proxy) │ IPC │     │
└─────────┘     └──────────┘     └─────┘
  in-memory     stdin/stdout      Unix socket
  no files      correlation       instant
```

**Benefits:**
- Worker responds in <10ms (no disk I/O)
- Daemon just proxies (no file reads)
- CLI gets live data (no stale snapshots)
- No file pollution in ~/.bdg/

---

## Implementation Plan

### Phase 1: Define IPC Contracts

**File:** `src/ipc/commands.ts`

Add two new commands to the registry:

```typescript
export const COMMANDS = {
  // ... existing dom_query, dom_highlight, dom_get
  
  worker_peek: {
    requestSchema: {} as WorkerPeekCommand,
    responseSchema: {} as WorkerPeekData,
  },
  
  worker_details: {
    requestSchema: {} as WorkerDetailsCommand,
    responseSchema: {} as WorkerDetailsData,
  },
} as const;
```

**Types:**

```typescript
// Lightweight preview (metadata only)
export interface WorkerPeekCommand {
  lastN?: number; // Optional: limit to last N items (default: 10)
}

export interface WorkerPeekData {
  version: string;
  startTime: number;
  duration: number;
  target: {
    url: string;
    title: string;
  };
  activeCollectors: CollectorType[];
  network: Array<{
    requestId: string;
    timestamp: number;
    method: string;
    url: string;
    status?: number;
    contentType?: string;
    // NO bodies/headers (lightweight)
  }>;
  console: Array<{
    timestamp: number;
    type: string;
    message: string;
    // NO args/stack (lightweight)
  }>;
}

// Full object with bodies/args
export interface WorkerDetailsCommand {
  type: 'network' | 'console';
  id: string; // requestId for network, index for console
}

export interface WorkerDetailsData {
  item: NetworkRequest | ConsoleMessage; // Full object
}
```

**Decision:** Do NOT add `worker_peek_full` (redundant with multiple details calls)

---

### Phase 2: Implement Worker Handlers

**File:** `src/daemon/worker.ts`

Add to `commandHandlers` object:

```typescript
const commandHandlers: { [K in CommandName]: CommandHandler<K> } = {
  // ... existing dom handlers
  
  worker_peek: async (cdp, params) => {
    const lastN = params.lastN ?? 10;
    const duration = Date.now() - sessionStartTime;
    
    // Get last N items (slice from end)
    const recentNetwork = networkRequests.slice(-lastN).map(req => ({
      requestId: req.requestId,
      timestamp: req.timestamp,
      method: req.method,
      url: req.url,
      status: req.status,
      contentType: req.contentType,
      // Strip bodies/headers
    }));
    
    const recentConsole = consoleMessages.slice(-lastN).map(msg => ({
      timestamp: msg.timestamp,
      type: msg.type,
      message: msg.message,
      // Strip args/stack
    }));
    
    return {
      version: VERSION,
      startTime: sessionStartTime,
      duration,
      target: {
        url: targetInfo?.url ?? '',
        title: targetInfo?.title ?? '',
      },
      activeCollectors,
      network: recentNetwork,
      console: recentConsole,
    };
  },
  
  worker_details: async (cdp, params) => {
    if (params.type === 'network') {
      const request = networkRequests.find(r => r.requestId === params.id);
      if (!request) {
        throw new Error(`Network request not found: ${params.id}`);
      }
      return { item: request };
      
    } else if (params.type === 'console') {
      const index = parseInt(params.id);
      if (isNaN(index) || index < 0 || index >= consoleMessages.length) {
        throw new Error(`Console message not found: ${params.id}`);
      }
      return { item: consoleMessages[index] };
      
    } else {
      throw new Error(`Unknown type: ${params.type}`);
    }
  },
};
```

**Performance notes:**
- Peek: O(1) slice from end, no full array iteration
- Details: O(n) linear search (acceptable for <10k items)
- Future optimization: maintain requestId → index map if needed

---

### Phase 3: Proxy Commands in Daemon

**File:** `src/daemon/ipcServer.ts`

**Current (broken):**
```typescript
private handlePeekRequest(socket: Socket, request: PeekRequest): void {
  // ❌ Reads stale file from disk
  const previewData = readPartialOutput();
  socket.write(JSON.stringify({ data: { preview: previewData } }));
}
```

**New (live IPC):**
```typescript
private handlePeekRequest(socket: Socket, request: PeekRequest): void {
  console.error(`[daemon] Peek request received (sessionId: ${request.sessionId})`);
  
  // Check for active session
  if (!this.workerProcess?.stdin) {
    const response: PeekResponse = {
      type: 'peek_response',
      sessionId: request.sessionId,
      status: 'error',
      error: 'No active worker process',
    };
    socket.write(JSON.stringify(response) + '\n');
    return;
  }
  
  // Forward to worker via IPC
  const requestId = `worker_peek_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const timeout = setTimeout(() => {
    this.pendingWorkerRequests.delete(requestId);
    const response: PeekResponse = {
      type: 'peek_response',
      sessionId: request.sessionId,
      status: 'error',
      error: 'Worker response timeout (5s)',
    };
    socket.write(JSON.stringify(response) + '\n');
  }, 5000);
  
  this.pendingWorkerRequests.set(requestId, { socket, sessionId: request.sessionId, timeout });
  
  const workerRequest: WorkerRequest<'worker_peek'> = {
    type: 'worker_peek_request',
    requestId,
    lastN: 10, // Could extract from request params
  };
  
  this.workerProcess.stdin.write(JSON.stringify(workerRequest) + '\n');
  console.error(`[daemon] Forwarded worker_peek_request to worker (requestId: ${requestId})`);
}
```

**Add new handler:**
```typescript
private handleDetailsRequest(socket: Socket, request: DetailsRequest): void {
  // Similar structure to handlePeekRequest
  // Forward worker_details_request to worker
  // Correlate response via requestId
}
```

**Update message routing:**
```typescript
private handleMessage(socket: Socket, data: Buffer): void {
  // ... existing routing
  
  if (request.type === 'peek_request') {
    this.handlePeekRequest(socket, request as PeekRequest);
  } else if (request.type === 'details_request') {
    this.handleDetailsRequest(socket, request as DetailsRequest);
  }
  // ...
}
```

---

### Phase 4: Extend IPC Client

**File:** `src/ipc/client.ts`

Add new function:

```typescript
/**
 * Request details for a specific network request or console message.
 */
export async function getDetails(
  type: 'network' | 'console',
  id: string
): Promise<DetailsResponse> {
  const request: DetailsRequest = {
    type: 'details_request',
    sessionId: randomUUID(),
    itemType: type,
    itemId: id,
  };
  
  return sendRequest<DetailsRequest, DetailsResponse>(request, 'details');
}
```

Update `getPeek` if needed to accept options:

```typescript
export async function getPeek(options?: { lastN?: number }): Promise<PeekResponse> {
  const request: PeekRequest = {
    type: 'peek_request',
    sessionId: randomUUID(),
    ...(options?.lastN && { lastN: options.lastN }),
  };
  
  return sendRequest<PeekRequest, PeekResponse>(request, 'peek');
}
```

---

### Phase 5: Update CLI Commands

**File:** `src/cli/commands/peek.ts`

**Before:**
```typescript
// Reads file via daemon proxy
const response = await getPeek();
const output = response.data?.preview as BdgOutput;
```

**After:**
```typescript
// Live IPC, no files
const response = await getPeek({ lastN: parseInt(options.last) });
const output = response.data?.preview as BdgOutput;
// Same formatting, transparent to user
```

**File:** `src/cli/commands/details.ts`

**Before:**
```typescript
// ❌ Reads 87MB file directly from disk
const fullOutput = readFullOutput();
const request = fullOutput.data.network?.find(req => req.requestId === id);
```

**After:**
```typescript
// ✅ Live IPC query
const response = await getDetails(type, id);
if (response.status === 'error') {
  console.error(response.error);
  process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
}
const item = response.data?.item;
// Same formatting, transparent to user
```

---

### Phase 6: Remove File-Based Preview System

**Files to delete:**
- `src/cli/handlers/PreviewWriter.ts` (entire file)

**Files to modify:**

**`src/session/output.ts`**
```typescript
// Remove:
- writePartialOutputAsync()
- writeFullOutputAsync()
- readPartialOutput()
- readFullOutput()

// Keep (temporarily):
- writeSessionOutput() // For final session.json on shutdown
```

**`src/session/paths.ts`**
```typescript
// Remove:
- getPartialFilePath()
- getFullFilePath()

// Keep:
- getSessionFilePath('OUTPUT') // Temporary
```

**`src/daemon/worker.ts`**
```typescript
// Remove:
- startPreviewLoop() function
- previewInterval variable
- clearInterval(previewInterval) in cleanup

// Remove from gracefulShutdown:
- await writePartialOutputAsync(finalOutput)
- await writeFullOutputAsync(finalOutput)

// Keep:
- await writeSessionOutput(finalOutput) // Temporary for final output
```

**`src/cli/handlers/daemonSessionController.ts`**
```typescript
// Remove:
- import { PreviewWriter } from '@/cli/handlers/PreviewWriter.js'
- All PreviewWriter instantiation/usage
```

**`src/session/cleanup.ts`**
```typescript
// Remove from cleanupSession():
- Deletion of session.preview.json
- Deletion of session.full.json

// Keep:
- session.pid, session.lock, session.meta.json cleanup
- session.json cleanup (temporary)
```

---

### Phase 7: Update Documentation

**`WARP.md` / `CLAUDE.md`**

Remove sections:
- "Two-Tier Preview System"
- References to `session.preview.json` (360KB)
- References to `session.full.json` (87MB)
- "241x smaller" metrics
- `PreviewWriter` class descriptions

Add section:
```markdown
## Live Data Access via IPC

**Commands:**
- `bdg peek` - Fetches last N network requests + console messages from worker via IPC
- `bdg details network <id>` - Fetches full request with bodies/headers via IPC
- `bdg details console <index>` - Fetches full console message with args/stack via IPC

**Architecture:**
- Worker holds data in memory (no file writes during collection)
- Daemon proxies peek/details requests to worker over stdin/stdout
- CLI queries daemon over Unix socket
- Instant responses (<10ms), no disk I/O

**Session Files:**
- `session.pid` - Worker process ID
- `session.lock` - Lock file for concurrency control
- `session.meta.json` - Session metadata (port, Chrome PID, target info)
- `session.json` - Final output written on session stop (temporary, see Stage 2)
```

**README.md**

Update quickstart examples:
```bash
# Start collection
bdg localhost:3000

# Live preview (queries worker via daemon)
bdg peek
bdg peek --last 50

# Detailed inspection (queries worker via daemon)
bdg details network 12345.678
bdg details console 42

# Stop and get final output
bdg stop
```

---

## Testing Strategy

### Smoke Tests (Manual)

**Setup:**
```bash
npm run build && npm link
```

**Test sequence:**
```bash
# 1. Start session
bdg localhost:3000

# 2. Verify peek works (multiple times to test live updates)
bdg peek
bdg peek --last 10
bdg peek --network
bdg peek --console
bdg peek --follow  # Should poll IPC, not read files

# 3. Verify details works
bdg details network <requestId from peek>
bdg details console <index from peek>

# 4. Verify no files created
ls -la ~/.bdg/
# Should NOT see: session.preview.json, session.full.json
# Should see: session.pid, session.lock, session.meta.json

# 5. Stop session
bdg stop
# Should see: session.json (final output)
```

### Contract Tests (Optional)

**File:** `src/__tests__/ipc-contracts.test.ts`

```typescript
describe('IPC Contracts', () => {
  test('worker_peek_response has required fields', async () => {
    const response = await sendWorkerCommand('worker_peek', { lastN: 5 });
    expect(response.success).toBe(true);
    expect(response.data).toMatchObject({
      version: expect.any(String),
      startTime: expect.any(Number),
      duration: expect.any(Number),
      target: { url: expect.any(String), title: expect.any(String) },
      activeCollectors: expect.any(Array),
      network: expect.any(Array),
      console: expect.any(Array),
    });
    // Verify lightweight (no bodies)
    if (response.data.network.length > 0) {
      expect(response.data.network[0]).not.toHaveProperty('requestBody');
      expect(response.data.network[0]).not.toHaveProperty('responseBody');
    }
  });
  
  test('worker_details_response contains full object', async () => {
    const response = await sendWorkerCommand('worker_details', { type: 'network', id: 'req123' });
    expect(response.success).toBe(true);
    expect(response.data.item).toMatchObject({
      requestId: 'req123',
      // Should have bodies if available
    });
  });
  
  test('worker_details handles not found', async () => {
    const response = await sendWorkerCommand('worker_details', { type: 'network', id: 'invalid' });
    expect(response.success).toBe(false);
    expect(response.error).toContain('not found');
  });
});
```

---

## Risk Assessment

### Low Risk
- IPC infrastructure proven (DOM commands work)
- CLI interface unchanged (transparent to users)
- Rollback simple (revert branch)

### Medium Risk
- Worker response time under load (10k+ requests)
  - **Mitigation:** Cap `lastN` at reasonable limit (e.g., 100)
  - **Future:** Add pagination if needed

- Daemon timeout tuning
  - **Mitigation:** Start with 5s timeout, monitor logs
  - **Future:** Make configurable if needed

### High Risk (None)
- No data loss risk (all data still in memory)
- No breaking changes (CLI API identical)

---

## Stage 2: Remove Final session.json (Optional)

**Goal:** Eliminate ALL file writes during session

**Implementation:**
1. Add `stop_session_response` field: `finalOutput: BdgOutput`
2. Worker returns final JSON via IPC instead of writing file
3. CLI prints final output to stdout (agent captures)
4. Remove `writeSessionOutput()` entirely
5. Update cleanup to remove `session.json` deletion

**Benefits:**
- Zero disk writes during collection
- Agent gets JSON directly via IPC
- Simpler cleanup (fewer files)

**Trade-offs:**
- If daemon crashes, final output lost (acceptable for agent workflows)
- Could add env flag `BDG_PERSIST_FINAL=1` for one release as fallback

---

## Success Metrics

**Performance:**
- [ ] Peek response time: <10ms (vs 5s file write lag)
- [ ] Details response time: <50ms (vs 87MB file read)
- [ ] Memory: No duplicate serialization overhead

**Code Quality:**
- [ ] Lines removed: ~500-800 (PreviewWriter, file I/O, preview loop)
- [ ] Files deleted: 1 (PreviewWriter.ts)
- [ ] Functions removed: 6+ (writePartial, readPartial, writeFull, readFull, startPreviewLoop, etc.)

**Functionality:**
- [ ] `bdg peek` works with live data
- [ ] `bdg details` works with live data
- [ ] No `session.preview.json` or `session.full.json` created
- [ ] CLI behavior identical (transparent migration)

---

## Timeline

**Phase 1-3:** Define contracts, implement worker, proxy daemon - **2-3 hours**  
**Phase 4-5:** Extend client, update CLI commands - **1-2 hours**  
**Phase 6-7:** Remove dead code, update docs - **1-2 hours**  
**Testing:** Smoke tests, contract tests - **1-2 hours**

**Total:** **5-9 hours** (1-2 dev days with testing)

---

## Open Questions

1. **Should we keep final session.json for one release?**
   - Recommendation: Yes (Stage 2 can remove it later)
   - Provides rollback safety net

2. **Cap `lastN` parameter?**
   - Recommendation: Yes, max 100 (prevents abuse)
   - Document in API

3. **Add request body size limit for details?**
   - Recommendation: Yes, reuse existing MAX_RESPONSE_SIZE
   - Already enforced during collection

4. **Contract tests required before merge?**
   - Recommendation: No, smoke tests sufficient
   - Add contract tests as follow-up if needed

---

## References

- Current IPC implementation: `src/daemon/ipcServer.ts`, `src/daemon/worker.ts`
- DOM command pattern: `src/ipc/commands.ts`
- File-based preview: `src/cli/handlers/PreviewWriter.ts` (to be deleted)
- Session output: `src/session/output.ts` (to be cleaned)
