# CDPConnection Contract Tests

## Overview

This directory contains contract tests for `src/connection/cdp.ts` that validate the public API behavior WITHOUT testing implementation details.

## Test Structure

### `cdp.contract.test.ts`
Main test suite covering 6 critical contract areas:

1. **Message correlation** - Request/response pairing with message IDs
2. **Connection lifecycle** - Connect, close, error handling
3. **Timeouts** - Connection (10s) and command (30s) timeouts
4. **Keepalive** - Ping/pong lifecycle, missed pongs detection
5. **Event subscription** - on/off/removeAllListeners handlers
6. **Edge cases** - Close during send, port extraction, defensive copies

### `helpers.ts`
Test-specific helper functions for setup and teardown.

## Current Implementation Status

✅ **WebSocket Dependency Injection**

`CDPConnection` now accepts an optional WebSocket factory via its constructor. Tests inject `FakeWebSocket` directly, so no module mocking library is required. Production callers continue using the default `ws` implementation.

## Test Philosophy Alignment

These tests follow `docs/TESTING_PHILOSOPHY.md` principles:

✅ **Test behavior, not implementation**
- Tests assert input → output contracts
- No mocking of internal CDP functions
- No coupling to internal state (pendingMessages, messageId, etc.)

✅ **Mock boundaries only**
- Only mocks WebSocket (external I/O boundary)
- Uses real CDP logic for everything else
- FakeWebSocket mimics full `ws` API to keep tests honest

✅ **Defensive copies prevent mutation**
- `FakeWebSocket.getSentMessages()` returns shallow copy
- Tests can't accidentally mutate internal state

✅ **Complete microtask drainage**
- `FakeClock.flush()` loops until queue empty
- Handles cascading microtasks (rejection → cleanup → more microtasks)
- Timeout tests use `tickAndFlush()` for proper rejection propagation

## Running Tests (Once Mocking Resolved)

```bash
# Run all contract tests
npm test

# Watch mode
npm run test:watch

# Run specific test
npm test -- --test-name-pattern "Message correlation"
```

## Key Testing Patterns Demonstrated

### 1. Message Correlation Testing
```typescript
// Send command → simulate response with matching ID → verify resolution
const resultPromise = cdp.send('Target.getTargets');
const sentMessage = JSON.parse(mockWebSocket.getSentMessages()[0]);
mockWebSocket.simulateMessage(JSON.stringify(createResponse(sentMessage.id, { ... })));
const result = await resultPromise;
```

### 2. Timeout Testing with Microtask Drainage
```typescript
const { tickAndFlush } = useFakeClock();
const promise = cdp.send('Target.getTargets'); // Starts 30s timeout
await tickAndFlush(30000); // Advances timer AND drains microtask rejection queue
await assert.rejects(promise, /timeout/);
```

### 3. Keepalive Testing with Pong Simulation
```typescript
mockWebSocket.simulateOpen();
tick(1000); // First ping
tick(1000); // Second ping (missed pong)
mockWebSocket.simulatePong(); // Reset counter
tick(1000); // Third ping - won't close (counter reset)
```

### 4. Defensive Copy Verification
```typescript
const messagesBefore = mockWebSocket.getSentMessages(); // Snapshot
mockWebSocket.simulateClose(1000, 'Test');
// messagesBefore is unchanged - defensive copy prevented mutation
assert.equal(messagesBefore.length, 1);
```

## Next Steps

1. ✅ **Foundation complete** - FakeClock, FakeWebSocket, fixtures, helpers
2. ✅ **Test file written** - Demonstrates contract testing approach
3. ⏳ **Run tests** - Verify all pass (`npm test`)
4. ⏳ **Add to CI** - Integrate into npm test script

## Related Documentation

- `docs/TESTING_PHILOSOPHY.md` - Why we test contracts, not implementation
- `docs/TESTING_FOUNDATION.md` - Test infrastructure and tooling guide
- `src/__testutils__/README.md` - Test utility documentation (TODO)
