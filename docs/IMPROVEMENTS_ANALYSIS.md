# BDG Improvements Analysis

Based on real-world testing with AI agents using SSR applications, this document analyzes reported issues and proposes solutions.

## Executive Summary

**Overall Rating**: 6/10 - Great concept undermined by session management issues and SSR timing problems.

**Key Findings**:
- Core functionality (DOM inspection, CDP access) works excellently
- Session lifecycle management is fragile and error-prone
- Error messages are cryptic and don't guide users toward solutions
- SSR applications expose timing and synchronization issues
- Daemon timeout defaults too short for real-world scenarios

---

## Critical Issues 🔴

### 1. Stale Session Auto-Cleanup

**Problem**: When bdg crashes or times out, stale session files remain. Next invocation fails with "Target not found" until manual cleanup.

**Current Behavior**:
```bash
bdg localhost:3000          # Crashes or timeout
bdg localhost:3000          # Error: Target not found
bdg cleanup                 # Manual cleanup required
pkill -f "chrome.*9222"     # Manual Chrome kill required
bdg localhost:3000          # Finally works
```

**Root Cause Analysis**:
- Session files (`~/.bdg/session.*`) persist after crashes
- PID files contain stale process IDs that no longer exist
- Chrome processes remain orphaned on port 9222
- No validation that PIDs in session files are actually alive

**Files Affected**:
- `src/daemon/ipcServer.ts` - handleStartSessionRequest (lines 331-468)
- `src/session/cleanup.ts` - cleanupSession function
- `src/session/process.ts` - isProcessAlive function

**Proposed Solution**:
1. **Auto-detect stale sessions on start**:
   - Check if PID from session file is actually running
   - Validate Chrome process on port 9222 is accessible
   - Auto-cleanup if session is stale (PID dead or port unreachable)

2. **Implementation Steps**:
   ```typescript
   // In handleStartSessionRequest, before checking for existing session:
   const sessionPid = readPid();
   if (sessionPid) {
     if (!isProcessAlive(sessionPid)) {
       // Stale session - auto-cleanup
       console.error('[daemon] Detected stale session (PID not alive), cleaning up...');
       cleanupSession();
     } else {
       // Session exists and is alive - return error as usual
       // ... existing code
     }
   }
   ```

3. **Additional Validation**:
   - Check if Chrome process on specified port is responsive
   - Verify WebSocket debugger URL is reachable
   - Clean up orphaned Chrome processes if session is stale

**Impact**: HIGH - This is the #1 user frustration point

**Effort**: LOW - Simple process validation logic

**Risk**: LOW - Defensive programming, won't break existing functionality

---

### 2. Port Conflict Detection

**Problem**: If port 9222 is occupied, bdg reports "PID: 0" and "Target not found" - not intuitive.

**Current Behavior**:
```bash
# Chrome already on port 9222
bdg localhost:3000
# Output: Chrome launched successfully (PID: 0)  ← Misleading!
# Later: Fatal error: Target not found
```

**Root Cause Analysis**:
- chrome-launcher library fails silently when port is occupied
- Chrome process spawns but immediately exits due to port conflict
- PID capture happens before Chrome verifies port availability
- No port availability check before launch

**Files Affected**:
- `src/connection/launcher.ts` - launchChrome function (lines 34-117)
- `src/daemon/startSession.ts` - launchSessionInWorker function

**Proposed Solution**:

1. **Pre-flight port check**:
   ```typescript
   // Before launching Chrome
   const isPortInUse = await checkPortInUse(port);
   if (isPortInUse) {
     const processInfo = await getProcessOnPort(port);
     throw new Error(
       `Port ${port} is already in use by ${processInfo.name} (PID: ${processInfo.pid})\n\n` +
       `Suggestions:\n` +
       `  - Stop existing process: kill ${processInfo.pid}\n` +
       `  - Use different port: bdg <url> --port 9223\n` +
       `  - Run cleanup: bdg cleanup`
     );
   }
   ```

2. **Post-launch validation**:
   ```typescript
   // After Chrome spawns
   if (chrome.pid === 0 || chrome.pid === undefined) {
     throw new Error(
       `Chrome failed to launch (PID: 0)\n\n` +
       `Possible causes:\n` +
       `  - Port ${port} conflict\n` +
       `  - Chrome binary not found\n` +
       `  - Insufficient permissions\n\n` +
       `Try:\n` +
       `  - bdg cleanup\n` +
       `  - lsof -ti:${port} | xargs kill`
     );
   }
   ```

3. **Verify port is actually listening**:
   ```typescript
   // Wait for Chrome to bind to port (with timeout)
   await waitForPortOpen(port, 5000); // 5s timeout
   ```

**Helper Functions Needed**:
```typescript
// src/utils/port.ts (new file)
async function checkPortInUse(port: number): Promise<boolean>
async function getProcessOnPort(port: number): Promise<{pid: number, name: string}>
async function waitForPortOpen(port: number, timeoutMs: number): Promise<void>
```

**Impact**: HIGH - Prevents confusing error messages

**Effort**: MEDIUM - Requires port checking utilities

**Risk**: LOW - Improves error handling without changing core logic

---

### 3. Smart Page Readiness Detection (RETHOUGHT)

**Problem**: Arbitrary timeouts (5s, 10s) don't work reliably. We're guessing when pages are ready instead of detecting it.

**Current Behavior**:
```bash
bdg localhost:3000                     # SSR app
bdg dom query "h1"
# Error: Worker response timeout (10s) ← Page still hydrating
```

**Root Cause Analysis**:
- **Arbitrary timeouts** instead of actual readiness detection
- No awareness of page load state (loading/interactive/complete)
- No detection of framework hydration (React, Next.js, Remix, etc.)
- No network idle detection (pending requests still loading)
- One-size-fits-all timeout doesn't work for different page types

**Current Approach** (WRONG):
```typescript
// Just wait and hope...
setTimeout(() => {
  // Maybe page is ready? 🤷
}, 10000);
```

**Smart Approach** (RIGHT):
```typescript
// Detect actual readiness
await waitForPageReady(cdp, {
  loadState: 'complete',        // document.readyState
  networkIdle: true,             // No requests for 500ms
  hydrationCheck: true,          // Framework hydrated
  maxWaitMs: 30000              // Safety timeout
});
```

**Files Affected**:
- `src/daemon/ipcServer.ts` - All timeout logic
- `src/daemon/worker.ts` - New readiness detection
- `src/utils/pageReadiness.ts` - New helper utilities

**Proposed Solution**:

**Phase 1: Quick Fix (Increase timeout to 15s)**
- Still arbitrary, but better than 5-10s
- Buys time to implement smart detection

**Phase 2: Smart Detection (Proper solution)**

1. **Wait for Load Events**:
   ```typescript
   // Listen to browser lifecycle events
   const loadComplete = new Promise<void>(resolve => {
     cdp.on('Page.loadEventFired', resolve);
   });
   await loadComplete;
   ```

2. **Detect Network Idle**:
   ```typescript
   // Wait for network to be quiet (no pending requests for 500ms)
   async function waitForNetworkIdle(idleDuration = 500): Promise<void> {
     let lastActivity = Date.now();

     cdp.on('Network.requestWillBeSent', () => {
       lastActivity = Date.now();
     });

     cdp.on('Network.loadingFinished', () => {
       lastActivity = Date.now();
     });

     while (Date.now() - lastActivity < idleDuration) {
       await delay(100);
     }
   }
   ```

3. **Check Framework Hydration**:
   ```typescript
   // Detect when React/Next.js/Remix has hydrated
   async function isFrameworkHydrated(cdp: CDPConnection): Promise<boolean> {
     const result = await cdp.send('Runtime.evaluate', {
       expression: `
         // Next.js
         (window.__NEXT_DATA__ &&
          document.querySelectorAll('[data-reactroot]').length > 0) ||
         // React hydration marker
         document.querySelector('[data-react-hydrated]') !== null ||
         // Remix
         window.__remixManifest !== undefined ||
         // SvelteKit
         window.__SVELTEKIT__ !== undefined ||
         // Generic: Check if page is interactive
         (document.readyState === 'complete' &&
          performance.getEntriesByType('navigation')[0]?.loadEventEnd > 0)
       `,
       returnByValue: true
     });

     return result.result.value === true;
   }
   ```

4. **Progressive Waiting Strategy**:
   ```typescript
   async function waitForPageReady(
     cdp: CDPConnection,
     options: {
       loadEvents?: boolean;      // Wait for load event
       networkIdle?: boolean;     // Wait for network quiet
       hydrationCheck?: boolean;  // Check framework hydration
       customCheck?: string;      // User JS expression
       maxWaitMs?: number;        // Safety timeout (default: 30s)
     }
   ): Promise<void> {
     const deadline = Date.now() + (options.maxWaitMs ?? 30000);

     // Step 1: Wait for document.readyState === 'complete'
     if (options.loadEvents !== false) {
       await waitForLoadEvent(cdp, deadline);
     }

     // Step 2: Wait for network idle
     if (options.networkIdle !== false) {
       await waitForNetworkIdle(cdp, deadline);
     }

     // Step 3: Check framework hydration
     if (options.hydrationCheck !== false) {
       await waitForHydration(cdp, deadline);
     }

     // Step 4: Custom user check
     if (options.customCheck) {
       await waitForCustomCondition(cdp, options.customCheck, deadline);
     }
   }
   ```

5. **Expose as CLI Options**:
   ```bash
   # Auto-detect (smart defaults)
   bdg localhost:3000

   # SSR mode (wait for hydration)
   bdg localhost:3000 --ssr

   # Custom wait condition
   bdg localhost:3000 --wait-for "document.querySelector('.loaded')"

   # Skip waiting (for testing)
   bdg localhost:3000 --no-wait
   ```

**Implementation Priority**:

**Quick Fix (v0.2.0)**: Increase timeouts to 15s
- Effort: 5 minutes
- Impact: MEDIUM (less timeout errors)
- Risk: NONE

**Smart Detection (v0.3.0)**: Implement proper readiness detection
- Effort: 2-3 days
- Impact: HIGH (reliable for all page types)
- Risk: MEDIUM (need testing with various frameworks)

**Impact**: HIGH - Fundamental reliability improvement

**Effort**: MEDIUM (smart detection) / LOW (quick fix)

**Risk**: MEDIUM (need extensive testing) / LOW (quick fix)

---

### 4. Chrome Launch Validation (PID: 0)

**Problem**: Reports "Chrome launched successfully (PID: 0)" when Chrome actually failed to launch.

**Current Behavior**:
```bash
bdg localhost:3000
# Chrome launched successfully (PID: 0)  ← FALSE SUCCESS
# Later: Fatal error: Target not found
```

**Root Cause Analysis**:
- Success message shown before PID validation
- chrome-launcher returns PID:0 on failure
- No check that Chrome process is actually running
- Misleading success message before CDP connection verified

**Files Affected**:
- `src/connection/launcher.ts` - launchChrome function (lines 80-92)
- `src/daemon/startSession.ts` - launchSessionInWorker (lines 41-95)

**Current Code** (launcher.ts:80-92):
```typescript
const chrome = await launch({
  // ...config
});

// Success message before validation!
console.error(
  `[launcher] Chrome launched successfully (PID: ${chrome.pid})`  // ← Can be 0!
);

if (!chrome.pid || chrome.pid <= 0) {
  throw new Error(...);  // Too late - already said "success"
}
```

**Proposed Solution**:

1. **Validate before success message**:
   ```typescript
   const chrome = await launch({ ...config });

   // VALIDATE FIRST
   if (!chrome.pid || chrome.pid <= 0) {
     throw new Error(
       `Chrome failed to launch (PID: ${chrome.pid ?? 0})\n\n` +
       `Possible causes:\n` +
       `  - Port ${port} already in use (check: lsof -ti:${port})\n` +
       `  - Chrome binary not found\n` +
       `  - Insufficient permissions\n\n` +
       `Try:\n` +
       `  - bdg cleanup\n` +
       `  - Use different port: bdg <url> --port 9223`
     );
   }

   // THEN success message
   console.error(`[launcher] Chrome launched successfully (PID: ${chrome.pid})`);
   ```

2. **Additional validation**:
   ```typescript
   // Verify process is actually running
   if (!isProcessAlive(chrome.pid)) {
     throw new Error(
       `Chrome process died immediately after launch (PID: ${chrome.pid})\n\n` +
       `This usually indicates:\n` +
       `  - Port ${port} conflict\n` +
       `  - Chrome crashed on startup\n\n` +
       `Check Chrome logs or try: bdg cleanup`
     );
   }
   ```

3. **Verify CDP endpoint reachable**:
   ```typescript
   // Wait for debugging port to be ready
   const maxRetries = 30;  // From line 99
   for (let i = 0; i < maxRetries; i++) {
     try {
       const targets = await fetchCDPTargets(port);
       if (targets.length > 0) break;  // Success!
     } catch (error) {
       if (i === maxRetries - 1) {
         throw new Error(
           `Chrome launched but CDP endpoint not accessible on port ${port}\n\n` +
           `Chrome PID: ${chrome.pid}\n` +
           `Try: kill ${chrome.pid} && bdg cleanup`
         );
       }
       await delay(pollInterval);
     }
   }
   ```

**Impact**: HIGH - Prevents false success messages

**Effort**: LOW - Reorder existing validation logic

**Risk**: LOW - Improves error clarity

---

## UX Issues 🟡

### 5. Unclear Error Messages

**Problem**: Current errors are cryptic and don't guide users toward solutions.

**Examples**:
```bash
# Current
Fatal error: Target not found for URL: http://localhost:3000

# Better
Failed to load URL: http://localhost:3000

Possible causes:
  1. Server not running
     → Check: curl http://localhost:3000
  2. Port conflict (9222)
     → Check: lsof -ti:9222
     → Kill: pkill -f "chrome.*9222"
  3. Stale session
     → Fix: bdg cleanup && bdg localhost:3000

Try:
  bdg cleanup && bdg localhost:3000
```

**Proposed Error Message Template**:
```typescript
interface EnhancedError {
  message: string;           // What went wrong
  causes: string[];          // Why it might have happened
  diagnostics: string[];     // Commands to check status
  solutions: string[];       // Commands to fix it
}
```

**Files Affected**:
- `src/connection/finder.ts` - Target not found errors
- `src/daemon/ipcServer.ts` - All error responses
- `src/cli/commands/*.ts` - CLI error handling

**Implementation**:
```typescript
// src/utils/errors.ts (new file)
class BdgError extends Error {
  constructor(
    message: string,
    public causes?: string[],
    public diagnostics?: string[],
    public solutions?: string[]
  ) {
    super(message);
  }

  format(): string {
    let output = `Error: ${this.message}\n`;

    if (this.causes?.length) {
      output += `\nPossible causes:\n`;
      this.causes.forEach((c, i) => {
        output += `  ${i + 1}. ${c}\n`;
      });
    }

    if (this.diagnostics?.length) {
      output += `\nDiagnostics:\n`;
      this.diagnostics.forEach(d => {
        output += `  → ${d}\n`;
      });
    }

    if (this.solutions?.length) {
      output += `\nSolutions:\n`;
      this.solutions.forEach((s, i) => {
        output += `  ${i + 1}. ${s}\n`;
      });
    }

    return output;
  }
}
```

**Impact**: MEDIUM - Improves user experience significantly

**Effort**: MEDIUM - Requires error message audit and rewrite

**Risk**: LOW - Backward compatible, just better messages

---

### 6. No SSR Detection

**Problem**: SSR apps need longer initialization. DOM queries fail because React hasn't hydrated yet.

**SSR Workflow**:
```
1. Server returns HTML (0-2s)
2. Browser downloads JS bundles (1-3s)
3. React hydrates (2-5s)
4. Page interactive (total: 3-10s)
```

**Current Behavior**:
```bash
bdg localhost:3000
# Immediately queries DOM
bdg dom query "h1"
# → Elements exist but React hasn't hydrated
# → Incorrect results or timeout
```

**Proposed Solution**:

1. **Add --wait-for flag**:
   ```bash
   bdg localhost:3000 --wait-for "document.readyState === 'complete'"
   bdg localhost:3000 --wait-for "!!window.React"
   ```

2. **Add --ssr flag** (preset wait conditions):
   ```bash
   bdg localhost:3000 --ssr
   # Auto-waits for:
   #  - document.readyState === 'complete'
   #  - No pending network requests (idle 500ms)
   #  - Common hydration markers (data-reactroot, __NEXT_DATA__)
   ```

3. **Implementation**:
   ```typescript
   // src/cli/commands/start.ts
   interface StartOptions {
     waitFor?: string;  // JS expression to evaluate
     ssr?: boolean;     // Preset SSR detection
   }

   // After launching Chrome and navigating
   if (options.ssr) {
     await waitForSSRHydration(cdp, timeout);
   } else if (options.waitFor) {
     await waitForCondition(cdp, options.waitFor, timeout);
   }
   ```

4. **SSR Detection Logic**:
   ```typescript
   async function waitForSSRHydration(cdp: CDPConnection, timeoutMs: number): Promise<void> {
     const checks = [
       'document.readyState === "complete"',
       'performance.getEntriesByType("navigation")[0].loadEventEnd > 0',
       'document.querySelectorAll("[data-reactroot], [data-react-hydrated]").length > 0'
     ];

     const deadline = Date.now() + timeoutMs;
     while (Date.now() < deadline) {
       const result = await cdp.send('Runtime.evaluate', {
         expression: checks.join(' && '),
         returnByValue: true
       });
       if (result.result.value === true) return;
       await delay(500);
     }

     throw new Error(`SSR hydration timeout after ${timeoutMs}ms`);
   }
   ```

**Impact**: HIGH - Enables testing SSR applications

**Effort**: MEDIUM - Requires CDP evaluation logic

**Risk**: MEDIUM - Need to test with various frameworks (Next.js, Remix, SvelteKit)

---

### 7. Timeout Flag Confusion

**Problem**: `-t` flag controls session duration, but queries also timeout separately (hardcoded). User sets `-t 10` but queries still timeout at 5s.

**Current Behavior**:
```bash
bdg localhost:3000 -t 10          # Session timeout: 10s
bdg dom query "h1"                # Query timeout: 5s (hardcoded)
# Query can timeout before session!
```

**Files Affected**:
- `src/cli/commands/start.ts` - session timeout (-t flag)
- `src/daemon/ipcServer.ts` - query timeouts (hardcoded)

**Proposed Solution**:

1. **Separate flags**:
   ```bash
   bdg localhost:3000 \
     --session-timeout 30 \     # How long to keep session alive (alias: -t)
     --query-timeout 10         # How long to wait for each query
   ```

2. **Implementation**:
   ```typescript
   // CLI options
   interface StartOptions {
     sessionTimeout?: number;   // -t, --session-timeout (default: infinite)
     queryTimeout?: number;     // --query-timeout (default: 10s)
   }

   // Store in session metadata
   interface SessionMetadata {
     queryTimeout?: number;  // Pass to daemon for IPC
   }

   // Daemon uses from metadata
   const timeout = metadata.queryTimeout ?? 10000;
   setTimeout(() => { ... }, timeout);
   ```

3. **Environment variable fallback**:
   ```bash
   export BDG_QUERY_TIMEOUT=15000  # 15s default
   bdg localhost:3000              # Uses env var
   ```

**Impact**: MEDIUM - Clarifies timeout behavior

**Effort**: MEDIUM - Requires plumbing query timeout through IPC

**Risk**: LOW - Backward compatible (defaults unchanged)

---

## Feature Requests ✨

### 8. Auto-wait for Page Ready

**User Request**:
```bash
bdg localhost:3000 --wait-for "document.readyState === 'complete'"
bdg localhost:3000 --ssr  # Built-in SSR mode
```

**Status**: See Issue #6 analysis above

---

### 9. Session Recovery

**Problem**: If session crashes, all state is lost. Can't reconnect to existing Chrome instance.

**Proposed Solution**:

1. **Reconnect command**:
   ```bash
   bdg reconnect             # Find existing Chrome on port 9222
   bdg reconnect --port 9223 # Specific port
   ```

2. **Implementation**:
   ```typescript
   // Check for Chrome on port without launching
   const targets = await fetchCDPTargets(port);
   if (targets.length === 0) {
     throw new Error(`No Chrome instance found on port ${port}`);
   }

   // Connect to first target (or user-selected)
   const target = targets[0];
   await connectToTarget(target.webSocketDebuggerUrl);

   // Create new session metadata
   writeSessionMetadata({
     chromePid: undefined,  // Don't manage this Chrome
     targetId: target.id,
     webSocketDebuggerUrl: target.webSocketDebuggerUrl,
     reconnected: true       // Flag to skip Chrome shutdown on stop
   });
   ```

3. **Use case**:
   ```bash
   # Chrome crashes or bdg loses connection
   chrome --remote-debugging-port=9222 &  # Manual Chrome
   bdg reconnect                          # Reconnect to it
   bdg dom query "h1"                     # Continue working
   ```

**Impact**: LOW - Nice to have, not critical

**Effort**: MEDIUM - Requires connection without launch

**Risk**: MEDIUM - Need to handle unmanaged Chrome lifecycle

---

### 10. Better Status Output

**Current**:
```bash
bdg status
Status: Active
Worker PID: 12345
Chrome PID: 67890
Target: http://localhost:3000
```

**Proposed**:
```bash
bdg status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Session Status: Active
Duration: 2m 15s

Process Information:
  Daemon PID:     12340
  Worker PID:     12345
  Chrome PID:     67890

Target Information:
  URL:            http://localhost:3000/customer/signin
  Title:          Sign In - My App
  Load State:     Complete
  DOM Ready:      Yes (15s ago)
  JavaScript:     Active

Activity:
  Queries:        12 executed
  Last Query:     3s ago (dom query "h1")
  Network Reqs:   45 captured
  Console Logs:   23 captured
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Implementation**:
```typescript
// Track activity in worker
interface SessionActivity {
  queriesExecuted: number;
  lastQueryTime: number;
  lastQueryCommand: string;
  networkRequestsCaptured: number;
  consoleLogsCaptured: number;
}

// Include in status response
interface StatusResponseData {
  // ... existing fields
  activity?: SessionActivity;
  pageState?: {
    title: string;
    loadState: 'loading' | 'interactive' | 'complete';
    domReady: boolean;
    domReadyAt?: number;
  };
}
```

**Impact**: LOW - Cosmetic improvement

**Effort**: MEDIUM - Requires activity tracking

**Risk**: LOW - Display only, doesn't affect core functionality

---

## Implementation Priority

### Phase 1: Critical Reliability (v0.2.0)
**Goal**: Make bdg reliable for basic workflows

1. ✅ Auto-cleanup stale sessions (#1)
   - Effort: LOW | Impact: HIGH | Risk: LOW
   - Files: `src/daemon/ipcServer.ts`, `src/session/cleanup.ts`

2. ✅ Fix Chrome launch validation (#4)
   - Effort: LOW | Impact: HIGH | Risk: LOW
   - Files: `src/connection/launcher.ts`

3. ✅ Port conflict detection (#2)
   - Effort: MEDIUM | Impact: HIGH | Risk: LOW
   - Files: `src/connection/launcher.ts`, `src/utils/port.ts` (new)

4. ✅ Increase daemon timeout (#3)
   - Effort: LOW | Impact: HIGH | Risk: LOW
   - Files: `src/daemon/ipcServer.ts` (line 302)

### Phase 2: UX Improvements (v0.3.0)
**Goal**: Make errors understandable and actionable

5. ⬜ Improve error messages (#5)
   - Effort: MEDIUM | Impact: MEDIUM | Risk: LOW
   - Files: All error handling code

6. ⬜ Separate timeout flags (#7)
   - Effort: MEDIUM | Impact: MEDIUM | Risk: LOW
   - Files: `src/cli/commands/*.ts`, `src/daemon/ipcServer.ts`

### Phase 3: SSR Support (v0.4.0)
**Goal**: Enable testing SSR applications

7. ⬜ SSR detection and wait conditions (#6, #8)
   - Effort: MEDIUM | Impact: HIGH | Risk: MEDIUM
   - Files: `src/cli/commands/start.ts`, `src/daemon/worker.ts`

### Phase 4: Advanced Features (v0.5.0)
**Goal**: Power user features

8. ⬜ Session reconnect (#9)
   - Effort: MEDIUM | Impact: LOW | Risk: MEDIUM
   - Files: `src/cli/commands/*.ts`, `src/daemon/startSession.ts`

9. ⬜ Enhanced status output (#10)
   - Effort: MEDIUM | Impact: LOW | Risk: LOW
   - Files: `src/cli/commands/status.ts`, `src/daemon/worker.ts`

---

## Breaking Changes

None of these improvements require breaking changes. All are:
- Backward compatible
- Additive (new flags/features)
- Error handling improvements
- Internal implementation fixes

---

## Testing Strategy

### Phase 1 Testing:
```bash
# Test stale session cleanup
pkill -9 -f bdg                     # Simulate crash
bdg localhost:3000                  # Should auto-cleanup

# Test port conflict
chrome --remote-debugging-port=9222 &
bdg localhost:3000                  # Should show clear error

# Test Chrome launch validation
# (Use mocked chrome-launcher that returns PID: 0)

# Test daemon timeout
bdg localhost:3000
sleep 2
bdg dom query "slow-element"        # Should wait 10s now
```

### Phase 2 Testing:
```bash
# Test error messages
bdg http://not-running-server.local # Improved error
bdg cleanup                         # Verify messages helpful
```

### Phase 3 Testing:
```bash
# Test SSR mode with Next.js app
cd test-apps/nextjs-ssr
npm run dev
bdg localhost:3000 --ssr            # Wait for hydration
bdg dom query "[data-testid=content]"
```

---

## Success Metrics

### Phase 1 Success Criteria:
- ✅ Zero manual cleanup commands needed in happy path
- ✅ Clear error messages when port conflicts occur
- ✅ No false "Chrome launched successfully (PID: 0)" messages
- ✅ DOM queries succeed on SSR apps (10s timeout)

### Phase 2 Success Criteria:
- ✅ Users can understand what went wrong from error messages alone
- ✅ Timeout flags work as expected (session vs query)

### Phase 3 Success Criteria:
- ✅ SSR applications work without manual delays
- ✅ Next.js, Remix, SvelteKit apps supported

### Overall Goal:
- Rating improvement from 6/10 → 8/10
- Zero "why doesn't this work?" confusion
- Reliable for AI agent workflows

---

## Questions for Maintainer

1. **Daemon Shutdown**: Should daemon auto-shutdown when last session stops, or stay alive?
   - Current: Daemon stays alive
   - Alternative: Auto-shutdown after session stop
   - Recommendation: Keep current (fast startup), add `bdg daemon stop` command

2. **Default Timeouts**: What should defaults be?
   - Current: 5s (peek), 10s (commands)
   - Proposed: 10s (peek), 10s (commands)
   - Recommendation: Make both 10s, add `--query-timeout` flag

3. **SSR Detection**: Which frameworks to prioritize?
   - Next.js (highest priority - most popular)
   - Remix
   - SvelteKit
   - Astro (SSR mode)
   - Other?

4. **Error Verbosity**: How detailed should error messages be?
   - Proposal: Detailed by default, `--quiet` flag for minimal
   - Alternative: Minimal by default, `--verbose` for details
   - Recommendation: Detailed by default (CLI tool for debugging)

---

## Related Issues

- Create GitHub issues for each phase
- Link to this analysis document
- Use labels: `priority:high`, `priority:medium`, `priority:low`

---

## Document Maintenance

- Update this doc as issues are resolved
- Mark completed items with ✅
- Add new issues discovered during implementation
- Keep success metrics updated

---

**Last Updated**: 2025-11-05
**Next Review**: After Phase 1 completion
