# Testing Foundation

**Last Updated:** 2025-11-02  
**Audience:** Contributors building or maintaining automated tests for `browser-debugger-cli`

This document defines how we design, organize, and run tests in this repository. It complements the contract-first principles in [`docs/TESTING_PHILOSOPHY.md`](./TESTING_PHILOSOPHY.md) with specific tooling, folder structure, and layering guidance.

---

## Goals
- **Prove behavior, not implementation.** Every test asserts the observable contract of a module or CLI workflow.
- **Stay refactor-friendly.** Internal refactors must not require test rewrites when contracts remain the same.
- **Keep feedback elastic.** Provide fast inner-loop checks with the option to dial up heavier scenarios when needed.
- **Co-locate context.** Tests live next to the code they exercise, making intent discoverable while changes are fresh.

---

## Test Layers

We use a **lightweight 2-layer approach** optimized for this codebase size:

| Layer | Location | Description | Execution |
|-------|----------|-------------|-----------|
| **Contract** | `src/**/__tests__/*.test.ts` | Fast (<200ms/suite), deterministic checks of module-level contracts. Uses lightweight boundary fakes. Co-located next to the code they test. | `npm test` or `npm run test:watch` |
| **Smoke / E2E** | `scripts/test-e2e.sh` & docs | Real CLI scenarios that exercise Chrome + filesystem. Documented expectations in `SMOKE_TEST_TELEMETRY.md`. | On demand: `npm run test:e2e` |

### Why two layers
- **Contract tests** catch regressions fast while giving refactoring freedom. Run on every change during development.
- **Smoke/E2E tests** are the final guardrail before releases, validating the product from the outside with real Chrome.

### When to add a third layer
If you discover integration scenarios that:
- Are too slow for contract tests (>200ms)
- Are too brittle for E2E (require precise state setup like stale PIDs, race conditions)
- Cannot be covered by mocking boundaries alone

...then consider adding a targeted `tests/elastic/` harness. For now, the two-layer model keeps things simple.

---

## Tooling
- **Runner:** [`node --test`](https://nodejs.org/api/test.html) via [`tsx`](https://github.com/privatenumber/tsx) for TypeScript support. Keeps dependencies light and standard.
- **Assertions:** Native Node `assert/strict` for contract tests. Use helper functions for readability—avoid importing assertion libraries unless absolutely necessary.
- **Boundary Fakes:** Place reusable doubles (e.g., `FakeLauncher`, `TestWebSocket`) under `src/__testutils__/`. These mimic external systems (Chrome launcher, WebSocket) while respecting our “mock boundaries, not internals” rule.
- **Fixtures:** Store reusable JSON/TS fixtures in `src/__testfixtures__/` to keep data consistent across co-located tests.

---

## Co-Location Guidelines
1. **Module tests live next to module code.**  
   Example: `src/connection/launcher.ts` → `src/connection/__tests__/launcher.contract.test.ts`.
2. **Use relative imports favoring `@/` path aliases** so contract tests mirror production usage.
3. **Keep helpers generic.** Extract shared setup into `__testutils__` only when at least two suites need it. Otherwise, keep setup inline for clarity.
4. **Document new suites.** Add a short note in the module’s JSDoc or doc comment referencing the test file to help future contributors find coverage quickly.

---

## Authoring Tests
1. **Start with the contract.** Write down the behavior in prose (input → output). If the contract is unclear, clarify it before writing code.
2. **Arrange–Act–Assert.**  
   - Arrange: Prepare real data structures and boundary fakes.  
   - Act: Call the public API or CLI command once.  
   - Assert: Check observable results (return value, file written, event emitted).
3. **Avoid implementation coupling.** Never assert internal call order, private field contents, or intermediary events. If you need to, the contract is probably underspecified.
4. **Prefer properties/invariants.** When behavior expresses a rule (“output always has a protocol”), test that property across examples instead of one-off snapshots.
5. **Mind async timing.** Use deterministic helpers (manual clock control, promise queues) rather than fixed `setTimeout` delays.

---

## Execution Flow
- **Default inner loop:** `npm run test:contract`
- **Focused runs:** `npm run test:contract -- --watch --test-name-pattern launchChrome`
- **Elastic checks:** `npm run test:elastic -- --grep session` (optional unless you touch those surfaces)
- **Smoke/E2E:** Update and execute the documented scripts for release candidates or major refactors.

> **Tip:** Keep contract suites under ~200 ms each. If they start creeping up, move the scenario to the elastic layer.

---

## Maintenance Rules
- **Keep docs updated.** When you add a new suite or layer, update this file and `SMOKE_TEST_TELEMETRY.md` to reflect coverage.
- **Review tests like code.** Pull requests should include contract tests for new behavior and elastic/E2E updates when we add major features.
- **Delete obsolete coverage.** If a contract no longer exists, remove its test rather than mutating it to fit the new world.
- **Fail loudly on breaking contracts.** Prefer explicit assertions with descriptive messages so failures guide the maintainer to the root cause quickly.

---

## Open Questions
- Property-based testing (e.g., `fast-check`) may help cover more URL/target permutations. Decide once contract suites mature.
- Evaluate running elastic suites in CI once runtime stabilizes and cost is acceptable.

---

By following this foundation, we get a lean, dependable test suite that evolves with the codebase, keeps contributors productive, and protects the behavior our users rely on.

---

## Examples

### Contract Test (Co-Located)
File: `src/connection/__tests__/launcher.contract.test.ts`

```typescript
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { launchChrome } from '@/connection/launcher.js';
import { FakeLauncher } from '@/__testutils__/fakeLauncher.js';

describe('launchChrome contract', () => {
  beforeEach(() => {
    FakeLauncher.reset(); // Clears prior state between tests
  });

  it('returns the launched chrome metadata', async () => {
    FakeLauncher.stubSuccess({ pid: 4321, port: 9333 });

    const chrome = await launchChrome({ port: 9333 });

    assert.equal(chrome.pid, 4321);
    assert.equal(chrome.port, 9333);
    assert.ok(typeof chrome.kill === 'function');
  });

  it('wraps launch failures in ChromeLaunchError', async () => {
    FakeLauncher.stubFailure(new Error('EPERM'));

    await assert.rejects(
      () => launchChrome({ port: 9555 }),
      /ChromeLaunchError: Failed to launch Chrome: EPERM/
    );
  });
});
```

**Key points:**
- Uses Node’s built-in test runner (`node:test`) and `assert/strict`.
- The fake lives in `src/__testutils__/fakeLauncher.ts` and mimics `chrome-launcher`.
- We only assert the public contract (`pid`, `port`, `kill`) and error wrapping.

### Elastic Harness Example
File: `tests/elastic/session-lifecycle.test.ts`

```typescript
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { createSessionHarness } from './helpers/sessionHarness.js';

describe('session lifecycle elastic suite', () => {
  const harness = createSessionHarness();

  beforeEach(async () => {
    await harness.setup();
  });

  afterEach(async () => {
    await harness.teardown();
  });

  it('recovers from stale PID on restart', async () => {
    const sessionA = await harness.startSession();
    await harness.killProcess(sessionA.pid); // Simulate crash without cleanup

    const sessionB = await harness.startSession();

    const status = await harness.readStatus();
    assert.equal(status.active, true);
    assert.equal(status.bdgPid, sessionB.pid);
    assert.equal(status.stalePid, undefined);
  });
});
```

**Key points:**
- Harness spins up a fake Chrome + session directory so we can simulate process crashes deterministically.
- Tests expose invariants (second start should clean stale PID).
- Lives under `tests/elastic/` because it spans multiple modules and takes longer to run.

### Smoke Script Snippet
File: `scripts/test-e2e.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  bdg stop >/dev/null 2>&1 || true
  bdg cleanup --force >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "› bdg --version"
bdg --version

echo "› starting session on localhost:3000"
bdg localhost:3000 --timeout 5 --port 9444 &
SESSION_PID=$!

bdg status --verbose
bdg peek --json | jq 'del(.dom)'

wait "${SESSION_PID}"
bdg cleanup --aggressive
```

**Key points:**
- Mirrors the documented smoke run, keeping validation light (`jq` filters).
- Used manually or in CI for release sign-off.

These examples illustrate how the layers fit together while honoring the contract-first philosophy.
