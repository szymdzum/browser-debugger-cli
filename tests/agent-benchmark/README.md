## Agent Benchmark Suite

Comprehensive benchmark framework for testing `bdg` with real-world agent workflows on production websites.

---

## Philosophy

Test against **real production complexity** to validate:
1. **Agent workflows work reliably** (success rate tracking)
2. **Error patterns are predictable** (categorized failure modes)
3. **Performance is acceptable** (timing metrics)
4. **Tool improvements are measurable** (regression detection)

---

## Quick Start

```bash
# Run all benchmarks
./run-benchmark.sh

# Run specific scenario
./run-benchmark.sh --scenario 01-github-trending

# Run with screenshots for debugging
./run-benchmark.sh --screenshot

# Verbose mode
./run-benchmark.sh --verbose
```

---

## Benchmark Tiers

### Tier 1: Static Content (Baseline)
**Sites**: example.com, news.ycombinator.com  
**Purpose**: Verify basic functionality works  
**Expected Success**: 100%

### Tier 2: Modern SPA (Real Challenge)
**Sites**: github.com/trending, wikipedia.org  
**Purpose**: Test against real-world app complexity  
**Expected Success**: 95%+

### Tier 3: Heavy JavaScript (Stress Test)
**Sites**: reddit.com, twitter.com  
**Purpose**: Push tool to limits  
**Expected Success**: 80%+ (acceptable to have challenges here)

---

## Available Scenarios

### 01: GitHub Trending Repositories
**File**: `scenarios/01-github-trending.sh`  
**Task**: Extract trending repos with name, description, stars  
**Complexity**: Tier 2 (SPA with lazy loading)  
**Expected Duration**: 10-15 seconds

**What it tests**:
- Wait conditions (`dom.wait` wrapper)
- Dynamic content loading
- Raw CDP data extraction
- JSON validation

**Success criteria**:
- Extract ≥10 repositories
- Each repo has required fields
- No timeouts

---

## Creating New Scenarios

### Template Structure

```bash
#!/bin/bash
# Agent Benchmark: [Scenario Name]
#
# Task: [What the agent is trying to accomplish]
# Complexity: Tier [1|2|3]
# Expected Duration: X-Y seconds
#
# Success Criteria:
# - [Criterion 1]
# - [Criterion 2]
#
# Known Challenges:
# - [Challenge 1]
# - [Challenge 2]

set -euo pipefail

# Benchmark metadata
SCENARIO_NAME="scenario-name"
SCENARIO_COMPLEXITY="tier2"
TARGET_URL="https://example.com"

# Load helpers
source "$(dirname "$0")/../lib/metrics.sh"
source "$(dirname "$0")/../lib/assertions.sh"

# Start timing
start_time=$(date +%s)
start_benchmark "$SCENARIO_NAME"

# Step 1: Start session
log_step "Starting bdg session"
bdg "$TARGET_URL" || die "Failed to start session"

# Step 2: Wait for content
log_step "Waiting for content to load"
bdg dom wait --selector ".target" --timeout 10000 || die "Timeout"

# Step 3: Extract data
log_step "Extracting data via CDP"
RESULT=$(bdg cdp Runtime.evaluate --params '{"expression": "...", "returnByValue": true}')

# Step 4: Validate
log_step "Validating results"
assert_gte "$(echo "$RESULT" | jq '.result.value | length')" 5 "Expected at least 5 items"

# Step 5: Stop session
bdg stop

# Calculate metrics
end_time=$(date +%s)
duration=$((end_time - start_time))
record_metric "total_duration_seconds" "$duration"

# Output results
log_success "Benchmark completed successfully"
end_benchmark "$SCENARIO_NAME" "success"

exit 0
```

### Naming Convention
- `01-description.sh` - Tier 1 scenarios
- `02-description.sh` - Tier 2 scenarios  
- `03-description.sh` - Tier 3 scenarios

Use sequential numbering within each tier.

---

## Metrics Collected

### Per-Scenario Metrics
- `total_duration_seconds` - End-to-end execution time
- `wait_duration_seconds` - Time spent waiting for elements
- `extraction_status` - Success or failure of data extraction
- `[domain]_extracted` - Count of extracted items (repos, articles, etc.)

### Aggregate Metrics
- `pass_rate` - Percentage of scenarios that succeeded
- `total_scenarios` - Number of scenarios executed
- `passed` - Count of successful scenarios
- `failed` - Count of failed scenarios

---

## Results Format

### Individual Scenario Result
Location: `results/{scenario-name}-result.json`

```json
{
  "scenario": "github-trending",
  "complexity": "tier2",
  "target": "https://github.com/trending",
  "status": "success",
  "duration_seconds": 12,
  "metrics": {
    "wait_duration_seconds": 3,
    "repositories_extracted": 25
  },
  "sample_data": [/* first 3 items */]
}
```

### Summary Report
Location: `results/benchmark-summary-{timestamp}.json`

```json
{
  "timestamp": "2025-11-06T16:00:00Z",
  "total_scenarios": 5,
  "passed": 4,
  "failed": 1,
  "pass_rate": 80.00,
  "failed_scenarios": ["03-reddit-scrape"],
  "individual_results": [/* all scenario results */]
}
```

---

## Monitoring Progress

### Tracking Improvements Over Time

```bash
# Run benchmarks before changes
./run-benchmark.sh
cp results/benchmark-summary-*.json baseline.json

# Make code improvements
# ...

# Run benchmarks after changes
./run-benchmark.sh
cp results/benchmark-summary-*.json current.json

# Compare
jq -s '
  {
    baseline_pass_rate: .[0].pass_rate,
    current_pass_rate: .[1].pass_rate,
    improvement: (.[1].pass_rate - .[0].pass_rate)
  }
' baseline.json current.json
```

### CI Integration

```yaml
# .github/workflows/agent-benchmark.yml
name: Agent Benchmarks

on: [push, pull_request]

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run benchmarks
        run: |
          cd tests/agent-benchmark
          ./run-benchmark.sh
      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: benchmark-results
          path: tests/agent-benchmark/results/
```

---

## Debugging Failed Scenarios

### 1. Run with Screenshots
```bash
./run-benchmark.sh --scenario 01-github-trending --screenshot
```

Screenshots saved to `results/{scenario-name}-screenshot.png`

### 2. Run with Verbose Mode
```bash
./run-benchmark.sh --scenario 01-github-trending --verbose
```

Shows all shell commands and intermediate outputs.

### 3. Check Individual Result File
```bash
cat results/01-github-trending-result.json | jq
```

### 4. Manual Reproduction
```bash
# Extract commands from scenario and run manually
bdg https://github.com/trending
bdg dom wait --selector "article.Box-row" --timeout 30000
# ... continue debugging
```

---

## Common Failure Patterns

### Timeout Waiting for Elements
**Symptom**: `dom.wait` exits with code 90  
**Causes**:
- Selector changed on target site
- Content requires scrolling to load
- Network is slow

**Fix**:
- Update selector in scenario
- Increase timeout
- Add scroll before wait

### Extraction Returns Empty Results
**Symptom**: `repositories_extracted: 0`  
**Causes**:
- Selector doesn't match current DOM
- Content loaded but structure changed
- JavaScript error prevented rendering

**Fix**:
- Inspect screenshot with `--screenshot`
- Verify selector with manual test
- Check browser console for JS errors

### Session Start Failure
**Symptom**: `bdg start` fails  
**Causes**:
- Chrome not installed
- Port conflict (9222 in use)
- Previous session not cleaned up

**Fix**:
- Run `bdg cleanup --force`
- Check Chrome installation
- Kill processes on port 9222

---

## Performance Benchmarks

### Target Performance (Tier 2 Scenarios)
- **Session start**: <2 seconds
- **Wait for element**: <5 seconds (typical)
- **Data extraction**: <1 second
- **Total workflow**: <15 seconds

### Performance Regression Detection
If a scenario's duration increases by >20% between runs, investigate:
1. Network latency (test on multiple networks)
2. Tool overhead (profile `bdg` commands)
3. Target site changes (verify DOM complexity)

---

## Extending the Benchmark Suite

### Adding New Tier 2 Scenario (Recommended)

1. **Pick a production site** with moderate complexity:
   - Modern framework (React, Vue, Angular)
   - Lazy loading or dynamic content
   - Publicly accessible (no auth required)

2. **Define a concrete task**:
   ```
   Task: Extract top 10 posts from Reddit frontpage
   Success: Get post titles, scores, comment counts
   ```

3. **Create scenario file**:
   ```bash
   cp scenarios/01-github-trending.sh scenarios/02-reddit-frontpage.sh
   # Edit scenario details
   ```

4. **Test manually** before adding to suite:
   ```bash
   bash scenarios/02-reddit-frontpage.sh
   ```

5. **Iterate until stable** (95%+ success rate over 10 runs)

6. **Document known challenges** in scenario header

---

## FAQ

**Q: How often should benchmarks run?**  
A: Run locally before PRs. Run in CI on every push to main.

**Q: What pass rate is acceptable?**  
A: Tier 1: 100%, Tier 2: 95%+, Tier 3: 80%+

**Q: Should benchmarks test bdg internals or agent workflows?**  
A: **Agent workflows only**. Focus on end-to-end tasks agents would perform.

**Q: What if a site changes and breaks a scenario?**  
A: Update the scenario to match the new site structure. Document the change in git history.

**Q: Can I test authenticated workflows?**  
A: Yes, but use test accounts only. Never commit credentials.

---

## Next Steps

1. **Implement `dom.wait` wrapper** (M1 deliverable)
2. **Run baseline benchmarks** before any M1 changes
3. **Run benchmarks after M1** and compare pass rates
4. **Add 2-3 more Tier 2 scenarios** (Wikipedia, HN comments, etc.)
5. **Integrate into CI** for automated regression detection

---

## References

- [M1 Implementation Guide](../../docs/roadmap/M1_IMPLEMENTATION_GUIDE.md)
- [Roadmap](../../docs/roadmap/ROADMAP.md)
- [Agent-Friendly CLI Principles](../../docs/AGENT_FRIENDLY_TOOLS.md)
