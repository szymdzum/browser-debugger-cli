# DevTools Frontend Evaluation for bdg

Date: 2025-11-22
Status: Draft

**Repository:** https://github.com/ChromeDevTools/devtools-frontend

## Executive Summary

devtools-frontend is the official Chrome DevTools UI codebase – the actual implementation of the F12 tools. Unlike chrome-inspector (a lightweight library), this is the **production implementation** used by millions of developers daily. It contains battle-tested CDP integrations, sophisticated network analysis, performance profiling, and issue detection logic.

**Key Finding:** While the full frontend is a massive TypeScript web app (~150k+ LOC) designed for browser UI, specific **modules are extractable** and directly applicable to bdg's CLI use cases.

## Repository Structure

```
devtools-frontend/
├── front_end/
│   ├── core/
│   │   ├── sdk/          # CDP domain managers (DOMModel, CSSModel, NetworkManager)
│   │   ├── common/       # Utilities (Color, ResourceType, Throttler)
│   │   └── host/         # Platform abstractions
│   ├── models/
│   │   ├── har/          # HAR 1.2 export implementation ⭐⭐⭐⭐⭐
│   │   ├── issues_manager/  # Issue detection from CDP ⭐⭐⭐⭐
│   │   ├── logs/         # Console message formatting ⭐⭐⭐
│   │   ├── timeline/     # Performance trace parsing ⭐⭐⭐
│   │   └── source_map/   # Source map resolution ⭐⭐
│   ├── panels/
│   │   ├── network/      # Network panel logic
│   │   ├── timeline/     # Performance panel
│   │   └── elements/     # Elements panel
│   └── ui/
│       ├── components/   # Web Components (not applicable to CLI)
│       └── legacy/       # Legacy UI code
└── docs/
    └── architecture_of_devtools.md
```

**Architecture Principles:**
- **Lazy loading** - Features load on demand (not all at once)
- **Core-feature model** - Shared core + pluggable panels
- **SDK abstraction** - CDP wrapped in domain managers

---

## High-Value Extractable Components

### 1. HAR Export (`models/har/`) ⭐⭐⭐⭐⭐

**Location:** `front_end/models/har/HARFormat.ts`, `HARLog.ts`, `HARWriter.ts`

**What it does:**
- Converts CDP Network events → HAR 1.2 format
- Handles timing calculations (blocked, dns, connect, send, wait, receive)
- Includes request/response headers, cookies, postData
- Supports WebSocket messages (custom `_webSocketMessages` field)
- Proper base64 encoding for binary content

**HAR Specification:**
```json
{
  "log": {
    "version": "1.2",
    "creator": { "name": "bdg", "version": "0.6.6" },
    "browser": { "name": "Chrome", "version": "..." },
    "pages": [{
      "startedDateTime": "...",
      "id": "page_1",
      "title": "...",
      "pageTimings": { "onContentLoad": 1234, "onLoad": 5678 }
    }],
    "entries": [{
      "startedDateTime": "...",
      "time": 123.45,
      "request": { "method": "GET", "url": "...", "headers": [...] },
      "response": { "status": 200, "headers": [...], "content": {...} },
      "timings": { "blocked": 10, "dns": 20, "connect": 30, ... }
    }]
  }
}
```

**For bdg:**
- Already on roadmap: `bdg network har`
- Can extract ~500 lines of code
- Minimal dependencies (just CDP types)

**Implementation Path:**
1. Copy `HARFormat.ts` (type definitions)
2. Adapt `HARLog.ts` (entry builder)
3. Map bdg's network telemetry → HAR entries
4. Add filtering (by type, status, domain)

**Example:**
```bash
bdg network har output.har
bdg network har --filter "status>=400" errors.har
bdg network har --type XHR,Fetch api-calls.har
```

---

### 2. IssuesManager (`models/issues_manager/`) ⭐⭐⭐⭐

**Location:** `front_end/models/issues_manager/`

**What it does:**
- Subscribes to CDP `Audits.issueAdded` events
- Categorizes issues:
  - **Security:** Mixed content, CSP violations, insecure cookies
  - **Compatibility:** Deprecations, browser incompatibilities
  - **Performance:** Large images, render-blocking resources
  - **Accessibility:** Missing alt text, low contrast
  - **Network:** CORS errors, failed requests
- Provides actionable recommendations

**Issue Structure:**
```typescript
interface Issue {
  code: string;  // e.g., "MixedContentIssue", "CookieIssue"
  details: {
    request?: NetworkRequest;
    element?: DOMNode;
    // ... specific details
  };
  severity: "error" | "warning" | "info";
  message: string;
  recommendations: string[];
}
```

**For bdg:**
- New command: `bdg diagnose`
- Automatic problem detection from session
- Useful for agents ("What's wrong with this page?")

**Example:**
```bash
bdg diagnose
# Output:
# 🔴 Security Issues (2)
#   - Mixed content on https://example.com/page
#   - Cookie without Secure flag: session_id
# 
# ⚠️  Compatibility Warnings (1)
#   - Deprecated API: document.write()
```

---

### 3. Network Filtering Logic (`panels/network/`) ⭐⭐⭐⭐

**Location:** `front_end/panels/network/NetworkDataGridNode.ts`, `NetworkLogView.ts`

**What it does:**
- Advanced filtering DSL:
  - `domain:example.com` - Filter by domain
  - `status-code:404` - By status
  - `mime-type:image/*` - By MIME
  - `larger-than:1M` - By size
  - `has-response-header:set-cookie` - By headers
  - `-is:from-cache` - Exclude cached
- Combines filters with AND/OR logic
- Pre-defined filter presets (All, XHR, JS, CSS, Img, etc.)

**For bdg:**
- Enhance `bdg peek --filter` with DevTools-compatible syntax
- Support complex queries: `bdg peek --filter "domain:api.* AND status-code:>=400"`

**Example:**
```bash
bdg peek --filter "mime-type:application/json AND larger-than:100KB"
bdg peek --filter "has-response-header:cache-control AND -is:from-cache"
```

---

### 4. Performance Trace Parsing (`models/timeline/`) ⭐⭐⭐

**Location:** `front_end/models/timeline/TimelineModel.ts`

**What it does:**
- Parses `Tracing.dataCollected` events
- Extracts key metrics:
  - **Core Web Vitals:** LCP, CLS, INP, FCP, TTFB
  - **Frame rate:** Dropped frames, jank detection
  - **Main thread work:** Long tasks, script eval time
  - **Network waterfall:** Request priorities, critical path
- Flame chart data structures

**For bdg agents:**
- Analyze performance traces programmatically
- Detect performance regressions
- Generate LLM-friendly summaries

**Example:**
```bash
bdg perf trace --duration 10s trace.json
bdg perf vitals trace.json
# Output:
# LCP: 2.3s (good)
# CLS: 0.15 (needs improvement)
# INP: 450ms (poor)
```

---

### 5. Console Message Formatting (`models/logs/`) ⭐⭐⭐

**Location:** `front_end/models/logs/LogModel.ts`

**What it does:**
- Formats console messages with:
  - Source location (file:line:column)
  - Stack traces (clickable in DevTools)
  - Object expansion (nested properties)
  - ANSI color codes
- Groups related messages
- Filters by level (verbose, info, warning, error)

**For bdg:**
- Improve `bdg tail --console` output
- Add source mapping support
- Better error formatting

**Example:**
```bash
bdg tail --console --source-maps
# Output:
# [Error] TypeError: Cannot read property 'foo' of undefined
#   at getUserData (app.ts:42:15)
#   at handleRequest (api.ts:123:8)
```

---

### 6. Source Map Resolution (`models/source_map/`) ⭐⭐

**Location:** `front_end/models/source_map_scopes/`

**What it does:**
- Fetches source maps from `//# sourceMappingURL=...`
- Maps compiled → original locations
- Resolves scope chains for debugging

**For bdg:**
- Map minified errors back to source
- `bdg trace <stack-trace>` command
- Better error reporting

---

### 7. Core Utilities (`core/common/`) ⭐⭐⭐

**Useful utilities:**

**Color.ts**
- Parse CSS colors (hex, rgb, hsl, named)
- Convert between formats
- WCAG contrast calculations

**ResourceType.ts**
- MIME type → resource type mapping
- Categories: Document, Stylesheet, Image, Script, XHR, Font, Media, Manifest, WebSocket, Other

**Throttler.ts**
- Debounce/throttle for rate-limiting
- Useful for high-frequency CDP events

**SegmentedRange.ts**
- Time range manipulation for waterfall charts

---

## What's NOT Useful for bdg

### ❌ UI Components
- `ui/components/` - Web Components for rendering
- `ui/legacy/` - Legacy Polymer components
- Panel-specific UI logic

### ❌ Build System
- GN/Ninja build (Chromium-specific)
- GRIT resource bundling
- Not applicable to npm/TypeScript setup

### ❌ High-Level Panels
- `panels/elements/`, `panels/sources/` - Tied to DOM rendering
- bdg needs CLI equivalents, not direct ports

---

## Integration Strategies

### Strategy A: Direct Extraction ⭐⭐⭐⭐⭐

**Best for:** Self-contained modules with minimal dependencies.

**Candidates:**
1. **HAR Export** - `models/har/`
2. **ResourceType** - `core/common/ResourceType.ts`
3. **Color** - `core/common/Color.ts`

**Process:**
1. Copy source files
2. Remove browser-specific APIs (replace with Node.js equivalents)
3. Add to bdg as `src/export/har.ts`, `src/utils/resourceType.ts`
4. Write tests

**Effort:** Low (1–2 days per module)

---

### Strategy B: Reference Implementation ⭐⭐⭐⭐

**Best for:** Complex modules where logic is more valuable than code.

**Candidates:**
1. **IssuesManager** - Use as reference for `bdg diagnose`
2. **Network filtering** - Adapt DSL syntax
3. **Performance parsing** - Learn metric extraction patterns

**Process:**
1. Study implementation in devtools-frontend
2. Design bdg-specific API
3. Implement from scratch, informed by patterns
4. Document compatibility where applicable

**Effort:** Medium (1 week per feature)

---

### Strategy C: SDK Wrapper Extraction ⭐⭐⭐

**Best for:** Long-term ecosystem benefit.

**Candidates:**
- `core/sdk/DOMModel.ts`
- `core/sdk/CSSModel.ts`
- `core/sdk/NetworkManager.ts`

**Vision:**
- Extract as standalone `@devtools/sdk` package
- Maintain compatibility with devtools-frontend
- Benefits bdg + wider community

**Challenges:**
- High maintenance burden
- Tight coupling to Chromium build system
- Requires coordination with Chrome team

**Effort:** High (months, potentially community project)

---

## Immediate Action Items for bdg

### Priority 1: HAR Export (1 week)

**Goal:** `bdg network har` command with filtering

**Steps:**
1. Create `src/export/har.ts`
2. Copy HAR type definitions from devtools-frontend
3. Map bdg's network telemetry → HAR entries
4. Add CLI command with filters
5. Test against real sites
6. Document HAR 1.2 compliance

**Deliverable:**
```bash
bdg network har output.har
bdg network har --filter "type:XHR,Fetch" api.har
bdg network har --filter "status:>=400" errors.har
```

---

### Priority 2: Issue Detection (2 weeks)

**Goal:** `bdg diagnose` command

**Steps:**
1. Enable `Audits.enable` in CDP
2. Subscribe to `Audits.issueAdded`
3. Categorize issues (security, compat, performance, a11y)
4. Format for CLI output
5. Add to telemetry collection

**Deliverable:**
```bash
bdg diagnose
bdg diagnose --json  # For agents
bdg diagnose --category security,performance
```

---

### Priority 3: Advanced Network Filtering (1 week)

**Goal:** DevTools-compatible filter syntax

**Steps:**
1. Study `NetworkLogView.ts` filter parser
2. Implement DSL: `domain:`, `type:`, `status-code:`, `larger-than:`, etc.
3. Update `bdg peek --filter` to support new syntax
4. Add presets (XHR, Errors, Large, Slow)

**Deliverable:**
```bash
bdg peek --filter "domain:api.* AND status-code:>=400"
bdg peek --preset errors
```

---

## Long-Term Opportunities

### Performance Analysis
- Extract LCP/CLS/INP calculation from timeline model
- `bdg perf vitals` command
- Performance regression detection for CI/CD

### Source Mapping
- Resolve minified errors to source
- `bdg trace <error>` command
- Better debugging for production issues

### Advanced Console
- Format console messages with source locations
- Stack trace resolution
- Object expansion for structured data

---

## Licensing & Attribution

**DevTools Frontend License:** BSD-3-Clause

**Key Points:**
- Permissive license (allows reuse)
- Requires attribution in source
- Must include copyright notice

**For bdg:**
- Add LICENSE notice in copied files
- Credit devtools-frontend in docs
- Link to original source

**Example Header:**
```typescript
// Adapted from Chrome DevTools Frontend
// https://github.com/ChromeDevTools/devtools-frontend
// Original license: BSD-3-Clause
```

---

## Open Questions

1. **Maintenance:** How do we track upstream changes in devtools-frontend?
2. **Versioning:** Should we vendor code or track as dependency?
3. **Testing:** Can we reuse devtools-frontend test fixtures?
4. **Collaboration:** Is Chrome team open to extracting shared modules?

---

## References

- [DevTools Frontend Architecture](https://github.com/ChromeDevTools/devtools-frontend/blob/main/docs/architecture_of_devtools.md)
- [HAR 1.2 Spec](http://www.softwareishard.com/blog/har-12-spec/)
- [CDP Audits Domain](https://chromedevtools.github.io/devtools-protocol/tot/Audits/)
- [Web Vitals](https://web.dev/vitals/)

---

## Comparison: chrome-inspector vs devtools-frontend

| Aspect | chrome-inspector | devtools-frontend |
|--------|------------------|-------------------|
| **Size** | ~10k LOC | ~150k+ LOC |
| **Scope** | DOM mirroring + styles | Full DevTools UI |
| **Dependencies** | JSDOM, @devtoolcss/parser | Massive (GN build) |
| **Best for** | DOM-heavy automation | Extracting specific features |
| **Integration** | Add as dependency | Copy/adapt modules |
| **Maintenance** | Stable, small API | Tracks Chrome releases |

**Recommendation:**
- Use **chrome-inspector** for DOM mirroring (when needed)
- Use **devtools-frontend** for feature extraction (HAR, issues, perf)
- Both complement bdg's raw CDP foundation
