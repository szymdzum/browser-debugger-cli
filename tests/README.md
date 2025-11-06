# Test Suite Documentation

Comprehensive test suite for **bdg** (Browser Debugger CLI) following the testing philosophy outlined in `docs/TESTING_PHILOSOPHY.md`.

## Philosophy

This test suite follows these principles:
- ✅ **Test the contract** (behavior), not implementation
- ✅ **Mock only boundaries** (network, filesystem, time), not our code
- ✅ **Integration-style tests** (whole modules, not individual functions)
- ✅ **Black-box testing** (input → output)
- ✅ **Refactor-friendly** (tests survive implementation changes)

See `docs/TESTING_PHILOSOPHY.md` for detailed rationale.

## Test Structure

```
tests/
├── run-all-tests.sh                   # Master test runner
├── agent-benchmark/                   # E2E scenarios (Tier 1-3 complexity)
│   ├── run-benchmark.sh
│   ├── scenarios/
│   │   ├── 00-hn-top-stories.sh      # Tier 1: Static HTML
│   │   ├── 01-github-trending.sh      # Tier 2: SPA with lazy loading
│   │   ├── 02-wikipedia-summary.sh    # Tier 2: Heavy DOM
│   │   ├── 03-reddit-scrape.sh        # Tier 3: Dynamic content
│   │   ├── 04-network-filtering.sh    # Tier 2: Filter validation
│   │   └── 05-spa-navigation.sh       # Tier 3: Client-side routing
│   └── lib/
│       ├── assertions.sh              # Test helpers (log, assert)
│       ├── metrics.sh                 # Timing and metrics tracking
│       └── recovery.sh                # Cleanup and retry patterns
├── integration/                       # Command integration tests
│   ├── status.test.sh                 # bdg status (all flags)
│   ├── peek.test.sh                   # bdg peek (filters, limits)
│   ├── details.test.sh                # bdg details (network/console)
│   └── cleanup.test.sh                # bdg cleanup (force, aggressive)
├── error-scenarios/                   # Error path and edge case tests
│   ├── 01-port-conflict.sh           # Port already in use
│   ├── 02-invalid-url.sh             # URL validation
│   ├── 03-stale-session-recovery.sh  # Stale PID/socket handling
│   ├── 04-concurrent-session-prevention.sh  # Multiple sessions
│   ├── 05-daemon-crash-recovery.sh   # Daemon/worker crashes
│   └── 06-chrome-launch-failure.sh   # Chrome launch errors
└── results/                           # Test outputs and logs (gitignored)
```

## Running Tests

### Run All Tests
```bash
./tests/run-all-tests.sh
```

### Run Specific Test Suites
```bash
# Agent benchmarks only (E2E scenarios)
./tests/run-all-tests.sh --benchmark

# Integration tests only (command testing)
./tests/run-all-tests.sh --integration

# Error scenarios only (edge cases)
./tests/run-all-tests.sh --errors
```

### Run Individual Test Suites
```bash
# Agent benchmarks with summary report
./tests/agent-benchmark/run-benchmark.sh

# Specific benchmark scenario
./tests/agent-benchmark/run-benchmark.sh --scenario 00-hn-top-stories

# Individual integration test
./tests/integration/peek.test.sh

# Individual error scenario
./tests/error-scenarios/01-port-conflict.sh
```

## Test Categories

### 1. Agent Benchmarks (E2E)

**Purpose:** Validate end-to-end functionality with real websites

**What they test:**
- Complete flow: CLI → IPC → Daemon → Worker → CDP → Chrome
- Data collection (network, console, DOM)
- Real-world page complexity (static HTML → SPAs → dynamic content)
- Network filtering patterns

**Complexity Tiers:**
- **Tier 1:** Static HTML (HN top stories)
- **Tier 2:** SPAs with lazy loading (GitHub trending, Wikipedia)
- **Tier 3:** Heavy JavaScript and dynamic content (Reddit, SPA navigation)

**Example:**
```bash
./tests/agent-benchmark/run-benchmark.sh --scenario 00-hn-top-stories
```

### 2. Integration Tests (Commands)

**Purpose:** Test all CLI commands and flag combinations

**What they test:**
- `bdg status` (basic, --verbose, --json)
- `bdg peek` (filters, --last N, --follow, --json)
- `bdg details` (network/console, ID/index lookup)
- `bdg cleanup` (basic, --force, --aggressive)

**Example:**
```bash
./tests/integration/peek.test.sh
```

### 3. Error Scenarios (Edge Cases)

**Purpose:** Validate error handling and recovery

**What they test:**
- Port conflicts (multiple sessions on same port)
- Invalid input (URLs, port numbers, indices)
- Stale session recovery (dead PID, stale sockets)
- Concurrent session prevention (race conditions)
- Daemon/worker crashes (SIGKILL, unexpected exit)
- Chrome launch failures (missing binary, permissions)

**Example:**
```bash
./tests/error-scenarios/05-daemon-crash-recovery.sh
```

## Test Helpers

### Assertions (`lib/assertions.sh`)
```bash
assert_gte 10 5 "Expected at least 5"     # Greater than or equal
assert_not_empty "$value" "Should exist"  # Non-empty check
assert_has_field "$json" "status"         # JSON field check
```

### Logging (`lib/assertions.sh`)
```bash
log_info "Informational message"
log_success "Test passed"
log_warn "Warning message"
log_error "Error message"
log_step "Step 1: Starting test"
die "Fatal error"
```

### Metrics (`lib/metrics.sh`)
```bash
start_benchmark "scenario-name"
record_metric "request_count" 42
end_benchmark "scenario-name" "success"
```

### Recovery (`lib/recovery.sh`)
```bash
cleanup_sessions                          # Clean stale sessions
stop_session_gracefully                   # Retry stop with cleanup
retry_with_backoff 3 "bdg status"         # Exponential backoff
wait_for_condition 30 "check_cmd" "desc"  # Poll with timeout
```

## Test Results

Test results are stored in `tests/results/`:
- `*.log` - Individual test output
- `*-result.json` - Benchmark metrics and sample data
- `benchmark-summary-*.json` - Aggregate benchmark report

Results directory is gitignored.

## Requirements

- **bdg** installed (`npm link` or global install)
- **Chrome** installed (standard locations)
- **jq** for JSON parsing
- **Bash 4+** for modern shell features

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Test Suite
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm install
      - run: npm run build
      - run: npm link
      - run: ./tests/run-all-tests.sh
```

### Local Pre-Push Hook
```bash
#!/bin/bash
# .git/hooks/pre-push
./tests/run-all-tests.sh || {
  echo "Tests failed. Push aborted."
  exit 1
}
```

## Adding New Tests

### Agent Benchmark Scenario
```bash
# 1. Copy template
cp tests/agent-benchmark/scenarios/00-hn-top-stories.sh \
   tests/agent-benchmark/scenarios/06-new-scenario.sh

# 2. Update metadata
SCENARIO_NAME="new-scenario"
SCENARIO_COMPLEXITY="tier2"
TARGET_URL="https://example.com"

# 3. Implement extraction logic
EXTRACT_SCRIPT='...'

# 4. Add validation assertions
assert_gte "$COUNT" 10 "Expected at least 10 items"

# 5. Make executable
chmod +x tests/agent-benchmark/scenarios/06-new-scenario.sh
```

### Integration Test
```bash
# 1. Create test file
touch tests/integration/new-command.test.sh
chmod +x tests/integration/new-command.test.sh

# 2. Source helpers
source "$LIB_DIR/assertions.sh"
source "$LIB_DIR/recovery.sh"

# 3. Write test cases
log_step "Test 1: Basic functionality"
OUTPUT=$(bdg new-command 2>&1) || die "Command failed"
# ... assertions ...

# 4. Cleanup
stop_session_gracefully
```

### Error Scenario
```bash
# 1. Create scenario file
touch tests/error-scenarios/07-new-error.sh
chmod +x tests/error-scenarios/07-new-error.sh

# 2. Simulate error condition
# ... create error state ...

# 3. Verify error handling
COMMAND_OUTPUT=$(bdg command 2>&1) || true
EXIT_CODE=$?
assert_not_equal "$EXIT_CODE" 0 "Should have failed"

# 4. Verify recovery
# ... test recovery mechanism ...

# 5. Cleanup
bdg cleanup --force
```

## Debugging Failed Tests

### View Test Output
```bash
# Check logs
cat tests/results/<test-name>.log

# View last 20 lines
tail -20 tests/results/<test-name>.log

# Search for errors
grep -i error tests/results/<test-name>.log
```

### Run Test with Debugging
```bash
# Enable bash debugging
bash -x tests/integration/status.test.sh

# Run with verbose output
bdg status --verbose
```

### Common Issues

**Port already in use:**
```bash
# Find process using port 9222
lsof -i :9222

# Kill process
kill -9 <PID>

# Or use cleanup
bdg cleanup --force
```

**Stale session files:**
```bash
# Remove manually
rm -rf ~/.bdg/

# Or use aggressive cleanup
bdg cleanup --aggressive
```

**Chrome won't launch:**
```bash
# Check Chrome binary
which google-chrome-stable  # Linux
which "Google Chrome"       # macOS

# Use custom user-data-dir
bdg example.com --user-data-dir ~/custom-chrome-profile
```

## Performance Notes

**Test execution times (approximate):**
- Agent benchmarks: 5-20s per scenario (network-dependent)
- Integration tests: 5-15s per test (session startup overhead)
- Error scenarios: 3-10s per test (crash/recovery simulation)
- Full suite: 3-5 minutes (sequential execution)

**Parallel execution:**
Not recommended - tests share resources (port 9222, session files) and would conflict.

## Contributing

When adding new features:
1. ✅ Add integration test for new CLI commands
2. ✅ Add error scenario for new error paths
3. ✅ Update this README with new test descriptions
4. ✅ Ensure all tests pass before submitting PR

See `docs/TESTING_PHILOSOPHY.md` for testing best practices.
