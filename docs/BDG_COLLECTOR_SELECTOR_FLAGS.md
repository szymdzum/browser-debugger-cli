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
