# BDG & Chrome DevTools Protocol: Optimization Opportunities

This note captures concrete ways BDG can lean on the Chrome DevTools Protocol (CDP) to cut capture overhead, reduce noise, and surface richer metrics. Each section maps a pain point to specific CDP methods with references for future implementation.

---

## 1. Network Payload Trimming

| Goal | CDP Methods | Notes |
| --- | --- | --- |
| Block unwanted requests before they emit events | `Network.setBlockedURLs` | Accepts wildcard `urlPattern` entries (e.g., `*.png`, `*analytics*`). Wire to new `--network-exclude` / `--network-include` CLI flags so filtering happens in Chrome, not post-processing. citeturn0search0 |
| Limit Chrome’s in-memory buffering | `Network.enable` (`maxTotalBufferSize`, `maxResourceBufferSize`, `maxPostDataSize`) | Apply tighter caps when users opt into lean captures; prevents large responses from piling up. citeturn0search0 |
| Record transfer sizes for benchmarks | `Network.dataReceived`, `Network.loadingFinished` (`encodedDataLength`) | Feed benchmark reports with real byte counts instead of inferred file sizes. citeturn0search0 |

---

## 2. Selective Body Fetching

| Goal | CDP Methods | Notes |
| --- | --- | --- |
| Fetch JSON bodies only when needed | `Fetch.enable` with `RequestPattern` + `Fetch.getResponseBody` | Intercept targeted URLs (e.g., `/api/*`, `application/json`) and stream or skip bodies per wildcard patterns. Include override flag (`--fetch-all-bodies`) to bypass interception. citeturn0search1 |
| Redact or stub responses | `Fetch.fulfillRequest`, `Fetch.continueRequest` | Enables future features like response sanitization without re-plumbing collectors. citeturn0search1 |

---

## 3. DOM Snapshot Efficiency

| Goal | CDP Methods | Notes |
| --- | --- | --- |
| Capture lean DOM snapshots | `DOMSnapshot.captureSnapshot` with selective options (`computedStyles`, `includeDOMRects`, `includePaintOrder`, etc.) | Tailor snapshots to collector needs (e.g., forms-only mode skips layout data). citeturn0search2 |
| Targeted element extraction | `DOM.performSearch`, `DOM.getSearchResults`, `DOM.getOuterHTML` | Combine with new collector flags to pull only relevant nodes during live sessions. citeturn0search3 |

---

## 4. Session Lifecycle Control

| Goal | CDP Methods | Notes |
| --- | --- | --- |
| Short-circuit page loads | `Page.stopLoading` once key requests resolve | Useful for “DOM snapshot” or “API smoke test” profiles that don’t need full asset waterfalls. citeturn0search4 |
| Monitor target status precisely | `Target.setDiscoverTargets`, `Target.targetDestroyed` | Already in use; keep leveraging for fast teardown on tab close. |

---

## 5. Runtime & Performance Metrics

| Goal | CDP Methods | Notes |
| --- | --- | --- |
| Collect Chrome-side metrics for benchmarks | `Performance.getMetrics` | Capture CPU time, JS heap, etc., before/after each benchmark scenario. citeturn0search5 |
| Observe garbage collection impact | `Runtime.enable` + `Runtime.consoleAPICalled`/`Runtime.executionContextDestroyed` | Optional: correlate GC events with large captures for diagnostics. citeturn0search6 |

---

## 6. Implementation Hints

- **Wildcard support**: CDP’s `Network.setBlockedURLs` uses simple `urlPattern` wildcards. Mirror that semantics in our CLI and helper utilities to keep behavior predictable.
- **Fetch vs. Network domains**: For body interception, the Fetch domain offers finer control (pause, inspect, resume). Use it when we need verdicts before Chrome buffers data; stick to Network events for passive observation.
- **Benchmark instrumentation**: Add CDP metric collection to the planned benchmark harness (`scripts/benchmark.ts`) so each scenario logs both node-side PERF metrics and Chrome-provided stats.
- **Graceful fallback**: All optimizations should degrade to current behavior if CDP commands fail (e.g., older Chromium builds). Wrap calls in try/catch and emit diagnostic hints when a method isn’t available.

---

## References

- Chrome DevTools Protocol — Network Domain Overview. citeturn0search0
- Chrome DevTools Protocol — Fetch Domain. citeturn0search1
- Chrome DevTools Protocol — DOMSnapshot Domain. citeturn0search2
- Chrome DevTools Protocol — DOM Domain. citeturn0search3
- Chrome DevTools Protocol — Page Domain. citeturn0search4
- Chrome DevTools Protocol — Performance Domain. citeturn0search5
- Chrome DevTools Protocol — Runtime Domain. citeturn0search6
