# Process Cleanup and Startup Checks

## Overview

This document describes how `bdg` handles process cleanup and checks for existing sessions when starting a new session.

---

## Startup Flow (bdg <url>)

### 1. Daemon Startup Check (`daemon/launcher.ts:38-72`)

**Before Starting Daemon:**

```typescript
// Step 1: Clean up stale session files
cleanupStaleSession()
  ├─ Acquires session lock (atomic via flock)
  ├─ Checks if session.pid process is alive
  ├─ Checks if daemon.pid process is alive
  └─ If both dead: removes all stale files

// Step 2: Check if daemon already running
if (daemon.pid exists && process is alive) {
  throw Error('Daemon already running (PID {pid})')
}

// Step 3: Spawn new daemon
spawn('node', ['daemon.js'], { detached: true })
```

**Current Behavior:**
- ✅ Cleans up stale session files (if processes are dead)
- ✅ Checks if daemon PID is alive before starting new daemon
- ✅ Throws error if daemon already running
- ❌ **NO ATOMIC LOCK** for daemon startup (race condition!)

---

### 2. Session Startup Check (`daemon/ipcServer.ts:337-351`)

**When Starting Session (via daemon):**

```typescript
// Check for existing session
const sessionPid = readPid()
if (sessionPid && isProcessAlive(sessionPid)) {
  return Error('Session already running (PID {sessionPid})')
}

// Launch worker process
launchSessionInWorker(url, options)
```

**Current Behavior:**
- ✅ Checks if session.pid process is alive
- ✅ Rejects concurrent session starts
- ✅ Error message is clear

---

## Cleanup Flow Details

### cleanupStaleSession() (`session/cleanup.ts:35-142`)

**Atomic Cleanup Process:**

```
1. Try to acquire session.lock (file-based mutex)
   ├─ If locked: Check if lock holder is alive
   │  ├─ Process alive → Return (active session running)
   │  └─ Process dead → Force unlock and retry
   └─ If acquired: Continue to step 2

2. Check session.pid
   ├─ Process alive → Release lock, return (active session)
   └─ Process dead → Continue to step 3

3. Check daemon.pid
   ├─ Process alive → Release lock, return (daemon running)
   └─ Process dead → Continue to step 4

4. Clean up all stale files:
   ├─ Remove session.pid
   ├─ Remove session.meta.json
   ├─ Remove daemon.pid
   └─ Remove daemon.sock

5. Release lock and return
```

**Files Cleaned:**
- `~/.bdg/session.pid`
- `~/.bdg/session.meta.json`
- `~/.bdg/daemon.pid`
- `~/.bdg/daemon.sock`
- `~/.bdg/session.lock` (released, not deleted)

**Files NOT Cleaned:**
- `~/.bdg/session.json` (final output - preserved)
- `~/.bdg/chrome.pid` (Chrome process tracking)

---

## Process Hierarchy

```
CLI (bdg <url>)
  │
  ├─> Daemon (daemon.js)
  │     └─> Worker (worker.js)
  │           └─> Chrome (--remote-debugging-port=9222)
  │
  └─> Monitoring: Waits until Ctrl+C or timeout
```

**PID Files:**
- `daemon.pid` - Daemon process (persists across sessions)
- `session.pid` - Worker process (one per session)
- `chrome.pid` - Chrome browser (one per session)

---

## What Happens When...

### Starting bdg when nothing is running
```bash
$ bdg localhost:3000
```

1. ✅ `cleanupStaleSession()` runs (finds no stale files)
2. ✅ Daemon launches (no existing daemon.pid)
3. ✅ Session starts (no existing session.pid)
4. ✅ Chrome launches

**Result:** Clean start

---

### Starting bdg when daemon is running
```bash
$ bdg localhost:3000  # First session
$ bdg localhost:3000  # Second session (concurrent)
```

**Current Behavior (WITH RACE CONDITION):**

1. ❌ Both sessions call `cleanupStaleSession()` simultaneously
2. ❌ Both check daemon.pid (may not exist yet - race!)
3. ❌ Both spawn daemons
4. ❌ **Two daemons running!**

**Expected Behavior:**

1. ✅ First session acquires daemon lock
2. ✅ First session spawns daemon
3. ✅ Second session checks daemon.pid (alive)
4. ✅ Second session gets error: "Daemon already running"

---

### Starting bdg after crash (stale files)
```bash
$ bdg localhost:3000
# ... process crashes (kill -9)
$ bdg localhost:3000  # Try again
```

**Current Behavior:**

1. ✅ `cleanupStaleSession()` runs
2. ✅ Detects session.pid process is dead
3. ✅ Detects daemon.pid process is dead  
4. ✅ Removes all stale files
5. ✅ New session starts cleanly

**Result:** Automatic recovery ✅

---

### Starting bdg when session is running
```bash
$ bdg localhost:3000 &  # Background session
$ bdg localhost:3000    # Try to start another
```

**Current Behavior:**

1. ✅ Daemon receives start_session_request
2. ✅ Checks session.pid (alive)
3. ✅ Returns error: "Session already running (PID {pid})"

**Result:** Correctly rejected ✅

---

## Known Issues

### 🔴 Issue #1: Daemon Startup Race Condition

**Problem**: Two concurrent `bdg` commands can both spawn daemons

**Root Cause**: No atomic lock for daemon startup, only for session

**Evidence** (from edge case tests):
```bash
$ bdg localhost:3000 > /tmp/s1.log 2>&1 &
$ bdg localhost:3000 > /tmp/s2.log 2>&1 &
$ sleep 5

# Both logs show:
[bdg] Starting daemon...
[launcher] Starting daemon: /path/to/daemon.js
```

**Impact**:
- Two daemon processes running
- Potential PID file corruption
- Undefined behavior

**Fix Required**:
```typescript
// In daemon/launcher.ts:38

export async function launchDaemon(): Promise<ChildProcess> {
  // MISSING: Acquire atomic daemon lock HERE
  const daemonLock = acquireDaemonLock()  // NEW!
  if (!daemonLock) {
    throw new Error('Daemon startup in progress')
  }
  
  try {
    cleanupStaleSession()
    
    // Check if daemon already running...
    // Spawn daemon...
    
    return daemon
  } finally {
    releaseDaemonLock()  // NEW!
  }
}
```

---

### 🟡 Issue #2: Stale Daemon PID Not Detected

**Problem**: Fake daemon PID (e.g., 99999) treated as valid

**Root Cause**: `bdg status` doesn't validate daemon.pid process

**Evidence** (from edge case tests):
```bash
$ echo "99999" > ~/.bdg/daemon.pid
$ bdg status
Daemon: ACTIVE (PID 99999)  # Wrong! Process doesn't exist
```

**Fix Required**:
```typescript
// In cli/commands/status.ts

if (daemonPid) {
  if (isProcessAlive(daemonPid)) {
    console.log('Daemon: ACTIVE')
  } else {
    console.log('Daemon not running (stale PID file)')
    cleanupStaleDaemonPid()  // Auto-cleanup
  }
}
```

---

## Manual Cleanup

### User Commands

```bash
# Clean up stale files (safe - checks if processes alive)
bdg cleanup

# Force cleanup (removes files even if processes alive)
bdg cleanup --force

# Stop active session
bdg stop
```

### Manual File Cleanup

```bash
# If bdg is completely stuck, manually remove:
rm -f ~/.bdg/daemon.pid
rm -f ~/.bdg/daemon.sock
rm -f ~/.bdg/session.pid
rm -f ~/.bdg/session.lock
rm -f ~/.bdg/session.meta.json
```

**Warning:** Only do this if:
1. You're sure no bdg processes are running (`ps aux | grep bdg`)
2. The `bdg cleanup` command failed
3. You understand you may lose session data

---

## Chrome Process Management

### Chrome Lifecycle

```
Session Start:
  └─> ChromeBootstrap.launch()
      └─> spawn('chrome', ['--remote-debugging-port=9222'])
          └─> Write PID to ~/.bdg/chrome.pid

Session Stop:
  └─> Read chrome.pid
  └─> kill -TERM {chromePid}
  └─> Remove chrome.pid
```

**Current Behavior:**
- ✅ Chrome PID written to file
- ✅ Chrome killed on session stop
- ⚠️ **Chrome NOT killed if worker crashes** (Issue #6 in edge cases)

---

## Recommendations

### Priority Fixes

1. **Add atomic daemon lock** (P0 - Critical)
   - Prevents concurrent daemon starts
   - Use file-based mutex like session.lock
   - Estimated: 2-3 hours

2. **Validate daemon PID on status** (P0 - Critical)
   - Check if daemon.pid process actually alive
   - Auto-cleanup stale PID files
   - Estimated: 1 hour

3. **Kill Chrome when worker dies** (P1 - High)
   - Monitor worker process exit
   - Clean up Chrome if worker crashes
   - Estimated: 2 hours

### Testing Checklist

After implementing fixes, verify:

- [ ] Two concurrent `bdg <url>` commands → Only one daemon starts
- [ ] Fake daemon PID → Detected and cleaned up
- [ ] `bdg stop` → All processes killed (daemon, worker, Chrome)
- [ ] Worker crash → Chrome killed automatically
- [ ] `bdg cleanup` → Removes stale files when processes dead
- [ ] `bdg cleanup` → Refuses if processes alive (unless --force)

---

## Appendix: File Locations

All session files stored in: `~/.bdg/`

| File | Purpose | Created By | Cleaned Up By |
|------|---------|------------|---------------|
| `daemon.pid` | Daemon process PID | Daemon | Daemon exit |
| `daemon.sock` | Unix domain socket | Daemon | Daemon exit |
| `session.pid` | Worker process PID | Worker | Worker exit |
| `session.lock` | Session mutex | Session start | Session stop |
| `session.meta.json` | Session metadata | Worker | Session stop |
| `session.json` | Final output | Worker stop | User (preserved) |
| `chrome.pid` | Chrome process PID | ChromeBootstrap | Session stop |

---

## Related Documents

- `docs/EDGE_CASE_FINDINGS.md` - Edge case test results
- `docs/IPC_SOLIDIFICATION_PLAN.md` - IPC robustness plan
- `src/session/cleanup.ts` - Cleanup implementation
- `src/daemon/launcher.ts` - Daemon startup logic
