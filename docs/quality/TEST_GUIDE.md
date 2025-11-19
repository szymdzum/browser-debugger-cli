# Test Guide

Complete guide to testing in browser-debugger-cli.

## Quick Start

```bash
# Run all TypeScript tests (unit, contract, integration, smoke)
npm test

# Run only smoke tests
npm run test:smoke

# Run shell-based tests
./tests/run-all-tests.sh

# Run lints and type checks
npm run lint
npm run type-check
```

## Test Organization

### TypeScript Tests (`src/`)

Tests live alongside source code in `__tests__/` directories:

```
src/
├── commands/
│   ├── __tests__/
│   │   ├── cdp.contract.test.ts       # Contract tests (public API)
│   │   └── domEval.contract.test.ts
├── connection/
│   ├── __tests__/
│   │   ├── cdp.contract.test.ts
│   │   └── handlers.unit.test.ts      # Unit tests (isolated functions)
└── __tests__/
    ├── integration/
    │   └── session-files.integration.test.ts  # Cross-module tests
    └── smoke/
        ├── session-lifecycle.smoke.test.ts    # End-to-end tests
        └── error-handling.smoke.test.ts
```

**Test Types:**
- `*.unit.test.ts` - Isolated function tests with mocked dependencies
- `*.contract.test.ts` - Public API tests (most common, preferred)
- `*.integration.test.ts` - Cross-module interaction tests
- `*.smoke.test.ts` - Full end-to-end user workflows

### Shell Tests (`tests/`)

Shell-based tests for command-line integration:

```
tests/
├── agent-benchmark/     # E2E scenarios (HN scraping, GitHub trending)
├── integration/         # Command testing (peek, status, details)
├── error-scenarios/     # Error handling (port conflicts, crashes)
├── edge-cases/          # Edge cases (URL formats)
├── lib/                 # Shared utilities
│   └── cleanup.sh       # Polling-based cleanup
└── run-all-tests.sh     # Master test runner
```

## Test Coverage

### Current Status

**TypeScript Tests:** 478 tests
- Unit: 61 tests (utilities, parsers, validators)
- Contract: 389 tests (APIs, protocols, collectors)
- Integration: 3 tests (session files)
- Smoke: 8 tests (full workflows)
- **Pass Rate:** 100% (477 pass, 1 skip)

**Shell Tests:** 19 tests
- Agent Benchmarks: 4 tests
- Integration: 8 tests
- Error Scenarios: 6 tests
- Edge Cases: 1 test
- **Pass Rate:** 100% (19 pass)

### Well-Tested Modules

✅ **Connection Layer** (cdp, handlers, port reservation)
✅ **IPC Layer** (client, server, protocol)
✅ **Daemon** (server, launcher, command registry)
✅ **Session Management** (metadata, cleanup, locks)
✅ **Telemetry** (network, console, navigation)
✅ **Utilities** (validation, HTTP, process, errors)

### Areas to Expand (Optional)

- UI layer (formatters, messages) - Low priority, mostly presentational
- CDP schema introspection - Already self-testing via `bdg cdp --list`
- Commands - Covered by shell integration tests

## Writing Tests

### Contract Tests (Preferred)

Test the **public API** and **behavior**, not implementation:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCDPTargets } from '@/utils/http.js';

void describe('fetchCDPTargets()', () => {
  void it('returns array of targets when HTTP request succeeds', async () => {
    // Test the CONTRACT: function returns array on success
    const result = await fetchCDPTargets(9222);
    
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
  });
  
  void it('returns empty array on HTTP errors', async () => {
    // Test the PROPERTY: always returns array, never throws
    const result = await fetchCDPTargets(9999); // Bad port
    
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });
});
```

### Key Principles

1. **Test behavior, not implementation** - Don't spy on internal functions
2. **Mock boundaries, not your code** - Mock HTTP/CDP, not internal functions
3. **Use real data structures** - Avoid `{} as Type`
4. **Test properties** - "Always returns array" not "Returns [1,2,3]"
5. **Integration-style** - Let modules work together naturally

See [TESTING_PHILOSOPHY.md](./TESTING_PHILOSOPHY.md) for detailed examples.

## Common Patterns

### Testing CDP Methods

```typescript
void it('executes Network.getCookies', async () => {
  const result = await executeCDPMethod('Network.getCookies', {});
  
  assert.equal(result.status, 'ok');
  assert.ok(result.data);
});
```

### Testing Error Handling

```typescript
void it('returns error response on CDP failure', async () => {
  const result = await executeCDPMethod('Invalid.method', {});
  
  assert.equal(result.status, 'error');
  assert.ok(result.error);
});
```

### Testing IPC Protocol

```typescript
void it('sends correct message format', async () => {
  const response = await ipcClient.callCDP('Page.navigate', { url: '...' });
  
  assert.equal(response.type, 'cdp_call_response');
  assert.equal(response.status, 'ok');
});
```

## Shell Test Best Practices

### Use Polling-Based Cleanup

**Bad:**
```bash
bdg stop
sleep 1  # Hope cleanup is done
```

**Good:**
```bash
source "$TESTS_LIB_DIR/cleanup.sh"
cleanup_with_polling 9222  # Polls until port released
```

### Add Timeouts

```bash
# Prevent infinite hangs
(sleep 300; kill -TERM $$) 2>/dev/null &
TIMEOUT_PID=$!
```

### Clean Traps

```bash
trap 'cleanup_with_polling 9222' EXIT INT TERM
```

## Debugging Tests

### Run Single Test

```bash
# TypeScript test
npx tsx --test src/utils/__tests__/http.unit.test.ts

# Shell test
bash tests/integration/peek.test.sh
```

### Enable Debug Logging

```bash
# TypeScript
DEBUG=1 npm test

# Shell
bash -x tests/integration/peek.test.sh
```

### Check Test Logs

```bash
# Shell test logs
ls -la tests/results/
cat tests/results/peek.test.log
```

## CI Integration

Tests run automatically on GitHub Actions:

- **TypeScript tests:** Run on every PR
- **Shell tests:** Run on every PR (with hardened cleanup)
- **Smoke tests:** Run with 60s timeout (Chrome launch overhead)

## Performance

### TypeScript Tests
- Unit: ~21 seconds
- Smoke: ~64 seconds (includes Chrome launches)

### Shell Tests
- Full suite: ~5-10 minutes (19 tests with 2s delays between)
- Agent benchmarks: ~40-60 seconds
- Integration: ~60-90 seconds
- Error scenarios: ~60-90 seconds

## Troubleshooting

### Port Already in Use

```bash
lsof -ti:9222 | xargs kill -9
bdg cleanup --force
```

### Stale Session Files

```bash
rm -rf ~/.bdg/*
```

### Chrome Won't Launch

```bash
bdg status --verbose  # Check Chrome diagnostics
```

### Tests Hang

- Check for orphaned Chrome processes: `ps aux | grep -i chrome`
- Verify cleanup traps are working
- Ensure tests use `cleanup_with_polling` not fixed sleeps

## Related Documentation

- [TESTING_PHILOSOPHY.md](./TESTING_PHILOSOPHY.md) - Test design principles
- [SHELL_TEST_HARDENING.md](./SHELL_TEST_HARDENING.md) - Shell test reliability
- [tests/README.md](../../tests/README.md) - Shell test details
