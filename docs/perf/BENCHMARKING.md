# Performance Benchmarking

This document describes how to run performance benchmarks for the browser-debugger-cli (bdg) tool to measure collector overhead and data collection efficiency.

## Overview

The benchmarking system measures:
- **Collector initialization time**: Time to start DOM, network, and console collectors
- **Session startup time**: Total time from launch to collection start
- **Data collection performance**: Requests captured, bodies fetched/skipped
- **Output file sizes**: Preview and full output sizes for different collector combinations

## Quick Start

### Run Benchmarks

```bash
# Run all benchmark scenarios
npm run benchmark

# Results written to docs/perf/collector-baseline.md
```

### Benchmark Server (Standalone)

The benchmark server can be run independently for manual testing:

```bash
# Start server on random available port
tsx scripts/benchmark-server.ts

# Server will print:
# Benchmark server listening on http://localhost:3000
```

## Benchmark Scenarios

The benchmark tests these collector combinations:

1. **All collectors** (default): DOM, network, console
2. **Network only**: `--network --skip-dom --skip-console`
3. **DOM only**: `--dom --skip-network --skip-console`
4. **Console only**: `--console --skip-network --skip-dom`
5. **Network + Console**: `--network --console --skip-dom`

Each scenario runs for **6 seconds** against the built-in test server.

## Test Data

The benchmark server serves realistic test data:

### Routes

- `/` - HTML home page (1.5KB)
- `/api/users` - JSON API response (10 users, 750B)
- `/style.css` - Stylesheet (200B, auto-skipped by default)
- `/app.js` - JavaScript bundle (300B)
- `/app.js.map` - Source map (400B, auto-skipped by default)
- `/avatar.png` - Image file (150B, auto-skipped by default)
- `/font.woff2` - Web font (150B, auto-skipped by default)

### Expected Behavior

With **default auto-optimization** enabled:

| Route | Body Fetched? | Reason |
|-------|---------------|--------|
| `/` | ✅ Yes | HTML content (useful for debugging) |
| `/api/users` | ✅ Yes | JSON API response (critical for debugging) |
| `/style.css` | ❌ No | Stylesheet (matches `*.css` auto-skip pattern) |
| `/app.js` | ✅ Yes | JavaScript code (useful for debugging) |
| `/app.js.map` | ❌ No | Source map (matches `*.map` auto-skip pattern) |
| `/avatar.png` | ❌ No | Image (matches `*.png` auto-skip pattern) |
| `/font.woff2` | ❌ No | Font (matches `*.woff2` auto-skip pattern) |

**Expected body fetch rate**: ~43% (3 fetched, 4 skipped)

## Architecture

### Components

1. **scripts/benchmark-fixtures.ts**
   - Reusable test data shared by benchmark and integration tests
   - Route definitions with expected behavior documentation
   - `DEFAULT_SKIP_BODY_PATTERNS` constant

2. **scripts/benchmark-server.ts**
   - Self-contained HTTP server using Node's built-in `http` module
   - No external dependencies (e.g., Express)
   - Graceful shutdown on SIGINT/SIGTERM
   - Auto-binds to available port (uses port 0 for random assignment)

3. **scripts/benchmark.ts**
   - Main benchmark runner
   - Executes bdg CLI for each scenario
   - Parses PERF logs from stderr to extract metrics
   - Generates markdown report with timing breakdowns

### Flow

```
benchmark.ts
  ├─> Starts benchmark-server.ts
  ├─> For each scenario:
  │     ├─> Spawns `bdg <url> <flags> --timeout 3`
  │     ├─> Parses stderr for [PERF] logs
  │     └─> Extracts timing and optimization metrics
  ├─> Generates markdown report
  └─> Writes to docs/perf/collector-baseline.md
```

## Metrics Collected

### Timing Metrics (from PERF logs)

- **Total session startup**: Time from launch to collection start
- **Chrome launch**: Time to start Chrome browser
- **CDP connection**: Time to establish DevTools Protocol connection
- **Collector initialization**: Time to initialize each collector
- **Preview write**: Time to write lightweight preview JSON
- **Full write**: Time to write complete output JSON

### Network Optimization Metrics

- **Bodies fetched**: Number of response bodies downloaded
- **Bodies skipped**: Number of bodies skipped by auto-optimization
- **Skip percentage**: `(bodies_skipped / total_bodies) × 100`

### Output Size Metrics

- **Preview JSON size**: Size of lightweight preview file (`session.preview.json`)
- **Full JSON size**: Size of complete output file (`session.full.json`)

## Next Steps (Benchmark Roadmap)

To turn the current harness into a long-term decision tool:

- **Broaden scenarios** – Add additional fixtures for streaming responses, large assets, and WebSocket-heavy apps so optimisations are validated beyond the default demo server.
- **Collect richer metrics** – Capture Chrome-side stats (e.g., `Network.dataReceived`, `Performance.getMetrics`) alongside node PERF logs to cross-check what the browser reports.
- **Reduce variance** – Run each scenario multiple times (report min/avg/max) or extend run duration when chasing regressions to smooth out noise.
- **Automate guardrails** – Wire `npm run benchmark` into CI (full suite manually, “all collectors” in PR/weekly cron) and alert when runtime or size crosses agreed thresholds.
- **Provide comparison tooling** – Add a helper script such as `npm run benchmark:compare <old> <new>` that diffs two markdown reports and highlights timing/size deltas.
- **Document provenance** – Record the commit SHA and flag set for each published baseline, and keep README/CLAUDE claims in sync with the latest measured numbers.

## Operational Practices

### Using the Benchmark Harness

- Keep `npm run benchmark` as a pre-merge gate for collector/output changes and attach the `docs/perf/collector-baseline.md` diff to PRs so reviewers see the runtime/size impact.
- Capture a “golden” baseline on `main` (store the commit SHA at the top of `docs/perf/collector-baseline.md`). Re-run benchmarks whenever a feature branches to ensure deltas are attributable.
- When results shift, annotate the markdown with a short note (e.g., “+12% preview size: added console payloads”) to maintain an auditable history.

### Automating Checks

- Schedule `npm run benchmark` in CI (e.g., weekly cron) and publish the markdown as an artifact; alert if metrics regress beyond thresholds (e.g., +10 % runtime, +20 % file size).
- For PR pipelines, run the “all collectors” scenario in CI to keep runtime reasonable, and encourage full local runs before merging heavier changes.

### Feeding Optimisations

- Use the bodies fetched/skipped counts to tune `DEFAULT_SKIP_BODY_PATTERNS`; high skip ratios indicate more patterns could be defaults, while frequent fetches highlight gaps.
- Correlate benchmark output with `[bdg] active collectors` logs from real captures to validate that field usage matches expectations; when noise is reported, re-run the relevant scenario with matching flags.

### Documentation Maintenance

- Refresh the “Performance Optimisation” sections in `README.md` and `CLAUDE.md` whenever benchmarks show a significant improvement or new flag so public claims stay current.

## Interpreting Results

### Baseline Expectations

Typical values for a **3-second collection** on localhost:

| Metric | Expected Value | Notes |
|--------|----------------|-------|
| Total startup | 1000-2000ms | Cold start (Chrome launch) |
| CDP connection | 50-200ms | WebSocket handshake |
| Collector init (each) | 10-50ms | CDP domain enable |
| Preview JSON size | 50-500KB | Metadata only (last 1000 items) |
| Full JSON size | 1-100MB | Complete data with bodies |
| Body skip rate | 40-60% | With default auto-optimization |

### Performance Regression Detection

Use benchmarks to detect regressions:

```bash
# Run baseline before changes
npm run benchmark
cp docs/perf/collector-baseline.md docs/perf/baseline-before.md

# Make code changes...

# Run benchmark after changes
npm run benchmark

# Compare results
diff docs/perf/baseline-before.md docs/perf/collector-baseline.md
```

**Red flags** (investigate if any occur):

- ⚠️ Total startup time increased by >20%
- ⚠️ Collector initialization time doubled
- ⚠️ Body skip rate dropped significantly (more fetches = more overhead)
- ⚠️ Preview JSON size grew by >50% (indicates inefficient filtering)

## Customizing Benchmarks

### Adjust Collection Duration

Edit `scripts/benchmark.ts`:

```typescript
const COLLECTION_DURATION_SECONDS = 5; // Change from 3 to 5 seconds
```

### Add New Scenarios

Edit `scripts/benchmark.ts`:

```typescript
const scenarios = [
  // ... existing scenarios
  {
    name: 'Network with custom patterns',
    flags: ['--network', '--skip-dom', '--skip-console',
            '--network-exclude', '*analytics*,*tracking*'],
  },
];
```

### Add New Routes

Edit `scripts/benchmark-fixtures.ts`:

```typescript
export const routes = {
  // ... existing routes
  '/api/analytics': {
    method: 'POST',
    contentType: 'application/json',
    body: { event: 'page_view' },
    size: '50B',
  },
};
```

## Integration with CI

To run benchmarks in CI:

```yaml
# .github/workflows/benchmark.yml
- name: Run performance benchmarks
  run: npm run benchmark

- name: Upload benchmark results
  uses: actions/upload-artifact@v3
  with:
    name: benchmark-results
    path: docs/perf/collector-baseline.md
```

## Troubleshooting

### Benchmark Server Won't Start

**Symptom**: `Error: listen EADDRINUSE`

**Solution**: Port already in use. The server uses port 0 (random assignment) by default, so this should be rare. Check for orphaned processes:

```bash
ps aux | grep benchmark-server
kill <pid>
```

### Benchmark Hangs

**Symptom**: Benchmark runs but never completes

**Solution**: bdg session might not be stopping. Check for orphaned Chrome processes:

```bash
bdg cleanup --aggressive
```

### PERF Logs Not Parsed

**Symptom**: Benchmark completes but no metrics in report

**Solution**: Check that stderr contains `[PERF]` logs. Run manually:

```bash
tsx scripts/benchmark-server.ts &
SERVER_PID=$!
bdg http://localhost:3000 --timeout 3 2>&1 | grep PERF
kill $SERVER_PID
```

## Related Documentation

- [BDG_COLLECTOR_SELECTOR_FLAGS.md](../BDG_COLLECTOR_SELECTOR_FLAGS.md) - Collector flag documentation
- [BDG_CDP_OPTIMIZATION_OPPORTUNITIES.md](../BDG_CDP_OPTIMIZATION_OPPORTUNITIES.md) - Future optimization ideas
- [PREVIEW_WRITER_OPTIMIZATION.md](../PREVIEW_WRITER_OPTIMIZATION.md) - Two-tier output system design
