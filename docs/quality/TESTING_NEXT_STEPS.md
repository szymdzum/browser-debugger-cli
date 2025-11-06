# Testing - Next Steps for More Coverage

## Current Achievement 🎉
- **14/14 tests passing (100%)**
- Test infrastructure is solid
- Good coverage of basic workflows

## What's Missing

### High Priority (Do These First) 🔴

#### 1. DOM Command Tests ✅ STARTED
**File created:** `tests/integration/dom.test.sh`
- 10 test cases covering selectors, edge cases, error handling
- Ready to run once DOM command is available

**Next:** Run the test and fix any issues

#### 2. Network Command Tests
**Create:** `tests/integration/network.test.sh`
**Test cases needed:**
- List network requests
- Filter by status code (200, 404, 500)
- Filter by method (GET, POST)
- Filter by domain/URL pattern
- Check headers
- Verify HAR export
- Handle empty network data
- Handle large responses

**Estimated time:** 30 minutes

#### 3. Console Command Tests  
**Create:** `tests/integration/console.test.sh`
**Test cases needed:**
- List console messages
- Different log levels (log, warn, error)
- Filter by level
- Handle empty console
- Handle very long messages
- Messages with objects/arrays

**Estimated time:** 20 minutes

#### 4. CDP Command Tests
**Create:** `tests/integration/cdp.test.sh`
**Test cases needed:**
- Valid CDP method calls (e.g., `Runtime.evaluate`)
- Invalid method names
- Methods requiring parameters
- CDP with no session
- Malformed JSON params
- Response validation

**Estimated time:** 25 minutes

---

### Medium Priority 🟡

#### 5. URL Edge Cases
**Create:** `tests/edge-cases/url-handling.test.sh`
**Test cases:**
- `localhost:3000`, `localhost:8080`
- `127.0.0.1:3000`
- `http://user:pass@example.com`
- URLs with query params `?foo=bar&baz=qux`
- URLs with fragments `#section`
- `about:blank`
- Redirect following (301, 302)

**Estimated time:** 30 minutes

#### 6. Timeout Scenarios
**Create:** `tests/performance/timeout.test.sh`
**Test cases:**
- Custom timeout flag `--timeout 5`
- Page that exceeds timeout
- Page with slow resources
- Verify timeout works correctly

**Estimated time:** 20 minutes

#### 7. Session Lifecycle
**Create:** `tests/integration/session-lifecycle.test.sh`
**Test cases:**
- Very short session (<1s)
- Rapid start/stop cycles
- Multiple sequential sessions
- Session with no network activity
- Session interrupted by signal

**Estimated time:** 25 minutes

---

### Nice to Have 🟢

#### 8. Large Data Handling
**Create:** `tests/performance/large-data.test.sh`
- Page with 100+ network requests
- Very large DOM (10k+ elements)
- Megabytes of console output
- Response exceeding maxBodySize

#### 9. Output Validation
**Create:** `tests/integration/output-validation.test.sh`
- Validate session.json schema
- Check all commands produce valid JSON
- Verify compact vs pretty formatting
- Unicode/emoji handling

#### 10. Browser Edge Cases
**Create:** `tests/edge-cases/browser-states.test.sh`
- Chrome crash mid-session
- Pages with certificate errors
- Pages with auth required
- Pages with popups/alerts

---

## Quick Action Plan

### This Week (90 minutes)
1. ✅ **DOM test** - Created, needs testing (10 min)
2. **Network test** - High value (30 min)
3. **Console test** - High value (20 min)  
4. **CDP test** - Core functionality (25 min)
5. **URL tests** - Common scenarios (15 min)

**Result:** 5 new test files, ~50 new test cases

### Next Week (60 minutes)
6. Timeout tests (20 min)
7. Session lifecycle (25 min)
8. Review and fix any failures (15 min)

**Result:** 2 more test files, ~20 test cases

### Future
- Large data handling
- Output validation
- Platform-specific tests
- Security tests

---

## How to Run New Tests

### Run single test:
```bash
./tests/integration/dom.test.sh
```

### Run all integration tests:
```bash
for test in tests/integration/*.sh; do
  echo "Running $test..."
  "$test" || echo "FAILED: $test"
done
```

### Run full suite (includes new tests):
```bash
./tests/run-all-tests.sh
```

---

## Test Template (Copy This)

```bash
#!/usr/bin/env bash
# Integration Test: bdg [COMMAND] command

set -euo pipefail

cleanup() {
  local exit_code=$?
  bdg stop 2>/dev/null || true
  sleep 0.5
  lsof -ti:9222 | xargs kill -9 2>/dev/null || true
  sleep 0.5
  bdg cleanup --force 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

TEST_NAME="[command-name]"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$TEST_DIR/../agent-benchmark/lib"

source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/metrics.sh"
source "$LIB_DIR/recovery.sh"

log_info "=== Testing: bdg [COMMAND] command ==="

cleanup_sessions

# Test 1: [DESCRIPTION]
log_step "Test 1: [DESCRIPTION]"
# ... test code ...
log_success "Test 1 passed"

# More tests...

stop_session_gracefully
log_success "=== All tests passed ==="
exit 0
```

---

## Coverage Goals

### Current
- Commands: 5/9 tested (start, stop, status, cleanup, peek)
- Edge cases: ~30% covered
- Error scenarios: ~50% covered

### After High Priority Tests
- Commands: 9/9 tested (100%)
- Edge cases: ~60% covered
- Error scenarios: ~70% covered

### Long Term Goal
- Commands: 100%
- Edge cases: 80%+
- Error scenarios: 90%+
- Performance: 80%+

---

## Tips for Writing Good Tests

1. **Test one thing at a time** - Clear test names
2. **Use proper cleanup** - Prevent cascade failures
3. **Capture exit codes correctly** - Use `set +e; cmd; CODE=$?; set -e`
4. **Validate JSON output** - `jq` for structure checks
5. **Handle timing** - Add sleeps where needed
6. **Test negative cases** - Not just happy paths
7. **Make tests deterministic** - Avoid flaky tests
8. **Document expected behavior** - Comments help

---

## Metrics to Track

- Total test count
- Pass rate
- Execution time
- Code coverage percentage
- Number of assertions
- Flaky test count (should be 0)

---

## Next Actions

1. **Test the DOM test:** Run `./tests/integration/dom.test.sh`
2. **Create network test:** Copy template, fill in test cases
3. **Create console test:** Copy template, fill in test cases
4. **Run full suite:** Verify everything still passes
5. **Commit new tests:** Keep test coverage growing

**Target:** 20+ tests by end of week
