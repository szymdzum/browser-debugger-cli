# Preview Writer Optimization

## Problem Summary
- Path: `src/cli/handlers/PreviewWriter.ts`
- Current behaviour: every preview polling cycle (default 5 s) constructs both the lightweight preview payload *and* the full-session artifact before writing them to disk via `writePartialOutputAsync` and `writeFullOutputAsync`.
- Consequence: serializing the full capture repeatedly can take hundreds of milliseconds and produce ~87 MB writes, driving unnecessary CPU and disk churn during long-running sessions.

## Why It Matters
- Violates KISS/YAGNI by doing shutdown-grade work inside a live refresh loop whose primary purpose is quick status checks.
- Sustained JSON serialization and large file writes risk starving the event loop, slowing collector callbacks, and creating noisy `preview` logs.
- On constrained environments (CI, containers) this behaviour can saturate storage I/O or exceed disk quotas.

## Potential Optimizations
1. **Defer full artifact to shutdown:** Keep the periodic preview write, but only produce the full payload from `ShutdownController.finalize` where the data is already needed for `bdg stop`.
2. **Split intervals:** Maintain the 5 s cadence for the preview file, while writing the heavy artifact on a longer cadence (e.g., every 60 s) guarded by a monotonic timer.
3. **Make full writes opt-in:** Gate the full artifact behind a CLI flag or environment variable so default runs only emit the lightweight preview while advanced users can enable frequent full snapshots when required.

Whichever approach we choose, centralizing the strategy inside `PreviewWriter` keeps downstream commands unchanged while eliminating avoidable load on typical sessions.
