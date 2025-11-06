# Testing Philosophy: Test the Contract, Not the Implementation

**Last Updated**: 2025-11-01

## The Core Problem

The central tension in testing:
- **Catching bugs** (need comprehensive tests)
- **Enabling refactoring** (tests shouldn't break when you change internals)

**Bad tests** are brittle: they break when you refactor, even if behavior is unchanged.
**Good tests** are robust: they survive refactoring as long as behavior stays the same.

---

## The Solution: Test the Contract

**Contract** = The public API and expected behavior
**Implementation** = How it works internally

### The Rule
> Test what the module **does**, not how it **does it**.

---

## Bad Test vs Good Test

### ❌ Bad Test (Brittle, Blocks Refactoring)

```typescript
// tests/connection/finder.test.ts - WRONG APPROACH
import { findTargetByUrl } from '../../src/connection/finder';
import * as url from '../../src/utils/url';

test('calls normalizeUrl before matching', () => {
  const spy = jest.spyOn(url, 'normalizeUrl');
  findTargetByUrl(targets, 'localhost:3000');
  expect(spy).toHaveBeenCalled(); // ❌ COUPLED TO IMPLEMENTATION
});

test('tries exact match first', () => {
  const exactMatch = jest.spyOn(finder, 'tryExactMatch');
  findTargetByUrl(targets, 'http://localhost:3000');
  expect(exactMatch).toHaveBeenCalledBefore(containsMatch); // ❌ BRITTLE
});
```

**Problems:**
- Breaks when you rename functions
- Breaks when you change internal call order
- Doesn't actually prove the behavior works
- Makes refactoring painful
- Tests implementation details, not correctness

---

### ✅ Good Test (Robust, Enables Refactoring)

```typescript
// tests/connection/finder.test.ts - RIGHT APPROACH
import { findTargetByUrl } from '../../src/connection/finder';
import type { CDPTarget } from '../../src/types';

describe('Target matching behavior', () => {
  const mockTargets: CDPTarget[] = [
    { url: 'http://localhost:3000/', title: 'Home' },
    { url: 'http://localhost:3000/about', title: 'About' },
    { url: 'http://example.com/', title: 'Example' },
  ];

  // Test the CONTRACT: "Given this input, I expect this output"
  test('finds exact URL match', () => {
    const result = findTargetByUrl(mockTargets, 'http://localhost:3000/');
    expect(result?.url).toBe('http://localhost:3000/');
  });

  test('matches without protocol prefix', () => {
    const result = findTargetByUrl(mockTargets, 'localhost:3000');
    expect(result?.url).toContain('localhost:3000');
  });

  test('prioritizes exact match over partial', () => {
    // This tests BEHAVIOR, not implementation
    const result = findTargetByUrl(mockTargets, 'http://localhost:3000/');
    expect(result?.url).toBe('http://localhost:3000/'); // Not /about
  });

  test('returns null when no match found', () => {
    const result = findTargetByUrl(mockTargets, 'nonexistent.com');
    expect(result).toBeNull();
  });
});
```

**Why this works:**
- ✅ Tests **behavior** (input → output), not implementation
- ✅ Survives refactoring (can change internals freely)
- ✅ Proves actual correctness
- ✅ No mocking of internal functions
- ✅ No coupling to internal structure

---

## Five Principles for Refactor-Friendly Tests

### 1. Test Public API Only

```typescript
// ❌ Bad: Testing internal helper
import { tryExactMatch } from '../../src/connection/finder';
// Had to export this just for tests!

// ✅ Good: Testing public API
import { findTargetByUrl } from '../../src/connection/finder';
```

**Rule**: If it's not exported in production, don't test it directly.

**Why**: Internal functions can be renamed, removed, or combined without affecting behavior.

---

### 2. Mock External Dependencies, Never Your Code

```typescript
// ❌ Bad: Mocking your own code
jest.mock('../../src/utils/url');
jest.spyOn(myModule, 'internalFunction');

// ✅ Good: Only mock external systems
jest.mock('ws'); // Mock WebSocket library
jest.mock('fs/promises'); // Mock filesystem
jest.mock('node:timers'); // Mock timers
```

**Rule**: Mock at the boundary (network, filesystem, time), not internally.

**Why**: Mocking your own code couples tests to implementation details.

**What to mock:**
- ✅ Network calls (fetch, WebSocket, HTTP)
- ✅ Filesystem operations (fs, path)
- ✅ Time/timers (setTimeout, Date.now)
- ✅ External libraries (3rd party packages)
- ❌ Your own modules
- ❌ Your own functions

---

### 3. Test Properties, Not Examples

```typescript
// ❌ Bad: Testing specific examples
test('normalizes localhost:3000', () => {
  expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000');
});

// ✅ Good: Testing properties/invariants
test('result always has a protocol', () => {
  const inputs = ['localhost:3000', 'example.com', 'http://foo.com'];
  inputs.forEach(input => {
    const result = normalizeUrl(input);
    expect(result).toMatch(/^https?:\/\//); // Property: always has protocol
  });
});
```

**Rule**: Test the invariant, not the implementation.

**Why**: Properties describe **what should be true**, not **how to make it true**.

**Examples of properties:**
- "Output always has a protocol"
- "Response is always paired with request"
- "Result is never null for valid input"
- "Cleanup is always called on shutdown"

---

### 4. Integration-Style Unit Tests

```typescript
// ❌ Bad: Testing each step
test('step 1: normalize URL', () => { ... });
test('step 2: try exact match', () => { ... });
test('step 3: try contains match', () => { ... });

// ✅ Good: Test the whole flow
test('matches localhost:3000 regardless of format', () => {
  // Doesn't care HOW it works, just that it DOES work
  expect(findTargetByUrl(targets, 'localhost:3000')).toBeTruthy();
  expect(findTargetByUrl(targets, 'http://localhost:3000')).toBeTruthy();
  expect(findTargetByUrl(targets, 'https://localhost:3000')).toBeTruthy();
});
```

**Rule**: Test the module as a whole, not each function.

**Why**: You can change the steps (normalize → match → filter) without breaking tests.

---

### 5. Use Real Data Structures

```typescript
// ❌ Bad: Mocking everything
const mockTarget = {
  url: jest.fn().mockReturnValue('http://localhost:3000'),
  title: jest.fn().mockReturnValue('Test'),
};

// ✅ Good: Use actual data structures
const mockTarget: CDPTarget = {
  url: 'http://localhost:3000',
  title: 'Test',
};
```

**Rule**: Only mock I/O boundaries, use real objects everywhere else.

**Why**: Real objects behave like production code. Mocked objects don't.

---

## The "Black Box" Principle

**Treat your module like a black box:**
- You know the **inputs**
- You know the expected **outputs**
- You **don't care** how it works inside

```
┌─────────────────────────────┐
│   findTargetByUrl()         │
│                             │
│   [Implementation details]  │ ← Don't test this
│   [You can change freely]   │
└─────────────────────────────┘
     ↑              ↓
  Input         Output  ← Only test this
 (targets,     (CDPTarget
  'url')        or null)
```

**Result:**
- ✅ Tests catch real bugs (wrong output)
- ✅ Tests survive refactoring (implementation changes are fine)
- ✅ Tests stay simple (no mocking internal functions)

---

## The Refactoring Test

Ask yourself:
> **"If I completely rewrote this module but kept the same behavior, would my tests still pass?"**

- ❌ If no → Test is coupled to implementation
- ✅ If yes → Test is coupled to contract

### Example

**Original Implementation:**
```typescript
export function findTargetByUrl(targets: CDPTarget[], url: string): CDPTarget | null {
  const normalized = normalizeUrl(url);

  // Try exact match
  let match = targets.find(t => t.url === normalized);
  if (match) return match;

  // Try contains
  match = targets.find(t => t.url.includes(url));
  if (match) return match;

  return null;
}
```

**Refactored Implementation (completely different approach):**
```typescript
export function findTargetByUrl(targets: CDPTarget[], url: string): CDPTarget | null {
  // Completely different approach: Score each target
  const scored = targets.map(t => ({
    target: t,
    score: calculateMatchScore(t.url, url), // New scoring system
  }));

  const best = scored.sort((a, b) => b.score - a.score)[0];
  return best.score > 0 ? best.target : null;
}
```

**Your tests should still pass** ✅ because you tested the contract:
- Input `localhost:3000` → Output: target with `localhost:3000`
- Input `nonexistent` → Output: `null`

---

## Real-World Example: Network Collector

### The Complex Logic (Bug-Prone)

Request/response pairing is complex:
- Events arrive asynchronously
- Responses might arrive before requests (race condition)
- Requests might never get responses (timeout)
- Multiple requests might share IDs (edge case)

### ❌ Bad Test (Implementation-Coupled)

```typescript
test('stores request in pending map', () => {
  const pendingMap = collector.getPendingRequests();
  cdp.emit('Network.requestWillBeSent', { requestId: '123' });
  expect(pendingMap.has('123')).toBe(true); // ❌ Coupled to internal data structure
});

test('removes from pending map on response', () => {
  cdp.emit('Network.requestWillBeSent', { requestId: '123' });
  cdp.emit('Network.responseReceived', { requestId: '123' });
  expect(collector.getPendingRequests().size).toBe(0); // ❌ Tests internal state
});
```

**Problems:**
- Must expose internal `pendingRequests` Map
- Breaks if you change from Map to Set or Array
- Breaks if you rename the data structure
- Doesn't test actual correctness

---

### ✅ Good Test (Contract-Based)

```typescript
// tests/collectors/network.test.ts

describe('Network collector request/response pairing', () => {
  let cdp: MockCDP;
  let requests: NetworkRequest[];

  beforeEach(() => {
    cdp = new MockCDP(); // Mock only the CDP boundary
    requests = [];
  });

  // Test the INVARIANT: Requests are paired with responses
  test('pairs request with response', async () => {
    const cleanup = await startNetworkCollection(cdp, requests);

    // Simulate CDP events
    cdp.emit('Network.requestWillBeSent', {
      requestId: '123',
      request: { url: 'http://example.com', method: 'GET' },
    });

    cdp.emit('Network.responseReceived', {
      requestId: '123',
      response: { status: 200, mimeType: 'text/html' },
    });

    // Test the OUTCOME, not the steps
    expect(requests).toHaveLength(1);
    expect(requests[0].requestId).toBe('123');
    expect(requests[0].status).toBe(200);
  });

  // Test edge case: Out-of-order events
  test('handles out-of-order events', async () => {
    const cleanup = await startNetworkCollection(cdp, requests);

    // Response BEFORE request (race condition)
    cdp.emit('Network.responseReceived', {
      requestId: '123',
      response: { status: 200 },
    });

    cdp.emit('Network.requestWillBeSent', {
      requestId: '123',
      request: { url: 'http://example.com' },
    });

    // Test PROPERTY: Still pairs correctly
    expect(requests[0].status).toBe(200);
  });

  // Test edge case: Request without response
  test('handles request without response', async () => {
    const cleanup = await startNetworkCollection(cdp, requests);

    cdp.emit('Network.requestWillBeSent', {
      requestId: '123',
      request: { url: 'http://example.com' },
    });

    // No response event

    await cleanup(); // Cleanup triggers finalization

    // Test PROPERTY: Request is still recorded
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBeUndefined(); // Or null, whatever the contract is
  });
});
```

**Why this works:**
- ✅ Can change internal data structures freely (Map → Set → Array)
- ✅ Can change event handling logic freely
- ✅ Tests actual bugs (race conditions, missing responses)
- ✅ Only mocks the boundary (CDP)
- ✅ Tests the public contract (requests array)

---

## What to Test (Priority Guide)

### High Priority: Test These ✅

**Complex logic with non-obvious edge cases:**
- Target matching (exact vs partial vs hostname)
- Request/response pairing (async events, race conditions)
- Session lifecycle (crash recovery, cleanup, idempotency)

**Characteristics:**
- Would cause serious bugs if broken (data loss, wrong data, crashes)
- Complex enough that humans make mistakes
- Have non-obvious edge cases

---

### Low Priority: Skip These ❌

**Simple, obvious logic:**
- URL normalization (add `http://` prefix)
- String filtering (domain matching)
- Input validation (type checks)

**Characteristics:**
- Will obviously break if changed
- TypeScript already validates types
- Trivial string manipulation
- No complex edge cases

**Why skip:**
- Cost > Benefit
- Easy to verify manually
- Changes rarely
- Smoke tests already cover them

---

## Testing Checklist

Before writing a test, ask:

1. **Is this testing behavior or implementation?**
   - ✅ Behavior: Input → Expected output
   - ❌ Implementation: Calls function X, then function Y

2. **Would this test survive a rewrite?**
   - ✅ Yes: Tests the contract
   - ❌ No: Tests the implementation

3. **Am I mocking my own code?**
   - ✅ No: Only mocking boundaries
   - ❌ Yes: Coupled to implementation

4. **Is this complex enough to test?**
   - ✅ Yes: Non-obvious edge cases, async logic, state machines
   - ❌ No: Simple string manipulation, type checks

5. **Would this catch a real bug?**
   - ✅ Yes: Tests edge cases, race conditions, error paths
   - ❌ No: Tests that function exists or returns truthy

---

## Action Plan

When writing tests:

1. **Test behavior**: Given X input, expect Y output
2. **Mock boundaries only**: CDP, filesystem, network - not your code
3. **Use real data**: Actual objects, not mocks
4. **Test invariants**: Properties that should always be true
5. **Integration-style**: Test whole modules, not individual functions

**Result:**
- Bug detection **without** refactoring friction
- Tests that actually prove correctness
- Freedom to refactor implementation
- Maintainable test suite

---

## Examples from This Codebase

### Good Test Targets

1. **src/connection/finder.ts** - Target matching
   - Tests: Exact match, partial match, hostname fallback, no match
   - Why: Complex fallback logic, multiple match strategies

2. **src/collectors/network.ts** - Request/response pairing
   - Tests: Pairing, out-of-order events, missing responses
   - Why: Async events, race conditions, data integrity

3. **src/utils/session.ts** - Session lifecycle (integration tests)
   - Tests: Cleanup after crash, idempotent stop, concurrent session prevention
   - Why: State machine, resource management, edge cases

### Poor Test Targets

1. **src/utils/url.ts** - URL normalization
   - Skip: Simple string manipulation
   - Alternative: Smoke tests cover this

2. **src/utils/filters.ts** - Domain filtering
   - Skip: Simple boolean logic
   - Alternative: Integration tests cover filtering

3. **src/utils/validation.ts** - Input validation
   - Skip: TypeScript already validates
   - Alternative: Runtime errors are obvious

---

## Further Reading

- [Testing Without Mocks](https://www.jamesshore.com/v2/blog/2018/testing-without-mocks) - James Shore
- [Test Behavior, Not Implementation](https://kentcdodds.com/blog/testing-implementation-details) - Kent C. Dodds
- [Property-Based Testing](https://hypothesis.works/articles/what-is-property-based-testing/) - Hypothesis

---

## Summary

**The Golden Rule:**
> Test what the module **does**, not how it **does it**.

**The Refactoring Test:**
> If I rewrote this module, would my tests still pass?

**The Priority:**
> Test complex, bug-prone logic. Skip simple, obvious code.

This gives you **bug detection without refactoring friction**.
