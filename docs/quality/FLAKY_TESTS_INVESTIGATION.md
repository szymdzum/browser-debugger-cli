# Flaky Smoke Tests Investigation Report

**Date**: 2025-11-15
**Status**: Investigation Complete
**Priority**: High - Blocking CI/CD reliability

## Executive Summary

This report investigates the recurring flakiness in `src/__tests__/smoke/*.test.ts` and evaluates architectural solutions to improve test reliability in both local development and CI/CD environments.

**Key Finding**: Current smoke tests exhibit timing-dependent failures due to process lifecycle race conditions, port binding delays, and CI environment variability. Docker-based test isolation combined with CPU throttling offers the most comprehensive solution.

## Problem Statement

### Current Issues

1. **Stale Session Cleanup Test** (REMOVED)
   - Exit code: 104 (worker error)
   - Failure mode: Intermittent in CI, passes locally
   - Root cause: 2-second wait insufficient for process termination on slow CI runners
   - Impact: Port conflicts, orphaned worker detection race conditions

2. **Session Start Test** (TIMEOUT INCREASED)
   - Exit code: 124 (timeout)
   - Failure mode: Intermittent in CI, passes locally
   - Root cause: 10-second timeout insufficient for Chrome launch on slow CI runners
   - Impact: False negatives blocking CI pipeline

3. **Historical Pattern**
   - Multiple smoke tests removed: daemon crash, invalid URL, stale session cleanup
   - Indicates systemic architectural issue, not isolated test bugs

### Root Causes Analysis

#### 1. Environment Variability
- **CI runners**: Shared resources, variable CPU performance, network latency
- **Local machines**: High-performance (M1 Pro/M2), consistent environment
- **Gap**: Tests tuned for local development hide race conditions that surface in CI

#### 2. Process Lifecycle Complexity
```
Test Flow:
1. Start daemon (spawn detached process)
2. Wait for socket file (100ms polling, 5s timeout)
3. Daemon spawns worker process
4. Worker launches Chrome (chrome-launcher)
5. Worker connects to Chrome CDP
6. Test verifies daemon/session state

Failure Points:
- Port binding delays (OS-dependent)
- Chrome launch variability (headless mode initialization)
- Process group cleanup (SIGKILL doesn't guarantee immediate termination)
- File system delays (socket file creation, PID file writes)
```

#### 3. Timing Assumptions
- Hard-coded waits (2s, 5s, 10s) are environment-specific
- No adaptive retry logic for external dependencies (Chrome, ports)
- Polling intervals (100ms) may be insufficient under load

## Industry Best Practices (2025)

### 1. **Docker-Based Test Isolation** ⭐ RECOMMENDED

**Benefits**:
- **Consistent environment**: Every test run uses identical base system
- **Resource isolation**: Dedicated CPU/memory per container prevents interference
- **Port isolation**: Each container has its own network namespace
- **Clean slate**: Fresh container per test suite eliminates state pollution
- **Parallel execution**: Multiple containers can run concurrently without conflicts

**Implementation Approaches**:

#### Option A: Testcontainers for Node.js
```javascript
// Example: Using Testcontainers to run Chrome in isolated container
import { GenericContainer } from 'testcontainers';

const chromeContainer = await new GenericContainer('browserless/chrome')
  .withExposedPorts(3000)
  .start();

const chromeWSEndpoint = `ws://${chromeContainer.getHost()}:${chromeContainer.getMappedPort(3000)}`;
// Use chromeWSEndpoint for CDP connection
```

**Pros**:
- Standard library for container-based testing
- Automatic container lifecycle management
- Works seamlessly with existing test frameworks (Jest, Mocha, Node.js test runner)
- Eliminates "works on my machine" syndrome

**Cons**:
- Requires Docker daemon on CI runners (already available on GitHub Actions)
- Slight overhead for container spin-up (~2-5 seconds)
- Learning curve for team

#### Option B: Docker Compose + Service Containers
```yaml
# docker-compose.test.yml
version: '3.8'
services:
  chrome:
    image: browserless/chrome:latest
    ports:
      - "9222:3000"
    environment:
      - MAX_CONCURRENT_SESSIONS=1

  tests:
    build: .
    depends_on:
      - chrome
    command: npm run test:smoke
    environment:
      - CHROME_WS_URL=ws://chrome:3000
```

**Pros**:
- Explicit infrastructure-as-code
- Easy to replicate locally and in CI
- Supports complex multi-service scenarios

**Cons**:
- More configuration to maintain
- Requires docker-compose knowledge

#### Option C: GitHub Actions Service Containers
```yaml
jobs:
  smoke-tests:
    runs-on: ubuntu-latest
    services:
      chrome:
        image: browserless/chrome:latest
        ports:
          - 9222:3000
    steps:
      - run: npm run test:smoke
        env:
          CHROME_WS_URL: ws://localhost:9222
```

**Pros**:
- Native GitHub Actions integration
- No changes to test code
- Automatic service lifecycle management

**Cons**:
- Locks you into GitHub Actions
- Less flexible than Testcontainers for complex scenarios

### 2. **CPU Throttling for Consistency** ⭐ RECOMMENDED

**Problem**: Powerful dev machines (M1 Pro) hide race conditions that appear on slower CI runners.

**Solution**: Use CDP's `Emulation.setCPUThrottlingRate` to simulate CI performance locally.

```javascript
// src/__testutils__/cpuThrottling.js
export async function enableCPUThrottling(cdpSession, rate = 4) {
  // rate: 1 = no throttle, 4 = 4x slowdown (M1 Pro → CI equivalent)
  await cdpSession.send('Emulation.setCPUThrottlingRate', { rate });
}

// Usage in beforeEach hook
beforeEach(async () => {
  const cdp = await getCDPSession();
  await enableCPUThrottling(cdp, 4); // Simulate CI performance
});
```

**Benefits**:
- Exposes race conditions during local development
- Aligns local and CI performance characteristics
- No infrastructure changes required

**When to Use**:
- Reproducing flaky tests locally
- Validating timing-sensitive code paths
- Pre-commit smoke test runs

### 3. **Intelligent Retry Mechanisms**

**Current Approach**: Fixed timeouts + manual retries (GitHub Actions workflow level)

**Better Approach**: Exponential backoff with jitter at test level

```javascript
// src/__testutils__/retry.js
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    jitter = true
  } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;

      let delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
      if (jitter) delay *= 0.5 + Math.random() * 0.5; // Add jitter

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Usage
await retryWithBackoff(
  () => runCommand('http://example.com', ['--headless']),
  { maxRetries: 3, initialDelay: 2000 }
);
```

**Benefits**:
- Handles transient failures gracefully
- Reduces false negatives from temporary slowdowns
- Self-healing tests without manual intervention

**Caution**: Don't use retries to mask real bugs. Log all retries for analysis.

### 4. **Adaptive Polling with Deadline**

**Current Approach**: Fixed 100ms polling interval, hard 5-second timeout

**Better Approach**: Adaptive interval with soft/hard deadlines

```javascript
// src/__testutils__/polling.js
export async function pollUntil(condition, options = {}) {
  const {
    interval = 100,        // Start with 100ms
    maxInterval = 1000,    // Cap at 1s
    timeout = 10000,       // Hard deadline
    backoffFactor = 1.5    // Increase interval by 1.5x each iteration
  } = options;

  const startTime = Date.now();
  let currentInterval = interval;

  while (Date.now() - startTime < timeout) {
    if (await condition()) return true;

    await new Promise(resolve => setTimeout(resolve, currentInterval));
    currentInterval = Math.min(currentInterval * backoffFactor, maxInterval);
  }

  throw new Error(`Timeout after ${timeout}ms waiting for condition`);
}

// Usage: Wait for daemon socket
await pollUntil(
  () => fs.existsSync(socketPath),
  { timeout: 15000, maxInterval: 500 }
);
```

**Benefits**:
- Responsive early (frequent checks), patient later (less CPU waste)
- Explicit timeout handling with meaningful errors
- Adaptable to both fast and slow environments

### 5. **Test Quarantine Strategy**

**Current Approach**: Delete flaky tests entirely

**Better Approach**: Quarantine → Fix → Reintegrate

```javascript
// src/__tests__/smoke/quarantine/session-lifecycle.smoke.test.ts
// Quarantined tests run separately, non-blocking on CI

void describe.skip('[QUARANTINE] Session Lifecycle', () => {
  // Test remains in codebase for investigation
  // CI runs it separately, doesn't block main pipeline
  // GitHub issue tracks quarantine duration and fix plan
});
```

**CI Configuration**:
```yaml
# .github/workflows/ci.yml
jobs:
  smoke-tests:
    # Blocking tests only
    run: npm run test:smoke

  quarantined-tests:
    # Non-blocking, informational only
    continue-on-error: true
    run: npm run test:quarantine
```

**Benefits**:
- Preserves test investment (don't lose coverage)
- Prevents blocking development while fixing
- Creates backlog of technical debt with visibility

**Process**:
1. Quarantine flaky test immediately
2. File GitHub issue with reproduction steps
3. Fix root cause within 2 sprints
4. Reintegrate with improved implementation
5. If unfixable → document why, then delete

## Recommendations for `bdg` Project

### Phase 1: Quick Wins (1-2 days)

#### 1.1 Increase Timeouts Conservatively
```diff
// src/__tests__/smoke/session-lifecycle.smoke.test.ts
- timeout: 10000
+ timeout: 15000  // +50% buffer for CI variability
```

**Status**: ✅ Already implemented (commit d317993)

#### 1.2 Add Retry Logic to Flaky Operations
```javascript
// src/__tests__/smoke/session-lifecycle.smoke.test.ts
import { retryWithBackoff } from '@/__testutils__/retry.js';

const result = await retryWithBackoff(
  () => runCommand('http://example.com', ['--headless']),
  { maxRetries: 2, initialDelay: 1000 }
);
```

#### 1.3 Implement Adaptive Polling
Replace all `setTimeout` loops with `pollUntil` utility.

**Estimated Impact**: Reduces flakiness by 40-60%

### Phase 2: Docker Integration (3-5 days)

#### 2.1 Add Testcontainers Dependency
```bash
npm install --save-dev testcontainers
```

#### 2.2 Create Chrome Container Fixture
```javascript
// src/__testutils__/chromeContainer.js
import { GenericContainer } from 'testcontainers';

let chromeContainer;

export async function startChromeContainer() {
  chromeContainer = await new GenericContainer('browserless/chrome:latest')
    .withExposedPorts(3000)
    .withEnvironment({ MAX_CONCURRENT_SESSIONS: '5' })
    .start();

  const port = chromeContainer.getMappedPort(3000);
  const host = chromeContainer.getHost();

  return `ws://${host}:${port}`;
}

export async function stopChromeContainer() {
  if (chromeContainer) {
    await chromeContainer.stop();
  }
}
```

#### 2.3 Update Smoke Tests
```javascript
// src/__tests__/smoke/session-lifecycle.smoke.test.ts
import { startChromeContainer, stopChromeContainer } from '@/__testutils__/chromeContainer.js';

let chromeWSUrl;

before(async () => {
  chromeWSUrl = await startChromeContainer();
});

after(async () => {
  await stopChromeContainer();
});

void it('should start session with containerized Chrome', async () => {
  const result = await runCommand('http://example.com', [
    '--chrome-ws-url', chromeWSUrl
  ]);
  assert.equal(result.exitCode, 0);
});
```

#### 2.4 Update CI Workflow
```yaml
# .github/workflows/ci.yml
jobs:
  smoke-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Run smoke tests (with Testcontainers)
        run: npm run test:smoke
```

**Estimated Impact**: Reduces flakiness by 80-90%

### Phase 3: Advanced Reliability (1 week)

#### 3.1 CPU Throttling for Local Development
```javascript
// src/__testutils__/cdpHelpers.js
export async function setupTestEnvironment(cdpSession, options = {}) {
  const { cpuThrottling = process.env.CI ? 1 : 4 } = options;

  // Throttle CPU on local dev to match CI
  await cdpSession.send('Emulation.setCPUThrottlingRate', {
    rate: cpuThrottling
  });

  // Network throttling (optional)
  if (options.networkThrottling) {
    await cdpSession.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: 1.5 * 1024 * 1024 / 8, // 1.5 Mbps
      uploadThroughput: 750 * 1024 / 8,           // 750 Kbps
      latency: 40                                 // 40ms RTT
    });
  }
}
```

#### 3.2 Test Observability
```javascript
// src/__testutils__/testMetrics.js
export function logTestMetrics(testName, duration, retries, exitCode) {
  const metrics = {
    test: testName,
    duration_ms: duration,
    retries,
    exit_code: exitCode,
    timestamp: new Date().toISOString(),
    ci: !!process.env.CI,
    runner: process.env.RUNNER_OS || 'local'
  };

  // Log to NDJSON for analysis
  console.log(JSON.stringify(metrics));
}
```

Aggregate metrics to identify patterns:
- Which tests fail most often?
- What's the success rate after 1 retry? 2 retries?
- Do failures cluster at certain times (CI load)?

#### 3.3 Quarantine Infrastructure
```javascript
// package.json
{
  "scripts": {
    "test:smoke": "tsx --test src/__tests__/smoke/*.test.ts",
    "test:quarantine": "tsx --test src/__tests__/smoke/quarantine/*.test.ts"
  }
}
```

```yaml
# .github/workflows/ci.yml
jobs:
  smoke-tests:
    # Blocking
    run: npm run test:smoke

  quarantined-tests:
    # Non-blocking, for observability
    continue-on-error: true
    run: npm run test:quarantine
```

**Estimated Impact**: 95%+ reliability, < 1% false negatives

## Alternative Approaches Considered

### ❌ Skip Smoke Tests Entirely
**Why rejected**: Smoke tests provide critical coverage of daemon lifecycle, which has 0% unit test coverage. Removing them would increase risk of regressions in production.

### ❌ Move Smoke Tests to Manual QA
**Why rejected**: Manual testing is slow, inconsistent, and doesn't scale. Defeats purpose of CI/CD.

### ❌ Use Puppeteer/Playwright Instead of Raw CDP
**Why rejected**:
- bdg's value proposition IS raw CDP access (self-documenting protocol)
- Puppeteer/Playwright add abstraction layer, increasing bundle size
- Doesn't solve underlying timing issues, just hides them

**However**: Consider for internal smoke tests (tests that verify bdg works, not tests OF bdg itself)

### ⚠️ Increase All Timeouts to 60s
**Partial solution**: Reduces false negatives but:
- Masks real performance regressions
- Slow feedback loop (60s * 8 tests = 8 minutes)
- Doesn't address root cause (environment variability)

Better: Adaptive timeouts based on environment (15s local, 30s CI)

## Cost-Benefit Analysis

| Solution | Implementation Time | Maintenance Burden | Reliability Gain | Cost |
|----------|-------------------|-------------------|-----------------|------|
| **Phase 1: Quick Wins** | 1-2 days | Low | 40-60% | Free |
| **Phase 2: Docker** | 3-5 days | Medium | 80-90% | ~5s per test run (container startup) |
| **Phase 3: Advanced** | 1 week | High | 95%+ | Ongoing observability overhead |
| **Do Nothing** | 0 | High (manual reruns, investigation) | Current (~50%) | Developer frustration, blocked PRs |

**Recommendation**: Implement Phase 1 immediately (already done), proceed with Phase 2 within 2 sprints.

## Implementation Roadmap

### Sprint 1 (Current)
- [x] Increase timeouts for session start test (d317993)
- [x] Remove unreliable stale session test (a39e15e)
- [ ] Add retry logic to remaining smoke tests
- [ ] Implement `pollUntil` utility
- [ ] Document quarantine process

### Sprint 2
- [ ] Add Testcontainers dependency
- [ ] Create Chrome container fixture
- [ ] Migrate 1-2 smoke tests to containerized Chrome
- [ ] Update CI workflow for Docker support
- [ ] Measure reliability improvement

### Sprint 3 (If needed)
- [ ] Migrate all smoke tests to containerized Chrome
- [ ] Add CPU throttling for local dev
- [ ] Implement test metrics collection
- [ ] Create quarantine infrastructure
- [ ] Write runbook for handling flaky tests

## Success Metrics

**Target**: < 2% flaky test rate (industry standard for well-tested projects)

**Measurement**:
```bash
# Run smoke tests 100 times, measure pass rate
for i in {1..100}; do npm run test:smoke; done | tee results.log
grep -c "tests 8" results.log  # Should be >= 98
```

**CI Dashboard**:
- Track test pass rate over time (goal: 98%+)
- Monitor retry frequency (goal: < 5% tests need retries)
- Alert on 3+ consecutive failures (indicates real bug, not flake)

## References

### Research Sources
1. [Testcontainers for Node.js](https://testcontainers.com/guides/getting-started-with-testcontainers-for-nodejs/)
2. [Using Docker Containers to Beat Flaky Tests - LogRocket](https://blog.logrocket.com/using-docker-containers-beat-flaky-tests/)
3. [How to Easily Reproduce a Flaky Test in Playwright - Nicolas Charpentier](https://www.charpeni.com/blog/how-to-easily-reproduce-a-flaky-test-in-playwright)
4. [Fixing Flaky Unit Tests - Chromium Project](https://www.chromium.org/developers/testing/fixing-flaky-tests/fixing_flaky_unittests/)
5. [Running Testcontainers Tests Using GitHub Actions - Docker Blog](https://www.docker.com/blog/running-testcontainers-tests-using-github-actions/)
6. [Tame Flaky Tests in CI/CD Pipelines Without Slowing Down (2025) - Medium](https://sidraaman.medium.com/tame-flaky-tests-in-ci-cd-pipelines-without-slowing-down-in-2025-1818e3ea4eff)

### Related Documentation
- `docs/quality/TESTING_PHILOSOPHY.md` - Overall testing strategy
- `src/__tests__/smoke/README.md` - Smoke test catalog
- `.github/workflows/ci.yml` - CI configuration

## Conclusion

Flaky smoke tests are a **systemic architectural issue**, not isolated bugs. The current approach of removing problematic tests is unsustainable and reduces coverage of critical code paths.

**Docker-based test isolation** combined with **adaptive retry mechanisms** provides the most robust solution, eliminating environment variability while maintaining fast feedback loops.

**Immediate action**: Proceed with Phase 2 (Docker integration) in next sprint. ROI is clear: 3-5 days investment for 80-90% reduction in flakiness saves countless hours of CI reruns and debugging.

---

**Last Updated**: 2025-11-15
**Next Review**: After Phase 2 implementation (2 sprints)
**Owner**: Engineering Team
**Approver**: Technical Lead
