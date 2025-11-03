# DAEMON_IPC_ARCHITECTURE.md Review

**Review Date:** 2025-11-03
**Status:** Critical Issues Identified

## Executive Summary

The daemon + IPC architecture is **solid in vision** but requires **5 critical hardening fixes** to handle stream framing edge cases and race conditions. All issues are fixable with well-established patterns (buffering, locking, stderr consumption).

**Overall Assessment:** ✅ Sound approach, ⚠️ Implementation details need hardening

---

## Critical Issues

### Issue #1: Handshake Robustness (Stream Framing)

**Location:** `docs/DAEMON_IPC_ARCHITECTURE.md:316-342` (waitForHandshake function)

**Severity:** 🔴 HIGH - Worker can be incorrectly declared dead during startup

**Problem:**
```typescript
worker.stdout?.once('data', (data) => {
  clearTimeout(timeout);
  try {
    const handshake = JSON.parse(data.toString()); // ❌ Assumes complete message
    resolve(handshake);
  } catch (err) {
    reject(new Error('Invalid handshake response'));
  }
});
```

**Root Cause:** TCP/pipe framing doesn't guarantee message boundaries. If the handshake JSON arrives in two chunks:
- Chunk 1: `{"version":"1.0","pid":123`
- Chunk 2: `,"socketPath":"/path",...}\n`

The first `data` event gets incomplete JSON → `JSON.parse()` throws → worker declared dead even though it's healthy.

**Impact:**
- False negatives during startup
- User sees "handshake timeout" when worker is actually fine
- Wastes debugging time on non-existent issues

**Solution:** Buffer until newline (protocol already specifies newline-delimited JSON)

```typescript
async function waitForHandshake(
  worker: ChildProcess,
  timeoutMs: number
): Promise<IPCHandshake> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Handshake timeout - worker may have crashed'));
    }, timeoutMs);

    let buffer = '';

    const handleData = (data: Buffer) => {
      buffer += data.toString();

      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex !== -1) {
        clearTimeout(timeout);
        const line = buffer.slice(0, newlineIndex);
        worker.stdout?.removeListener('data', handleData);

        try {
          const handshake = JSON.parse(line);
          resolve(handshake);
        } catch (err) {
          reject(new Error('Invalid handshake response'));
        }
      }
    };

    worker.stdout?.on('data', handleData);

    worker.on('error', (err) => {
      clearTimeout(timeout);
      worker.stdout?.removeListener('data', handleData);
      reject(err);
    });
  });
}
```

**Document Update Required:**
- Update lines 316-342 with buffered implementation
- Add note: "CRITICAL: Buffer until newline to handle stream framing"

---

### Issue #2: IPC Response Parsing (JSONL Protocol)

**Location:** `docs/DAEMON_IPC_ARCHITECTURE.md:561-579` (handleResponse method)

**Severity:** 🔴 HIGH - IPC client crashes on back-to-back responses

**Problem:**
```typescript
private handleResponse(data: Buffer): void {
  try {
    const response: IPCResponse = JSON.parse(data.toString()); // ❌ Assumes one complete object
    const pending = this.pendingRequests.get(response.id);
    // ...
  } catch (err) {
    console.error('Failed to parse IPC response:', err);
  }
}
```

**Root Cause:** Same framing issue. Multiple scenarios fail:

**Scenario A - Concatenated responses:**
```
{"id":"1","success":true}\n{"id":"2","success":true}\n
```
→ `JSON.parse()` throws because it sees two objects

**Scenario B - Split response:**
- Event 1: `{"id":"1","success":true,`
- Event 2: `"data":{}}\n`
→ First event throws incomplete JSON

**Impact:**
- Stacked `bdg peek` commands crash the client
- Any high-throughput IPC usage fails
- Users think the daemon is broken when it's a parsing bug

**Solution:** Implement proper newline-delimited JSON parser

```typescript
export class IPCClient {
  private socket?: Socket;
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private buffer = ''; // ✅ Add buffer for incomplete messages

  async connect(socketPath: string, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error(
          'Failed to connect to session\n' +
          'Session may have crashed. Check logs: bdg logs'
        ));
      }, timeoutMs);

      this.socket = connect(socketPath);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`IPC connection error: ${err.message}`));
      });

      this.socket.on('data', (data) => {
        this.handleData(data); // ✅ Changed from handleResponse
      });
    });
  }

  // ✅ New method: handle raw data and buffer until newline
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.trim()) {
        this.handleResponse(line);
      }
    }
  }

  // ✅ Updated method: parse single line
  private handleResponse(line: string): void {
    try {
      const response: IPCResponse = JSON.parse(line);
      const pending = this.pendingRequests.get(response.id);

      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(response.id);

        if (response.success) {
          pending.resolve(response.data);
        } else {
          pending.reject(new Error(response.error?.message || 'Request failed'));
        }
      }
    } catch (err) {
      console.error('Failed to parse IPC response:', err);
    }
  }

  async request(
    command: string,
    params?: any,
    timeoutMs = 10000
  ): Promise<any> {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    const id = `${++this.requestId}`;
    const request: IPCRequest = { id, command, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${command}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      this.socket!.write(JSON.stringify(request) + '\n');
    });
  }

  disconnect(): void {
    this.socket?.end();
    this.socket = undefined;
    this.buffer = ''; // ✅ Clear buffer on disconnect
  }
}
```

**Document Update Required:**
- Update lines 497-586 with buffered implementation
- Add note: "CRITICAL: Use newline-delimited JSON parser to handle stream framing"
- Add to IPC Protocol section: "⚠️ Stream Framing: Always buffer until newline before parsing"

---

### Issue #3: Logging Pipeline (Stderr Consumption)

**Location:** `docs/DAEMON_IPC_ARCHITECTURE.md:305` (setupLogCapture call)

**Severity:** 🟡 MEDIUM - Worker can block on full stderr pipe

**Problem:**
```typescript
// 7. Setup log capture (async, don't block)
setupLogCapture(worker);

// 8. Inform user and exit parent
console.log(`Collection started (PID ${worker.pid})`);
```

**Root Cause:** Implementation not shown. After `stdout.end()` (line 385 in worker), stderr is still open. If parent doesn't consume stderr, the pipe buffer fills (typically 64KB) and worker blocks on `stderr.write()`.

**Impact:**
- Worker hangs mid-execution when stderr pipe fills
- User sees "worker crashed" when it's actually blocked
- Only manifests with verbose logging or long sessions

**Solution:** Document that `setupLogCapture` must consume stderr before unref()

```typescript
function setupLogCapture(worker: ChildProcess): void {
  const logDir = path.join(os.homedir(), '.bdg', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const logFile = path.join(logDir, `worker-${worker.pid}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  // ✅ CRITICAL: Pipe stderr to prevent blocking
  worker.stderr?.pipe(logStream);

  // Optional: also capture stdout (already ended after handshake, but may have buffered data)
  worker.stdout?.pipe(logStream);

  // Cleanup on worker exit
  worker.on('exit', () => {
    logStream.end();
  });
}
```

**Alternative: Discard stderr if logging not needed**
```typescript
function setupLogCapture(worker: ChildProcess): void {
  // ✅ Consume and discard to prevent blocking
  worker.stderr?.resume();
  worker.stdout?.resume();
}
```

**Document Update Required:**
- Add new section after line 311: "### Log Capture Implementation"
- Show full `setupLogCapture()` implementation
- Add warning: "⚠️ CRITICAL: Must consume stderr before unref() or worker can block on full pipe"

---

### Issue #4: Session Metadata Integrity (Lock File Racing)

**Location:** `docs/DAEMON_IPC_ARCHITECTURE.md:407-435` (cleanupStaleSession function)

**Severity:** 🟡 MEDIUM - Cleanup can delete files during active session startup

**Problem:**
```typescript
export async function cleanupStaleSession(): Promise<void> {
  try {
    const pidStr = await fs.readFile(pidFile, 'utf-8');
    const pid = parseInt(pidStr.trim());

    if (!await isProcessAlive(pid)) {
      // Stale PID - clean up all session files
      await Promise.all([
        fs.unlink(pidFile).catch(() => {}),
        fs.unlink(metaFile).catch(() => {}),
        // ...
      ]);
    }
  } catch (err) {
    // No PID file or can't read - clean up anyway
    await Promise.all([
      fs.unlink(pidFile).catch(() => {}),
      // ...
    ]);
  }
}
```

**Root Cause:** Race condition between cleanup and session startup:

**Timeline:**
1. Process A crashes, leaves stale `session.pid`
2. Process B starts, calls `cleanupStaleSession()`
3. Process B reads stale PID, sees process dead, starts deleting files
4. Process C (new session) starts simultaneously
5. Process C writes `session.pid`, `session.meta.json`, `session.sock`
6. Process B deletes them mid-write
7. Process C thinks it succeeded but has no metadata files

**Impact:**
- Rare but catastrophic data loss
- Session appears started but is unqueryable
- Only manifests in high-frequency restart scenarios (CI, automated testing)

**Solution:** Use atomic lock file to serialize operations

```typescript
// src/session/cleanup.ts

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

const SESSION_DIR = path.join(os.homedir(), '.bdg');
const LOCK_FILE = path.join(SESSION_DIR, 'session.lock');

/**
 * Acquire exclusive lock for session operations.
 * Uses atomic file creation to prevent race conditions.
 *
 * @param timeoutMs - Maximum time to wait for lock (default: 5000ms)
 * @returns Cleanup function to release lock
 * @throws Error if lock cannot be acquired within timeout
 */
export async function acquireSessionLock(timeoutMs = 5000): Promise<() => Promise<void>> {
  const lockData = JSON.stringify({
    pid: process.pid,
    timestamp: Date.now()
  });

  const startTime = Date.now();

  while (true) {
    try {
      // ✅ Atomic operation: create file only if it doesn't exist
      await fs.writeFile(LOCK_FILE, lockData, { flag: 'wx' });

      // Lock acquired
      return async () => {
        try {
          await fs.unlink(LOCK_FILE);
        } catch (err) {
          // Lock file already deleted, ignore
        }
      };
    } catch (err: any) {
      if (err.code !== 'EEXIST') {
        throw err; // Unexpected error
      }

      // Lock file exists - check if stale
      try {
        const existingLock = JSON.parse(await fs.readFile(LOCK_FILE, 'utf-8'));

        // If lock holder is dead, break the lock
        if (!await isProcessAlive(existingLock.pid)) {
          await fs.unlink(LOCK_FILE);
          continue; // Retry acquisition
        }
      } catch {
        // Can't read lock file, assume it's being written
      }

      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(
          'Could not acquire session lock within timeout\n' +
          'Another bdg process may be starting up'
        );
      }

      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

/**
 * Clean up stale session files with proper locking.
 * CRITICAL: Must acquire lock to prevent racing with new sessions.
 */
export async function cleanupStaleSession(): Promise<void> {
  const unlock = await acquireSessionLock();

  try {
    const pidFile = path.join(SESSION_DIR, 'session.pid');
    const metaFile = path.join(SESSION_DIR, 'session.meta.json');
    const socketPath = path.join(SESSION_DIR, 'session.sock');

    try {
      const pidStr = await fs.readFile(pidFile, 'utf-8');
      const pid = parseInt(pidStr.trim());

      // Check if process is actually alive
      if (!await isProcessAlive(pid)) {
        // Stale PID - clean up all session files
        console.warn(`Detected stale session (PID ${pid})`);
        await Promise.all([
          fs.unlink(pidFile).catch(() => {}),
          fs.unlink(metaFile).catch(() => {}),
          fs.unlink(socketPath).catch(() => {}),
        ]);
        console.warn('Cleaned up stale files');
      }
    } catch (err) {
      // No PID file or can't read - clean up anyway
      await Promise.all([
        fs.unlink(pidFile).catch(() => {}),
        fs.unlink(metaFile).catch(() => {}),
        fs.unlink(socketPath).catch(() => {})
      ]);
    }
  } finally {
    await unlock();
  }
}

/**
 * Check if a process is alive.
 * Cross-platform using process.kill(pid, 0).
 */
export async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    // Send signal 0 - checks existence without killing
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}
```

**Updated launchDaemon:**
```typescript
export async function launchDaemon(
  url: string,
  options: CollectionOptions
): Promise<void> {
  // ✅ Acquire lock FIRST to prevent racing
  const unlock = await acquireSessionLock();

  try {
    // 1. Check for existing session (lock is held, so safe)
    const existingPid = await getSessionPid();
    if (existingPid && await isProcessAlive(existingPid)) {
      throw new Error(
        `Session already running (PID ${existingPid})\n` +
        `Use 'bdg stop' to end it first`
      );
    }

    // 2. Clean up stale files (no need to lock again, we already have it)
    await cleanupStaleSessionNoLock();

    // 3. Fork worker process
    const worker = spawn(process.execPath, [
      process.argv[1],
      url,
      ...serializeOptions(options)
    ], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BDG_WORKER: '1' }
    });

    // 4. Wait for handshake
    const handshake = await waitForHandshake(worker, 30000);

    if (!handshake.ready) {
      worker.kill();
      throw new Error(
        'Worker failed to connect to Chrome\n' +
        'Check logs: bdg logs'
      );
    }

    // 5. Write session metadata (still holding lock)
    await writeSessionMetadata({
      pid: worker.pid!,
      socketPath: handshake.socketPath,
      startTime: Date.now(),
      url,
      target: handshake.target
    });

    // 6. Setup log capture
    setupLogCapture(worker);

    // 7. Detach worker
    worker.unref();

    // 8. Inform user and exit parent
    console.log(`Collection started (PID ${worker.pid})`);
    console.log(`Target: ${handshake.target.title}`);
    console.log(`\nUse 'bdg peek' to monitor, 'bdg stop' to finish`);
  } finally {
    // ✅ Release lock
    await unlock();
  }
}
```

**Document Update Required:**
- Update lines 253-311 with lock acquisition
- Update lines 407-446 with locked cleanup implementation
- Add new section after line 596: "### Session Lock File"
```
~/.bdg/
  session.lock         # Atomic lock file (JSON with PID + timestamp)
  session.pid          # Worker PID
  ...
```

---

### Issue #5: File-Based Fallback Completeness

**Location:** `docs/DAEMON_IPC_ARCHITECTURE.md:686-701` (Fallback pattern)

**Severity:** 🟢 LOW - Documentation completeness, not a bug

**Problem:**
```typescript
async function peek(options: PeekOptions): Promise<void> {
  try {
    // Try IPC first
    const client = new IPCClient();
    await client.connect(socketPath);
    const data = await client.request('peek', options);
    console.log(formatPeekOutput(data));
  } catch (err) {
    // Fall back to file-based
    console.warn('IPC unavailable, reading from file...');
    const data = await readPartialOutput(); // ❓ Will this exist?
    console.log(formatPeekOutput(data));
  }
}
```

**Root Cause:** Document mentions fallback but Phase 4 (line 656) says "Remove `writePartialOutput()`". If we remove file writes, the fallback won't work.

**Impact:**
- No impact if IPC always works
- Users have zero fallback when IPC fails (daemon crashed, socket deleted, etc.)
- Loss of reliability

**Solution:** Keep file writes until IPC is proven reliable

**Recommendation:**
```typescript
// Phase 4 should be updated to:
15. ✅ Reduce file writes from 5s → 30s (crash recovery + fallback)
16. ❌ Keep writePartialOutput() for fallback reliability
17. ✅ Keep writeFullOutput() for final session.json
```

**Document Update Required:**
- Update line 655: "Reduce file writes from 5s → 30s (crash recovery + fallback)"
- Update line 656: "Keep `writePartialOutput()` for IPC fallback until proven reliable (remove in v2.0)"
- Add note to line 701: "⚠️ File-based fallback is critical until IPC is battle-tested in production"

---

## Summary of Required Document Updates

### High Priority (Critical for Reliability)

1. **Lines 316-342:** Update `waitForHandshake()` to buffer until newline
2. **Lines 497-586:** Update `IPCClient` to implement newline-delimited JSON parsing
3. **Lines 253-311:** Add lock acquisition to `launchDaemon()`
4. **Lines 407-446:** Add lock acquisition to `cleanupStaleSession()`
5. **After line 311:** Add new section documenting `setupLogCapture()` implementation

### Medium Priority (Documentation Completeness)

6. **Lines 88-89:** Add warning about stream framing in IPC Protocol section
7. **Lines 655-657:** Update Phase 4 to keep file writes for fallback
8. **After line 596:** Document session.lock file format

### Low Priority (Quality of Life)

9. **Lines 704-738:** Expand error messages to include "check logs: bdg logs"
10. **Lines 739-772:** Add integration test for stream framing edge cases

---

## Testing Recommendations

### Critical Test Cases

1. **Handshake Chunking Test:**
```typescript
// Simulate chunked handshake
const handshake = JSON.stringify({...}) + '\n';
const chunks = [
  handshake.slice(0, 50),
  handshake.slice(50)
];

for (const chunk of chunks) {
  worker.stdout.write(chunk);
  await sleep(10);
}

// Should succeed, not timeout
```

2. **IPC Response Concatenation Test:**
```typescript
// Send two responses back-to-back
const resp1 = JSON.stringify({id: '1', success: true}) + '\n';
const resp2 = JSON.stringify({id: '2', success: true}) + '\n';

socket.write(resp1 + resp2); // Send as one chunk

// Both requests should resolve
```

3. **Lock File Racing Test:**
```typescript
// Start 10 sessions simultaneously
const sessions = Array.from({ length: 10 }, () =>
  launchDaemon('localhost:3000', {})
);

// Only one should succeed, others should error with lock timeout
const results = await Promise.allSettled(sessions);
expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
```

---

## Migration Path

### Phase 1: Harden Critical Paths (Week 1)
- [ ] Implement buffered handshake parsing
- [ ] Implement newline-delimited IPC response parsing
- [ ] Add stderr consumption to `setupLogCapture()`

### Phase 2: Add Locking (Week 2)
- [ ] Implement `acquireSessionLock()`
- [ ] Update `launchDaemon()` to use locking
- [ ] Update `cleanupStaleSession()` to use locking

### Phase 3: Testing & Validation (Week 3)
- [ ] Add integration tests for stream framing
- [ ] Add integration tests for lock racing
- [ ] Load testing with 100+ rapid session starts

### Phase 4: Documentation (Week 4)
- [ ] Update DAEMON_IPC_ARCHITECTURE.md with all fixes
- [ ] Add troubleshooting guide for common IPC failures
- [ ] Document migration path for existing users

---

## Conclusion

**The architecture is sound**. These issues are standard stream handling and concurrency challenges with well-known solutions. Once hardened:

✅ Handshake robustness → handles chunked messages
✅ IPC response parsing → handles concatenated/split responses
✅ Logging pipeline → prevents stderr blocking
✅ Session metadata integrity → prevents lock racing
✅ File-based fallback → maintained for reliability

**Estimated effort:** 2-3 days for implementation, 1 week for thorough testing.

**Risk level after fixes:** LOW - all patterns are battle-tested in production systems.
