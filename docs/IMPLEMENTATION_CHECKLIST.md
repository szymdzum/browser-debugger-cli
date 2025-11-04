# IPC Streaming Implementation Checklist

**Branch:** `refactor/ipc-streaming-data-access`  
**Goal:** Replace file-based preview with pure IPC streaming

---

## Pre-Implementation

- [x] Create feature branch
- [ ] Build + link baseline: `npm run build && npm link`
- [ ] Smoke test current behavior:
  - [ ] `bdg status` works
  - [ ] `bdg localhost:3000` starts session
  - [ ] `bdg peek` shows data (reads file)
  - [ ] `bdg details network <id>` works (reads file)
  - [ ] Verify `~/.bdg/session.preview.json` and `session.full.json` exist
  - [ ] `bdg stop` works

---

## Phase 1: Define IPC Contracts

### File: `src/ipc/commands.ts`

- [ ] Add `worker_peek` to COMMANDS registry
  - [ ] Define `WorkerPeekCommand` interface
  - [ ] Define `WorkerPeekData` interface (lightweight, no bodies/args)
  
- [ ] Add `worker_details` to COMMANDS registry
  - [ ] Define `WorkerDetailsCommand` interface
  - [ ] Define `WorkerDetailsData` interface (full objects)

### File: `src/ipc/types.ts` (if needed)

- [ ] Add `DetailsRequest` interface (extends IPCMessage)
- [ ] Add `DetailsResponse` interface (extends IPCMessage)
- [ ] Update `IPCMessageType` union
- [ ] Update `IPCRequest` union
- [ ] Update `IPCResponse` union

---

## Phase 2: Implement Worker Handlers

### File: `src/daemon/worker.ts`

- [ ] Add `worker_peek` handler to `commandHandlers`
  - [ ] Build response from in-memory `networkRequests`
  - [ ] Build response from in-memory `consoleMessages`
  - [ ] Apply `lastN` slicing (default 10)
  - [ ] Strip request/response bodies
  - [ ] Strip console args/stack
  - [ ] Include version, startTime, duration, target, activeCollectors
  
- [ ] Add `worker_details` handler to `commandHandlers`
  - [ ] Handle `type: 'network'` - find by requestId
  - [ ] Handle `type: 'console'` - find by index
  - [ ] Return full object with bodies/args
  - [ ] Throw error if not found

---

## Phase 3: Proxy Commands in Daemon

### File: `src/daemon/ipcServer.ts`

- [ ] Rewrite `handlePeekRequest` to forward to worker
  - [ ] Remove `readPartialOutput()` call
  - [ ] Generate unique requestId
  - [ ] Set timeout (5s)
  - [ ] Add to pending map
  - [ ] Write `worker_peek_request` to worker stdin
  - [ ] Wait for worker response via stdout
  
- [ ] Add `handleDetailsRequest` method
  - [ ] Mirror peek request flow
  - [ ] Forward `worker_details_request` to worker
  - [ ] Correlate response via requestId
  
- [ ] Update message routing in `handleMessage`
  - [ ] Route `details_request` to `handleDetailsRequest`
  
- [ ] Update `handleWorkerResponse` to handle new commands
  - [ ] Handle `worker_peek_response`
  - [ ] Handle `worker_details_response`
  
- [ ] Rename `pendingDomRequests` to `pendingWorkerRequests` (if desired)

---

## Phase 4: Extend IPC Client

### File: `src/ipc/client.ts`

- [ ] Add `getDetails(type, id)` function
  - [ ] Create `DetailsRequest` with sessionId
  - [ ] Call `sendRequest<DetailsRequest, DetailsResponse>`
  - [ ] Return typed response
  
- [ ] Update `getPeek()` to accept options
  - [ ] Add optional `options?: { lastN?: number }` parameter
  - [ ] Pass `lastN` in request if provided

---

## Phase 5: Update CLI Commands

### File: `src/cli/commands/peek.ts`

- [ ] Remove `readPartialOutput` import
- [ ] Call `getPeek({ lastN: parseInt(options.last) })`
- [ ] Keep all formatting logic unchanged

### File: `src/cli/commands/details.ts`

- [ ] Remove `readFullOutput` import
- [ ] Replace file read with `getDetails(type, id)` call
- [ ] Handle IPC response (success/error)
- [ ] Keep all formatting logic unchanged

---

## Phase 6: Remove File-Based Preview System

### Delete Files

- [ ] Delete `src/cli/handlers/PreviewWriter.ts`

### File: `src/session/output.ts`

- [ ] Remove `writePartialOutputAsync()`
- [ ] Remove `writeFullOutputAsync()`
- [ ] Remove `readPartialOutput()`
- [ ] Remove `readFullOutput()`
- [ ] Keep `writeSessionOutput()` (temporary)

### File: `src/session/paths.ts`

- [ ] Remove `getPartialFilePath()`
- [ ] Remove `getFullFilePath()`
- [ ] Keep `getSessionFilePath('OUTPUT')` (temporary)

### File: `src/daemon/worker.ts`

- [ ] Remove `startPreviewLoop()` function
- [ ] Remove `previewInterval` variable declaration
- [ ] Remove `clearInterval(previewInterval)` from cleanup
- [ ] Remove `writePartialOutputAsync` import
- [ ] Remove `writeFullOutputAsync` import
- [ ] Remove preview loop calls from `main()`
- [ ] In `gracefulShutdown()`:
  - [ ] Remove `await writePartialOutputAsync(finalOutput)`
  - [ ] Remove `await writeFullOutputAsync(finalOutput)`
  - [ ] Keep `writeSessionOutput(finalOutput, compact)` (temporary)

### File: `src/cli/handlers/daemonSessionController.ts`

- [ ] Remove `PreviewWriter` import
- [ ] Remove `PreviewWriter` instantiation
- [ ] Remove `PreviewWriter.start()` call
- [ ] Remove `PreviewWriter.stop()` call

### File: `src/session/cleanup.ts`

- [ ] Remove deletion of `session.preview.json`
- [ ] Remove deletion of `session.full.json`
- [ ] Keep handling for other session files (pid, lock, meta)

---

## Phase 7: Update Documentation

### File: `WARP.md` or `CLAUDE.md`

- [ ] Remove "Two-Tier Preview System" section
- [ ] Remove references to `session.preview.json` (360KB)
- [ ] Remove references to `session.full.json` (87MB)
- [ ] Remove "241x smaller" metrics
- [ ] Remove `PreviewWriter` class description
- [ ] Add "Live Data Access via IPC" section
- [ ] Update Session State Files list
- [ ] Add migration note about IPC streaming

### File: `README.md`

- [ ] Update quickstart examples
- [ ] Update command descriptions
- [ ] Remove file-based preview mentions

---

## Testing & Validation

### Build & Link

- [ ] `npm run build` (verify no TypeScript errors)
- [ ] `npm link` (install globally)

### Smoke Tests

- [ ] Start session: `bdg localhost:3000`
- [ ] Verify peek: `bdg peek`
  - [ ] Data appears (live from worker)
  - [ ] No errors
- [ ] Verify peek options: `bdg peek --last 10`
- [ ] Verify peek filters: `bdg peek --network`
- [ ] Verify peek filters: `bdg peek --console`
- [ ] Verify peek follow: `bdg peek --follow`
  - [ ] Live updates work
  - [ ] Ctrl+C stops cleanly
- [ ] Get network request ID from peek output
- [ ] Verify details network: `bdg details network <requestId>`
  - [ ] Full object with bodies/headers shown
  - [ ] No errors
- [ ] Get console index from peek output
- [ ] Verify details console: `bdg details console <index>`
  - [ ] Full object with args/stack shown
  - [ ] No errors
- [ ] Check files: `ls -la ~/.bdg/`
  - [ ] `session.preview.json` does NOT exist ✅
  - [ ] `session.full.json` does NOT exist ✅
  - [ ] `session.pid` exists
  - [ ] `session.lock` exists
  - [ ] `session.meta.json` exists
- [ ] Stop session: `bdg stop`
  - [ ] `session.json` written (final output)
  - [ ] No errors

### Error Cases

- [ ] `bdg peek` when no session running
  - [ ] Proper error message
- [ ] `bdg details network invalid-id`
  - [ ] Proper error message
- [ ] `bdg details console 99999`
  - [ ] Proper error message

---

## Code Quality Checks

- [ ] No TypeScript errors: `npm run build`
- [ ] Run linter (if configured): `npm run lint`
- [ ] Check for dead imports (PreviewWriter, file I/O functions)
- [ ] Verify no leftover references to `.preview.json` or `.full.json`
  - [ ] `grep -r "preview.json" src/`
  - [ ] `grep -r "full.json" src/`
  - [ ] `grep -r "PreviewWriter" src/`
  - [ ] `grep -r "writePartialOutput" src/`
  - [ ] `grep -r "writeFullOutput" src/`
  - [ ] `grep -r "readPartialOutput" src/`
  - [ ] `grep -r "readFullOutput" src/`

---

## Optional: Contract Tests

### File: `src/__tests__/ipc-contracts.test.ts`

- [ ] Test `worker_peek_response` schema
  - [ ] Has required fields
  - [ ] Network items are lightweight (no bodies)
  - [ ] Console items are lightweight (no args)
  
- [ ] Test `worker_details_response` schema
  - [ ] Network: returns full object with bodies
  - [ ] Console: returns full object with args
  
- [ ] Test error cases
  - [ ] Not found: network
  - [ ] Not found: console
  - [ ] Worker timeout

---

## Final Review

- [ ] All TODOs in code completed
- [ ] All checklist items marked
- [ ] Documentation updated
- [ ] Smoke tests pass
- [ ] No regression in existing features
- [ ] Ready for PR/review

---

## Success Metrics

### Performance (Expected)
- Peek response time: <10ms (instant)
- Details response time: <50ms (no 87MB file read)
- No 5-second file writes during collection

### Code Quality (Expected)
- ~500-800 lines removed
- 1 file deleted (PreviewWriter.ts)
- 6+ functions removed (file I/O)
- Simpler architecture (single IPC path)

### Functionality
- CLI behavior identical (transparent migration)
- No `session.preview.json` or `session.full.json` created
- Live data via IPC works for peek and details

---

## Rollback Plan

If issues arise:

1. `git checkout main` (revert branch)
2. `npm run build && npm link` (rebuild baseline)
3. File-based preview system still intact on main

---

## Stage 2 (Future)

Once IPC streaming is stable:

- [ ] Add `finalOutput` to `stop_session_response`
- [ ] Worker returns final JSON via IPC (not file)
- [ ] Remove `writeSessionOutput()` entirely
- [ ] Remove `session.json` from cleanup
- [ ] Zero file writes during collection

---

## Notes

- **Keep compact mode:** Worker should respect `compact` flag for output formatting
- **Timeout tuning:** Start with 5s, adjust if needed based on load testing
- **Cap lastN:** Consider max 100 to prevent abuse
- **Backward compat:** CLI UX unchanged, only data path swapped
