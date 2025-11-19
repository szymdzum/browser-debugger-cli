# Quality Documentation

Testing and code quality documentation for browser-debugger-cli.

## Documentation

- **[TEST_GUIDE.md](./TEST_GUIDE.md)** - Complete testing guide
  - How to run tests
  - Test organization and types
  - Writing tests (patterns and examples)
  - Debugging and troubleshooting
  - Current coverage status

- **[TESTING_PHILOSOPHY.md](./TESTING_PHILOSOPHY.md)** - Test design principles
  - Contract-based testing
  - Test the behavior, not implementation
  - Five principles for refactor-friendly tests
  - Real-world examples from codebase

- **[SHELL_TEST_HARDENING.md](./SHELL_TEST_HARDENING.md)** - Shell test reliability
  - Why shell tests were brittle
  - Polling-based cleanup solution
  - Hardening checklist
  - Before/after results

## Quick Start

```bash
# Run all tests
npm test                    # TypeScript tests (478 tests)
npm run test:smoke          # Smoke tests (8 tests)
./tests/run-all-tests.sh    # Shell tests (19 tests)

# Validate code quality
npm run lint                # ESLint
npm run type-check          # TypeScript
```

## Test Status

**TypeScript Tests:** ✅ 478 tests (100% pass rate)
- Unit: 61 tests
- Contract: 389 tests  
- Integration: 3 tests
- Smoke: 8 tests

**Shell Tests:** ✅ 19 tests (100% pass rate)
- Agent Benchmarks: 4 tests
- Integration: 8 tests
- Error Scenarios: 6 tests
- Edge Cases: 1 test

**Total:** 497 tests, 100% passing

## Philosophy Summary

**Test the Contract, Not the Implementation**

```typescript
// ❌ Bad: Tests implementation details
test('calls normalizeUrl before matching', () => {
  const spy = sinon.spy(target, 'normalizeUrl');
  findTarget('localhost:3000');
  assert(spy.calledOnce);
});

// ✅ Good: Tests behavior
test('matches localhost:3000 regardless of format', () => {
  assert.ok(findTarget('localhost:3000'));
  assert.ok(findTarget('http://localhost:3000'));
});
```

**Five Principles:**
1. Test public API only
2. Mock external dependencies, never your code
3. Test properties, not examples
4. Integration-style unit tests
5. Use real data structures

See [TESTING_PHILOSOPHY.md](./TESTING_PHILOSOPHY.md) for detailed examples.
