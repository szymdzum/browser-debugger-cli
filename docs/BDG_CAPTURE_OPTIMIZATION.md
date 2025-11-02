# BDG Capture Optimisation Plan

## Overview

This plan focuses on making `bdg` faster and less resource intensive when capturing telemetry from arbitrary web targets. The changes target repeat pain points observed while investigating `http://localhost:3000/customer/register`, but they apply to any session where analysts only need a subset of the collected data.

The document is structured around:

1. **Modules to evolve** – where the current architecture forces expensive operations.
2. **Problematic workflows** – how those modules manifest during real captures.
3. **Concrete improvements** – configuration, code changes, and CLI additions.
4. **Where CDP can help** – protocol features and specific endpoints that let us trim the firehose before it hits disk.
5. **Implementation roadmap** – phased plan with cross-module dependencies and test considerations.

---

## Modules to Address

| Module | Current Behaviour | Why It Hurts |
| --- | --- | --- |
| `src/cli/handlers/PreviewWriter.ts` | Every 5 s builds **both** preview and full payloads, then writes them. | Generates ~80 MB stringifications + I/O churn even when analysts only need a quick peek. |
| `src/utils/session.ts` (`writePartialOutputAsync`, `writeFullOutputAsync`) | Always pretty-print full arrays and log timings. | No filtering/compaction, so disk writes balloon and logs spam shells. |
| `src/cli/handlers/OutputBuilder.ts` | Supports `preview`, `full`, `final` only. | No way to emit “network-summary”, “DOM-only”, etc.; forces post-processing. |
| `src/cli/handlers/sessionController.ts` | Session lifecycle always spins up PreviewWriter, all collectors, memory logging. | No concept of “quick profile” or conditional collectors. |
| `src/cli/commands/start.ts` | CLI options cover Chrome launch only. | Users can’t request lean captures (`--profile summary`, `--network-filter ...`). |
| `docs/PREVIEW_WRITER_OPTIMIZATION.md` | High-level note to defer full writes. | Needs broader plan covering filtering, CDP, and CLI UX. |

---

## Painful Processes & Examples

1. **Repeated Full Snapshots**  
   - Scenario: Investigating the Castorama register page. In 15 s we emitted five `session.full.json` files, each ~78 MB.  
   - Impact: ~400 MB temporary files, repeated 200 ms `JSON.stringify`, token-heavy perf logs.  
   - Observation: we only needed DOM inputs and the `marketingChannels` payload.

2. **Unfiltered Network Harvest**  
   - Scenario: Same run captured fonts, SVGs, third-party pixels (`google.com/pagead`, `pixel.wp.pl`, etc.).  
   - Impact: parsing these to find relevant requests cost extra time; most data was noise.  
   - Desired behaviour: block known-static domains or extend CLI to pass include/exclude lists.

3. **One-Size Output**  
   - Scenario: After capture we had to manually parse `session.json`, grep for `marketingConsent`, decode sourcemaps, etc.  
   - Impact: manual work spilled into tokens and time; there is no built-in “show me network payload containing X”.  
   - Desired behaviour: BDG exports targeted summaries (forms detected, API hits, etc.).

4. **Rigid Lifecycle**  
   - Scenario: Even a “one-off DOM capture” spawns PreviewWriter + collectors + memory logger.  
   - Impact: extra complexity for quick tasks like “list inputs on this form”.  
   - Desired behaviour: a fast profile to connect → snapshot DOM → disconnect (no preview loop).

---

## Improvement Themes

### 1. Capture Profiles

Add a `--profile <name>` flag (default=`full`) with built-in profiles:

| Profile | Collectors | Preview Writer | Output Modes | Filtering |
| --- | --- | --- | --- | --- |
| `full` | dom, network, console | preview + full (current state) | preview/full/final | none |
| `summary` | dom, network | preview-only | preview, summary (new) | network allowlist/blocklist |
| `dom-only` | dom | disabled | DOM snapshot at end | N/A |
| `network-lite` | network | preview optional | host-filtered network summary | block assets via CDP |

Implementation notes:

- Extend `start.ts` to parse `--profile` and optional overrides (`--no-full-writes`, `--network-include <...>`).
- Update `startSession` to map profiles into collector sets and preview writer options.
- Provide a config file fallback (e.g., `~/.bdg/profiles.json`) for custom definitions.

### 2. Preview Writer Cadence & Modes

- Inject options into `PreviewWriter` constructor: `{ fullWriteIntervalMs?: number; mode: 'preview-only' | 'full-and-preview' }`.
- Accept a `flushFull()` method to produce a single full snapshot on demand (e.g., shutdown).
- Respect profile defaults (`summary` → preview-only, `full` → full write every n minutes).

#### Accessibility-Aware Sampling

- Add an optional “semantic snapshot” mode that captures the Chrome accessibility tree rather than raw DOM when analysts only need a structural overview.  
- Implementation hints:
  - Use `Accessibility.getPartialAXTree` or `Accessibility.queryAXTree` to pull semantic nodes, then map `backendDOMNodeId` back to DOM data when needed.citechromedevtools.github.io/devtools-protocol/tot/Accessibility/?utm_source=openaidev.to/this-is-angular/chrome-devtools-mcp-server-guide-24faqiita.com/rakkyyy/items/2857d455e161ddd4d62f
  - Provide CLI flags such as `--semantic-snapshot` so PreviewWriter can return role/name hierarchies instead of full HTML—mirroring how the DevTools MCP server’s `take_snapshot` tool works today.  
  - If the accessibility domain is unavailable (some targets disable it), detect the error and fall back to DOM snapshots automatically.citechromedevtools.github.io/devtools-protocol/tot/Accessibility/?utm_source=openai

### 3. Selective Output Builders

- Extend `OutputBuilder.build` to honour new modes:  
  - `summary`: top-level metadata + network subset (matching filter) + console summary.  
  - `network-lite`: host- or MIME-filtered list, optional body truncation.
- Establish a new `SummaryBuilder` helper for reusable heuristics (e.g., extract form inputs, highlight APIs that returned JSON with consent).

### 4. Storage Strategy Enhancements

- Introduce `SessionWriter` interface with implementations:
  - `JsonWriter` (current behaviour),
  - `JsonLinesWriter` (append-only),
  - `SummaryWriter` (aggregated metrics only).
- Choose writer based on profile or new CLI flags.
- Allow compression toggles (`--gzip-output`) for large runs.

### 5. CDP-Assisted Filtering & Targeted Captures

Use DevTools Protocol commands to reduce incoming data:

| Goal | CDP Endpoint(s) | Usage Example |
| --- | --- | --- |
| Block unwanted requests | [`Network.setBlockedURLs`](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-setBlockedURLs?utm_source=openai), optional `Network.enable` with buffer limits | Block `*.svg`, analytics hosts, fonts for form inspections. |
| Limit body capture by size/MIME | [`Network.enable`](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-enable?utm_source=openai) with `maxTotalBufferSize`, `maxResourceBufferSize`; combine with `Network.responseReceived` filtering | Avoid grabbing huge binaries. |
| On-demand DOM snapshot | [`DOM.getDocument`](https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-getDocument?utm_source=openai), [`DOM.getOuterHTML`](https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-getOuterHTML?utm_source=openai), [`Page.captureSnapshot`](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureSnapshot?utm_source=openai) | Replace periodic DOM serialization with a single targeted call. |
| Targeted script evaluation | [`Runtime.evaluate`](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-evaluate?utm_source=openai) | Extract form metadata (“list supported inputs”) without storing full HTML. |
| Retrieve specific response bodies | [`Network.getResponseBody`](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-getResponseBody?utm_source=openai) | Grab e.g., `marketingChannels` JSON directly and skip full network dump. |
| Monitor + Replay | DevTools [Protocol Monitor](https://developer.chrome.com/docs/devtools/protocol-monitor?utm_source=openai) | Analysts discover relevant commands/filters and encode them into BDG profiles. |

### 6. CLI & UX Improvements

- New flags (examples):
  - `bdg summary <url> --network-include api.kingfisher.com --no-console`
  - `bdg dom <url> --snapshot-only`
  - `bdg capture <url> --profile network-lite --cdp-block '*.svg,*.png,*.woff2'`
- Provide `bdg profiles` command to list built-ins and load custom profiles.
- Update docs with quick recipes (e.g., “Capture consent API payload only”).

---

## Implementation Roadmap

### Phase 1 – Profile & Writer Plumbing

1. Extend CLI option parsing (`start.ts`) to accept `--profile`, `--full-write-interval`, `--no-full-writes`, `--network-include`, `--network-exclude`.
2. Update `startSession` signature to pass a `CaptureProfile` object containing collector set, preview options, CDP filters, writer config.
3. Modify `PreviewWriter` to respect new options (skip full writes, interval gating, manual flush).
4. Introduce `SessionWriter` abstraction and adapt `session.ts` functions to delegate to it.
5. Provide default profiles (`full`, `summary`, `dom-only`, `network-lite`) as code constants + optional JSON override file.

**Tests:**  
- Unit test `PreviewWriter` with various modes; ensure `flushFull()` obeys `fullWriteInterval`.  
- Unit test CLI parsing, verifying profile mapping.  
- Integration test (mock session) to confirm new writers produce expected outputs.

### Phase 2 – CDP Filtering Layer

1. Add a `CDPFilterManager` that, given profile filters, issues appropriate CDP commands after `TargetSetup`.  
2. Implement host/path blocking via `Network.setBlockedURLs`.  
3. Support request/response filtering in collectors by referencing active filters (to skip storing bodies).
4. Optionally expose `--cdp-script <file.ts>` to run extra `Runtime.evaluate` snippets (advanced users).

**Tests:**  
- Unit test filter manager (mock CDP connection).  
- Integration smoke test ensuring blocked URLs never show in captured network data.

### Phase 3 – Summary Builders & UX

1. Extend `OutputBuilder` + new `SummaryBuilder` to generate structured summaries (network endpoints, detected forms).  
2. Update CLI commands to surface summary files (e.g., `session.summary.json`).  
3. Document profiles and CDP features in `docs/` (this file) + CLI help text.  
4. Add `bdg profiles` command to list available profiles and example usage.

**Tests:**  
- Snapshot tests for summary output.  
- CLI acceptance tests covering new commands and help output.

### Phase 4 – Optional Enhancements

1. Add gzip compression toggle (`--gzip-output`).  
2. Persist profile-specific defaults (e.g., “always block analytics hosts”) in config file.  
3. Provide sample CDP scripts (DOM extraction, marketing consent fetch) under `examples/`.

---

## Example Workflows After Changes

| Command | Defaults | When to use | Why it’s optimal |
| --- | --- | --- | --- |
| `bdg capture <url>` | `--profile full`, all collectors, standard cadence | First run or exhaustive investigations. | Mirrors current behaviour so existing automations keep working. |
| `bdg summary <url>` | `--profile summary`, DOM + network, preview-only, no full writes | Quick reconnaissance focused on metadata & payloads. | Produces small artifacts and highlights targets for follow‑up full snapshots. |
| `bdg dom <url>` | `--profile dom-only`, preview disabled, `--semantic-snapshot` on, optional `--outer-html` | Form/structure audits (inputs, ARIA, headings). | Accessibility-first snapshot (roles, names) mirrors DevTools MCP `take_snapshot`; fall back to DOM only if needed.citedev.to/this-is-angular/chrome-devtools-mcp-server-guide-24faqiita.com/rakkyyy/items/2857d455e161ddd4d62f |
| `bdg network <url>` | `--profile network-lite`, network collector only, default CDP blocks for heavy assets, `--network-include` flag | API tracing and payload capture. | CDP filtering trims noise; writers emit JSON Lines for easy diffing. |
| `bdg console <url>` | `--profile summary`, console collector only, follow mode optional | Debugging client logs without touching network/DOM. | Minimal capture load; tail-friendly preview stream. |

**Design highlights**

- Profiles act as mental shortcuts; advanced users can still override (e.g., `bdg summary --full-write-interval 0`).
- Shared knobs (`--cdp-block`, `--network-include`, `--outer-html`, `--writer jsonl`, `--semantic-snapshot`) apply to every command, so agents can refine intent without memorising new verbs.
- Default `--auto-cleanup` ensures stale session files and Chrome PIDs are purged automatically.
- Every workflow produces smaller artifacts, fewer tokens, and faster turnaround without sacrificing insight.

---

## References

- [CDP `Network` domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/?utm_source=openai) – blocking URLs, sizing buffers, getting response bodies.
- [CDP `DOM` domain](https://chromedevtools.github.io/devtools-protocol/tot/DOM/?utm_source=openai) – retrieving specific DOM nodes or full HTML.
- [CDP `Page` domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/?utm_source=openai) – capturing snapshots.
- [CDP `Runtime` domain](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/?utm_source=openai) – executing scripts for targeted data extraction.
- [Protocol Monitor](https://developer.chrome.com/docs/devtools/protocol-monitor?utm_source=openai) – manual reconnaissance tool to discover useful commands.

---

## Next Steps

1. Socialize this plan with CLI, collector, and release owners; confirm profile names and defaults.
2. Schedule Phase 1 implementation (low-risk, mostly CLI + preview writer).  
3. Parallel research ticket: design the `CDPFilterManager` API and how it plugs into existing collectors.
4. Update CI smoke tests to run a `--profile summary` capture for regression coverage.
