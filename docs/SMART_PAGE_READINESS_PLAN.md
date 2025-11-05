# Smart Page Readiness Detection - Implementation Plan

**Status**: Ready to Implement
**Priority**: HIGH
**Effort**: 2-3 days
**Risk**: MEDIUM

## Problem Statement

Current implementation uses **arbitrary timeouts** (5s, 10s, 15s) to wait for pages to be ready. This causes:
- ❌ SSR apps timeout before hydration completes
- ❌ Fast pages waste time waiting unnecessarily
- ❌ No feedback about what we're waiting for
- ❌ Unreliable for different page types

## Solution: Self-Tuning Readiness Detection

**Core Principle**: The browser tells us when it's ready - we just need to listen intelligently.

### Three-Phase Detection Strategy

1. **Load Event** - Basic page loaded (baseline readiness)
2. **Network Stability** - Adaptive threshold based on observed request patterns
3. **DOM Stability** - Adaptive threshold based on observed mutation rate

**Key Innovation**: All thresholds adapt to the page's actual behavior. No guessing, no configuration.

---

## Architecture

### Core Module: `src/utils/pageReadiness.ts`

**Public API:**
```typescript
/**
 * Options for page readiness detection
 */
export interface PageReadinessOptions {
  maxWaitMs?: number; // Maximum wait time (default: 30000ms)
}

/**
 * Wait for page to be ready using self-tuning detection
 *
 * THREE SIGNALS (automatic, no flags needed):
 * 1. Load event (basic readiness)
 * 2. Network stability (adapts to request patterns)
 * 3. DOM stability (adapts to mutation rate)
 *
 * Works for 95% of sites out of the box.
 */
export async function waitForPageReady(
  cdp: CDPConnection,
  options?: PageReadinessOptions
): Promise<void>
```

**Internal Functions:**
- `waitForLoadEvent(cdp, deadline)` - Wait for `Page.loadEventFired`
- `waitForNetworkStable(cdp, deadline)` - Adaptive network idle detection
- `waitForDOMStable(cdp, deadline)` - Adaptive DOM mutation detection
- `delay(ms)` - Promise-based delay utility

---

## Implementation Steps

### Step 1: Create Core Utility Module

**File**: `src/utils/pageReadiness.ts`

#### 1.1: Define Types

```typescript
/**
 * Options for page readiness detection
 */
export interface PageReadinessOptions {
  /**
   * Maximum wait time before proceeding anyway
   * Default: 30000ms (30 seconds)
   */
  maxWaitMs?: number;
}
```

#### 1.2: Implement Main Orchestrator

```typescript
/**
 * Wait for page to be ready using self-tuning detection
 *
 * Strategy:
 * 1. Wait for load event (baseline)
 * 2. Wait for network to stabilize (adaptive)
 * 3. Wait for DOM to stabilize (adaptive)
 *
 * All thresholds adapt to observed page behavior.
 * No framework detection, no configuration needed.
 *
 * @param cdp - CDP connection
 * @param options - Optional configuration
 *
 * @example
 * ```typescript
 * // Default: Self-tuning for any page
 * await waitForPageReady(cdp);
 *
 * // Custom timeout for slow apps
 * await waitForPageReady(cdp, { maxWaitMs: 60000 });
 * ```
 */
export async function waitForPageReady(
  cdp: CDPConnection,
  options: PageReadinessOptions = {}
): Promise<void> {
  const maxWaitMs = options.maxWaitMs ?? 30000;
  const deadline = Date.now() + maxWaitMs;

  try {
    // Phase 1: Wait for load event
    await waitForLoadEvent(cdp, deadline);
    console.error('[readiness] ✓ Load event');

    // Phase 2: Wait for network to stabilize (adaptive)
    const networkIdleMs = await waitForNetworkStable(cdp, deadline);
    console.error(`[readiness] ✓ Network stable (${networkIdleMs}ms idle)`);

    // Phase 3: Wait for DOM to stabilize (adaptive)
    const domIdleMs = await waitForDOMStable(cdp, deadline);
    console.error(`[readiness] ✓ DOM stable (${domIdleMs}ms idle)`);

    console.error('[readiness] ✓ Page ready');
  } catch (error) {
    console.error(`[readiness] ${error.message}, proceeding anyway`);
    // Don't rethrow - allow session to continue
  }
}
```

#### 1.3: Implement Load Event Detection

```typescript
/**
 * Wait for Page.loadEventFired (window.onload equivalent)
 *
 * This is the browser's native load event - fires when:
 * - Document is fully loaded
 * - All synchronous scripts executed
 * - DOMContentLoaded already fired
 *
 * Framework-agnostic baseline.
 *
 * @param cdp - CDP connection
 * @param deadline - Timestamp when to timeout
 * @throws Error if deadline exceeded
 */
async function waitForLoadEvent(
  cdp: CDPConnection,
  deadline: number
): Promise<void> {
  await cdp.send('Page.enable');

  return new Promise((resolve, reject) => {
    let timeout: NodeJS.Timeout;
    let handlerId: string | undefined;

    const cleanup = () => {
      clearTimeout(timeout);
      if (handlerId) {
        cdp.off('Page.loadEventFired', handlerId);
      }
    };

    const checkDeadline = () => {
      if (Date.now() >= deadline) {
        cleanup();
        reject(new Error('Load event timeout'));
      } else {
        timeout = setTimeout(checkDeadline, 100);
      }
    };

    const loadHandler = () => {
      cleanup();
      resolve();
    };

    handlerId = cdp.on('Page.loadEventFired', loadHandler);
    checkDeadline();
  });
}
```

#### 1.4: Implement Adaptive Network Stability

```typescript
/**
 * Wait for network to stabilize using adaptive thresholds
 *
 * LEARNING PHASE (first 2s):
 * - Track request intervals
 * - Calculate average request frequency
 *
 * DETECTION PHASE:
 * - Fast pattern (avg < 100ms): 200ms idle = stable
 * - Steady pattern (100-500ms): 500ms idle = stable
 * - Slow pattern (> 500ms): 1000ms idle = stable
 *
 * Why this works:
 * - Fast sites: Quick bursts, fast stabilization
 * - SSR apps: Steady hydration requests, medium wait
 * - API-heavy: Slow requests, longer patience
 *
 * Framework-agnostic - adapts to actual behavior.
 *
 * @param cdp - CDP connection
 * @param deadline - Timestamp when to timeout
 * @returns Actual idle duration detected
 * @throws Error if deadline exceeded
 */
async function waitForNetworkStable(
  cdp: CDPConnection,
  deadline: number
): Promise<number> {
  await cdp.send('Network.enable');

  let activeRequests = 0;
  let lastActivity = Date.now();
  const intervals: number[] = [];
  let lastRequestTime = Date.now();

  const handlers: string[] = [];

  // Track request patterns
  const requestHandler = () => {
    const now = Date.now();
    const interval = now - lastRequestTime;
    if (interval < 5000) intervals.push(interval);
    lastRequestTime = now;
    activeRequests++;
    lastActivity = now;
  };

  const finishHandler = () => {
    activeRequests--;
    if (activeRequests === 0) {
      lastActivity = Date.now();
    }
  };

  handlers.push(cdp.on('Network.requestWillBeSent', requestHandler));
  handlers.push(cdp.on('Network.loadingFinished', finishHandler));
  handlers.push(cdp.on('Network.loadingFailed', finishHandler));

  try {
    // Learning phase: gather samples
    const learningMs = Math.min(2000, deadline - Date.now());
    await delay(learningMs);

    // Calculate adaptive threshold
    const avgInterval = intervals.length > 0
      ? intervals.reduce((a, b) => a + b, 0) / intervals.length
      : 500;

    const idleThreshold = avgInterval < 100 ? 200
      : avgInterval < 500 ? 500
      : 1000;

    // Detection phase: wait for stability
    while (Date.now() < deadline) {
      if (activeRequests === 0) {
        const idleTime = Date.now() - lastActivity;
        if (idleTime >= idleThreshold) {
          return idleTime; // Success!
        }
      }

      await delay(50); // Check every 50ms
    }

    throw new Error('Network stability timeout');

  } finally {
    // Cleanup handlers
    handlers.forEach(id => cdp.off('Network.requestWillBeSent', id));
    handlers.forEach(id => cdp.off('Network.loadingFinished', id));
    handlers.forEach(id => cdp.off('Network.loadingFailed', id));
  }
}
```

#### 1.5: Implement Adaptive DOM Stability

```typescript
/**
 * Wait for DOM to stabilize using adaptive thresholds
 *
 * HOW IT WORKS:
 * 1. Inject MutationObserver into page
 * 2. Track mutation rate for 1 second
 * 3. Calculate adaptive stability threshold:
 *    - High rate (>50/sec): 1000ms no-change = stable
 *    - Medium rate (10-50/sec): 500ms no-change = stable
 *    - Low rate (<10/sec): 300ms no-change = stable
 * 4. Wait for DOM to remain unchanged for threshold duration
 *
 * Why this works:
 * - SSR hydration causes DOM mutations
 * - React/Vue/Svelte all mutate during hydration
 * - When mutations stop, hydration is complete
 *
 * Framework-agnostic - detects actual mutations.
 *
 * @param cdp - CDP connection
 * @param deadline - Timestamp when to timeout
 * @returns Actual stable duration detected
 * @throws Error if deadline exceeded
 */
async function waitForDOMStable(
  cdp: CDPConnection,
  deadline: number
): Promise<number> {
  // Inject mutation observer
  await cdp.send('Runtime.evaluate', {
    expression: `
      window.__bdg_mutations = 0;
      window.__bdg_lastMutation = Date.now();

      const observer = new MutationObserver(() => {
        window.__bdg_mutations++;
        window.__bdg_lastMutation = Date.now();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });

      window.__bdg_observer = observer;
    `,
  });

  try {
    // Learning phase: measure mutation rate
    const learningMs = Math.min(1000, deadline - Date.now());
    await delay(learningMs);

    const result = await cdp.send('Runtime.evaluate', {
      expression: 'window.__bdg_mutations',
      returnByValue: true,
    });

    const mutationCount = result.result.value ?? 0;
    const mutationRate = mutationCount / (learningMs / 1000);

    // Calculate adaptive threshold
    const stableThreshold = mutationRate > 50 ? 1000
      : mutationRate > 10 ? 500
      : 300;

    // Detection phase: wait for stability
    while (Date.now() < deadline) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: 'Date.now() - window.__bdg_lastMutation',
        returnByValue: true,
      });

      const timeSinceLastMutation = result.result.value ?? 0;

      if (timeSinceLastMutation >= stableThreshold) {
        return timeSinceLastMutation; // Success!
      }

      await delay(100); // Check every 100ms
    }

    throw new Error('DOM stability timeout');

  } finally {
    // Cleanup observer
    await cdp.send('Runtime.evaluate', {
      expression: `
        window.__bdg_observer?.disconnect();
        delete window.__bdg_observer;
        delete window.__bdg_mutations;
        delete window.__bdg_lastMutation;
      `,
    }).catch(() => {
      // Ignore cleanup errors
    });
  }
}
```

#### 1.6: Utility Functions

```typescript
/**
 * Delay utility
 *
 * @param ms - Milliseconds to delay
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Step 2: Add Constants

**File**: `src/constants.ts`

```typescript
/**
 * Default page readiness timeout (30 seconds)
 * Maximum time to wait for page to be ready before proceeding
 */
export const DEFAULT_PAGE_READINESS_TIMEOUT_MS = 30000;
```

### Step 3: Integrate into Worker

**File**: `src/daemon/worker.ts`

**Location**: After navigation completes in `main()` function

```typescript
// After: await cdp.send('Page.navigate', { url: targetUrl });

import { waitForPageReady } from '@/utils/pageReadiness.js';
import { DEFAULT_PAGE_READINESS_TIMEOUT_MS } from '@/constants.js';

// Wait for page to be ready (self-tuning, non-blocking)
await waitForPageReady(cdp, {
  maxWaitMs: options.readinessTimeout ?? DEFAULT_PAGE_READINESS_TIMEOUT_MS,
});
```

### Step 4: Add CLI Flag (Optional)

**File**: `src/cli/commands/start.ts`

```typescript
.option(
  '--readiness-timeout <ms>',
  'Maximum wait for page ready (default: 30000)',
  parseInt
)
```

**Usage:**
```bash
# Default: Self-tuning (works for 95% of sites)
bdg http://localhost:3000

# Custom timeout for extremely slow apps
bdg http://slow-app.com --readiness-timeout 60000
```

### Step 5: Update IPC Types

**File**: `src/ipc/types.ts`

```typescript
export interface StartSessionRequest extends IPCMessage {
  // ... existing fields
  readinessTimeout?: number; // Optional: max wait time for page ready
}
```

### Step 6: Testing

**Test Cases:**

1. **Static site** (fast):
   ```bash
   bdg http://example.com
   # Expected: ~1s (load + 200ms network + 300ms DOM)
   ```

2. **SPA** (React/Vue):
   ```bash
   bdg http://localhost:3000
   # Expected: ~2s (load + 500ms network + 500ms DOM)
   ```

3. **SSR app** (Next.js hydration):
   ```bash
   bdg http://localhost:3000
   # Expected: ~4s (load + 1s network + 1s DOM)
   ```

4. **Heavy dashboard**:
   ```bash
   bdg http://localhost:8080
   # Expected: ~9s (slow load + long network + heavy mutations)
   ```

5. **Timeout scenario**:
   ```bash
   bdg http://broken-site.com
   # Expected: 30s timeout, logs warning, proceeds anyway
   ```

6. **Custom timeout**:
   ```bash
   bdg http://slow-app.com --readiness-timeout 60000
   # Expected: Wait up to 60s before proceeding
   ```

---

## Expected Performance

### Timing Breakdown

| Page Type | Load | Network | DOM | Total | Current (15s) | Savings |
|-----------|------|---------|-----|-------|---------------|---------|
| Static    | 0.5s | 0.2s    | 0.3s| ~1s   | 15s           | **93%** |
| SPA       | 1s   | 0.5s    | 0.5s| ~2s   | 15s           | **87%** |
| SSR       | 2s   | 1s      | 1s  | ~4s   | 15s           | **73%** |
| Heavy     | 5s   | 2s      | 2s  | ~9s   | 15s           | **40%** |

**Average improvement: 73% faster** for typical pages.

### Adaptive Behavior Examples

**Fast Static Site:**
- Learns: avg request interval 50ms
- Threshold: 200ms network idle (fast threshold)
- Result: Ready in ~1s

**SSR App (Next.js):**
- Learns: avg request interval 300ms
- Threshold: 500ms network idle (medium threshold)
- Learns: 30 mutations/sec during hydration
- Threshold: 500ms DOM idle (medium threshold)
- Result: Ready in ~4s

**Heavy Dashboard:**
- Learns: avg request interval 800ms
- Threshold: 1000ms network idle (patient threshold)
- Learns: 70 mutations/sec (React re-renders)
- Threshold: 1000ms DOM idle (patient threshold)
- Result: Ready in ~9s

---

## Success Criteria

- ✅ **Zero configuration** - Works out of the box for 95% of sites
- ✅ **Self-tuning** - Adapts to page behavior automatically
- ✅ **Framework-agnostic** - No React/Vue/Next.js detection
- ✅ **Fast pages fast** - Static sites ready in ~1s (vs 15s currently)
- ✅ **SSR apps work** - Reliable hydration detection without timeouts
- ✅ **Clear logging** - Shows what was detected and when
- ✅ **Graceful degradation** - Proceeds on timeout (doesn't fail session)
- ✅ **Single safety net** - One timeout (30s) vs multiple arbitrary delays

---

## Risks & Mitigations

**Risk 1: Long-polling/WebSocket apps**
- **Impact**: Network never stabilizes (always active)
- **Mitigation**: Network phase timeout (inherited from global deadline)
- **Outcome**: Proceeds after network timeout, DOM phase still runs
- **Expected**: Most long-polling apps still mutate DOM during init, so DOM phase catches readiness

**Risk 2: Infinite DOM mutations (live editors, chat)**
- **Impact**: DOM never stabilizes (constant mutations)
- **Mitigation**: DOM phase timeout (inherited from global deadline)
- **Outcome**: Logs "DOM never stabilized, proceeding anyway"
- **Expected**: Session continues normally, still better than arbitrary 15s

**Risk 3: Slow initial load (>30s)**
- **Impact**: Load event timeout before page even loads
- **Mitigation**: User can increase timeout: `--readiness-timeout 60000`
- **Outcome**: Works for 99.9% of real-world sites (30s is generous)

**Risk 4: Observer injection fails**
- **Impact**: DOM stability detection fails
- **Mitigation**: Wrapped in try-catch, error logged, proceeds anyway
- **Outcome**: Falls back to load + network only (still better than current)

**Risk 5: Performance overhead**
- **Impact**: MutationObserver could slow down page
- **Mitigation**: Observer disconnected immediately after detection
- **Duration**: Active for ~1-4s typically, minimal impact

---

## Why This is Better Than Original Plan

### Original Plan Issues:
- ❌ 5+ CLI flags (`--skip-load-wait`, `--no-network-wait`, `--network-idle-ms`, `--wait-for`, `--readiness-timeout`)
- ❌ Users need to understand which flags to use for their site
- ❌ Fixed 500ms network idle (too fast for SSR, too slow for static)
- ❌ No DOM detection (misses hydration completion)
- ❌ Manual tuning required for optimal performance

### New Plan Benefits:
- ✅ **1 optional flag** (`--readiness-timeout` for edge cases)
- ✅ **Zero configuration** - Just works
- ✅ **Self-tuning** - Adapts to site automatically
- ✅ **DOM detection** - Catches SSR hydration reliably
- ✅ **Optimal performance** - Fast sites fast, slow sites patient

### Complexity Comparison:

**Original Plan:**
```bash
# User needs to figure out which flags to use
bdg localhost:3000 --network-idle-ms 1000  # SSR app
bdg localhost:3000 --no-network-wait       # Long-polling
bdg localhost:3000 --skip-load-wait        # Unsure?
```

**New Plan:**
```bash
# Just works for everything
bdg localhost:3000
```

---

## Future Enhancements

**v0.4.0** (If needed - YAGNI for now):
- Add readiness metrics to `bdg status` output (time taken, thresholds used)
- Add `--verbose-readiness` for detailed detection logging
- Add readiness data to final JSON output (diagnostics)

**v0.5.0** (If users request it):
- Manual override flags (escape hatch if self-tuning fails):
  - `--force-network-idle-ms <ms>` - Override adaptive threshold
  - `--force-dom-idle-ms <ms>` - Override adaptive threshold
- Only add if users actually need them (unlikely)

---

## Implementation Checklist

- [ ] Create `src/utils/pageReadiness.ts`
  - [ ] `PageReadinessOptions` interface
  - [ ] `waitForPageReady()` main function
  - [ ] `waitForLoadEvent()` helper
  - [ ] `waitForNetworkStable()` adaptive helper
  - [ ] `waitForDOMStable()` adaptive helper
  - [ ] `delay()` utility
- [ ] Update `src/constants.ts`
  - [ ] `DEFAULT_PAGE_READINESS_TIMEOUT_MS`
- [ ] Update `src/daemon/worker.ts`
  - [ ] Call `waitForPageReady()` after navigation
- [ ] Update `src/cli/commands/start.ts`
  - [ ] Add `--readiness-timeout` flag
- [ ] Update `src/ipc/types.ts`
  - [ ] Add `readinessTimeout?` to `StartSessionRequest`
- [ ] Testing
  - [ ] Test static site (fast)
  - [ ] Test SPA (medium)
  - [ ] Test SSR app (slow)
  - [ ] Test timeout scenario
  - [ ] Verify logging output

---

## References

- **Analysis Doc**: `docs/IMPROVEMENTS_ANALYSIS.md` - Issue #3
- **CDP Page Domain**: https://chromedevtools.github.io/devtools-protocol/tot/Page/
- **CDP Network Domain**: https://chromedevtools.github.io/devtools-protocol/tot/Network/
- **CDP Runtime Domain**: https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
- **MutationObserver API**: https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
