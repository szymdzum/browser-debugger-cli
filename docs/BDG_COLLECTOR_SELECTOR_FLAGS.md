# BDG Collector Selector Flags

## Context

Analysts and agents consistently run `bdg <url>` with large flag bundles to suppress unwanted data (for example, capturing only DOM), yet they seldom use the bespoke `bdg dom`, `bdg network`, or `bdg console` subcommands. Because the default command always enables **all** collectors, captures incur unnecessary Chrome DevTools Protocol (CDP) subscriptions, heavy preview serialization, and large on-disk artifacts even when only a subset is required.

## Goals

- Provide an obvious, low-friction way to choose which collectors (`dom`, `network`, `console`) run during a session.
- Reduce capture weight (CPU, memory, disk) by avoiding unused collectors and associated preview writes.
- Simplify the CLI surface so workflows revolve around a single `bdg` command with intuitive switches.

## Non-Goals

- No new profile/recommendation system as described in `BDG_CAPTURE_OPTIMIZATION.md`.
- No collector-level optimizations in this feature (they follow once usage insights are available).

## Proposed CLI Changes

- **Add additive switches**: `--dom`, `--network`, `--console`. When any are present, only those collectors are activated.
- **Add subtractive switches**: `--no-dom`, `--no-network`, `--no-console`. These disable specific collectors while keeping defaults for the rest.
- **Default behavior**: `bdg <url>` with no collector flags continues to launch all collectors (backward compatible).
- **Remove subcommands**: drop `bdg dom`, `bdg network`, `bdg console` registrations; the flag-based approach replaces them.
- **Validation**: detect contradictory combinations (e.g., `--dom` with `--no-dom`) and fail fast with a clear error.

## Technical Tasks

1. **CLI Parsing**
   - Extend `applyCollectorOptions()` in `src/cli/commands/start.ts` to register the new flags.
   - Build the final `CollectorType[]` inside `collectorAction()` before calling `startSession()`; emit errors on invalid flag mixes.
   - Suggested helper: a `resolveCollectors(options: CollectorOptions): CollectorType[]` alongside `collectorAction()` so both CLI integration tests and other tooling can reuse the logic. Consider splitting additive vs. subtractive flag handling for readability.
   - `CollectorType` is defined in `src/types.ts:64`; no changes expected, but double-check any type guards that assume all collectors are always active.
2. **Collector Usage**
   - Ensure the chosen collector list flows unchanged to `BdgSession.startCollector`.
   - Log the active collector set once per run to aid future optimization prioritization (e.g., `console.error('[bdg] active collectors: dom, network')` in `startSession()` after `startCollectorsAndMetadata` returns).
3. **Preview Writer**
   - Update `PreviewWriter.doWrite()` (`src/cli/handlers/PreviewWriter.ts`) to skip building/serializing sections for inactive collectors.
   - Guard the `OutputBuilder.build` calls by cloning only the active data arrays; avoid splicing the original arrays because they are shared references from `BdgSession`.
4. **Code Cleanup**
   - Remove the dedicated subcommand registration blocks from `registerStartCommands()` and delete any now-unused helpers/tests.
   - After removal, ensure Commander’s default command still registers last; validate by running `bdg --help` locally to confirm the layout.
5. **Documentation**
   - Refresh `README.md` and `CLAUDE.md` quick-start sections with examples such as `bdg --dom --console <url>` and `bdg --no-console <url>`.
   - Update `bdg --help` snapshot or description if tracked in docs.
6. **Testing**
   - Add a CLI-level test exercising a DOM-only run and a console-disabled run.
   - Unit test the collector-derivation helper to guarantee deterministic behavior (e.g., conflicting flags throw, no flags returns all collectors).
   - Smoke test `bdg --network` to ensure `PreviewWriter` doesn’t attempt to build console/DOM sections (can assert the preview JSON omits those keys).
   - Follow the existing `node:test` pattern in `src/__tests__/integration/session-files.integration.test.ts` for end-to-end coverage; `docs/TESTING_FOUNDATION.md` outlines the harness helpers if needed.

## Future Follow-Up

- Use the logged collector set frequencies to sequence collector-specific performance work (network filtering, DOM snapshot slimming, console log compaction).
- Consider optional telemetry for preview write size/time reductions once collectors become selective.

## Network Optimization Features (Implemented)

### Automatic Body Skipping

By default, bdg automatically skips fetching response bodies for non-essential assets to reduce data volume by 50-80%:

**Auto-skipped patterns** (`DEFAULT_SKIP_BODY_PATTERNS`):
- Images: `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.svg`, `*.ico`, `*.webp`, `*.bmp`, `*.tiff`
- Fonts: `*.woff`, `*.woff2`, `*.ttf`, `*.eot`, `*.otf`
- Stylesheets: `*.css`
- Source maps: `*.map`, `*.js.map`, `*.css.map`
- Videos: `*.mp4`, `*.webm`, `*.ogg`, `*.avi`, `*.mov`
- Audio: `*.mp3`, `*.wav`, `*.flac`, `*.aac`

**Why these patterns?** Assets like images and fonts are rarely useful for debugging application logic, but consume significant bandwidth and storage. API responses (JSON, HTML) are always fetched by default.

### Pattern Matching Flags

Control which URLs and bodies are captured using wildcard patterns:

**Body Fetching Control:**
```bash
# Fetch all bodies (override auto-optimization)
bdg <url> --fetch-all-bodies

# Only fetch bodies matching patterns (comma-separated)
bdg <url> --fetch-bodies-include "*/api/*,*/graphql"

# Additional patterns to exclude
bdg <url> --fetch-bodies-exclude "*analytics*,*tracking*"
```

**URL Filtering:**
```bash
# Only capture URLs matching patterns
bdg <url> --network-include "*/api/*,api.example.com/*"

# Exclude URLs matching patterns
bdg <url> --network-exclude "*analytics*,*tracking*,*ads*"
```

### Pattern Syntax

bdg uses **simple wildcard patterns** (not glob or regex):

- `*` matches any characters (including `/`)
- Patterns are **case-insensitive**
- Matching is done against **both bare hostname and hostname+pathname**
  - This allows `api.example.com` to match without requiring `/*`

**Examples:**

| Pattern | Matches | Doesn't Match |
|---------|---------|---------------|
| `api.example.com` | All URLs on `api.example.com` (any path) | `cdn.example.com` |
| `api.example.com/*` | Same as above (explicit wildcard) | `cdn.example.com` |
| `api.example.com/users` | Only `api.example.com/users` endpoint | `api.example.com/posts` |
| `*.png` | `example.com/logo.png` | `example.com/logo.jpg` |
| `*/api/*` | `example.com/api/users` | `example.com/v1/graphql` |
| `*analytics*` | Any hostname containing "analytics" | `api.example.com/data` |

### Pattern Precedence Rule

**Include always trumps exclude** to provide predictable behavior:

```bash
# Example: Exclude all tracking, but include Mixpanel specifically
bdg <url> \
  --network-include "*mixpanel.com/*" \
  --network-exclude "*analytics*,*tracking*"

# Result: Mixpanel requests are captured despite matching *tracking*
```

**Precedence order:**
1. If URL matches `--network-include` → **CAPTURE** (even if it also matches exclude)
2. If URL matches `--network-exclude` → **EXCLUDE**
3. Otherwise → **CAPTURE** (default)

The same precedence applies to `--fetch-bodies-include` vs `--fetch-bodies-exclude`.

### Output Optimization

**Compact JSON Output:**

Use `--compact` flag to reduce output file sizes by ~30% (removes indentation):

```bash
# Compact output (single-line JSON, no indentation)
bdg <url> --compact

# Default output (pretty-printed with 2-space indentation)
bdg <url>
```

**Impact:**
- Smaller disk footprint for session files
- Faster JSON.stringify operations
- Trade-off: Less human-readable (use `jq` for formatting)

**Inactive Collector Omission:**

When using collector selector flags, inactive sections are **completely omitted** from output (not empty arrays):

```bash
# Only network collector active
bdg <url> --network --skip-dom --skip-console

# Output structure:
{
  "data": {
    "network": [...]
    // No "dom" or "console" keys present
  }
}
```

**Impact:**
- 30-70% output size reduction for selective collector runs
- Cleaner output structure (only requested data)
- Agent-optimized: reduces token consumption when parsing

## Performance Benchmarking

To measure the impact of optimization features, use the built-in benchmark system:

```bash
# Run all benchmark scenarios
npm run benchmark

# Results written to docs/perf/collector-baseline.md
```

See [docs/perf/BENCHMARKING.md](perf/BENCHMARKING.md) for detailed documentation.
