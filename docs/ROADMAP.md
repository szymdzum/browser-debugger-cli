# Roadmap: browser-debugger-cli

**Last Updated**: 2025-11-06  
**Current Version**: 0.2.0  
**Status**: In active development

---

## Vision & Philosophy

### Goal
Make Chrome DevTools Protocol accessible from the terminal to two audiences with one tool:
- **AI agents first**: Predictable, structured, composable CLI that exposes raw CDP and thin wrappers for common multi-step flows
- **Human developers next**: Ergonomic, visual, and accessible wrappers that make debugging faster without becoming another automation framework

### Core Principles

1. **Lightweight, not a replacement**: Build only what delivers clear value. This is not Puppeteer, Playwright, or Selenium.
2. **Two-layer architecture**: 
   - ✅ Layer 1: Raw CDP access (complete via `bdg cdp`)
   - 🚧 Layer 2: Human-friendly wrappers (selective, need-driven)
3. **Domain order**: DOM → Network → Console → Performance/Profiling
4. **Design constraints**:
   - Non-interactive by default (agents can't respond to prompts)
   - JSON-first output with stable, versioned schemas
   - Semantic exit codes (80-89 user errors, 90-99 resource errors, 100-109 integration errors, 110-119 internal errors)
   - Unix composability (pipe to `jq`, `grep`, `awk`)
   - Small, focused commands that do one thing well
5. **Audience balance**:
   - **Agents**: Use raw CDP for backend/internal operations; get thin wrappers for multi-step workflows
   - **Humans**: Get wrappers for visual feedback, accessibility inspection, and common debugging patterns

### What We Won't Build

- ❌ Full automation primitives (click/type/retry flows)
- ❌ Interactive TUI or GUI
- ❌ Test runner or assertion framework
- ❌ Deep recording or codegen
- ✅ Focus: Debugging, inspection, and telemetry capture

---

## Milestones & Release Phases

### M1: Agents Foundation - Documentation & Stateful Wrappers (Weeks 1–4)
**Target**: v0.4.0

**Philosophy**: Agents can already use raw `bdg cdp` for most operations. Focus on documentation and only build wrappers for stateful/complex operations.

**Deliverables**:
- **Documentation**: `docs/AGENT_WORKFLOWS.md` with 10+ CDP patterns (queries, navigation, error handling)
- **Output schema v0**: Finalized and implemented across all commands
- **Stateful wrappers only**:
  - `dom.wait` - Polling loop with timeout (agents shouldn't reimplement this)
  - `page.screenshot` - Screenshot with file I/O and optional overlays
- **Example scripts**: 5 battle-tested agent scripts in `examples/agents/` showing CDP composition patterns

**Success Criteria**:
- [ ] Documentation shows how to use raw CDP for 10+ common patterns
- [ ] Can automate 3 common agent tasks using raw CDP + stateful wrappers
- [ ] All commands follow schema v0 and semantic exit codes
- [ ] CI runs examples against real pages (example.com, github.com, wikipedia.org)

---

### M2: Network Foundation - Stateful Wrappers & CDP Patterns (Weeks 3–8)
**Target**: v0.5.0

**Philosophy**: Most network operations work via raw CDP. Only wrap stateful operations (streaming, HAR transformation).

**Deliverables**:
- **Stateful wrappers**:
  - `net.capture start|stop --file <out.ndjson>` - Event streaming with lifecycle management
  - `net.har --out <file.har>` - Transform captured events to HAR format (complex transformation)
- **CDP documentation patterns**: Cache control, throttling, request blocking using raw CDP
- **Example scripts**: Network capture, filtering, HAR export workflows

**Success Criteria**:
- [ ] Capture and export HAR for a live page using `net.capture` + `net.har`
- [ ] Documentation shows how to disable cache, throttle network, block URLs using raw CDP
- [ ] Examples demonstrate filtering captured requests with `jq`

---

### M3: Humans DOM Beta (Weeks 6–12)
**Target**: v0.6.0

**Deliverables**:
- Human-friendly commands: `dom.inspect`, `dom.report`, `overlay.grid`
- Visual overlays for debugging (box model, grid, flex)
- Accessibility quick checks (`dom.a11y`)
- Element reports with annotated screenshots

**Success Criteria**:
- [ ] A human can visually debug a page via CLI-only workflows
- [ ] Generate portable reports (JSON + markdown + screenshots)
- [ ] Consistent flags and help across all commands
- [ ] Clear error messages with suggestions

---

### M4: Community Preview (End of Month 3)
**Target**: v0.7.0

**Deliverables**:
- Documentation site (Docusaurus or mkdocs)
- Contributor guide (`CONTRIBUTING.md`)
- Architecture overview (`docs/ARCHITECTURE.md`)
- Blog post and Reddit announcement

**Success Criteria**:
- [ ] 3+ external users create issues or PRs
- [ ] Feedback loop established (Discord/Discussions)
- [ ] 8+ runnable examples with CI verification

---

### M5: Human-Layer DOM Complete (Months 4–6)
**Target**: v0.8.0

**Deliverables**:
- Deep accessibility inspection (ARIA hints, contrast checks)
- Layout diagnostics (visual diff of elements across states)
- Element change watchers

**Success Criteria**:
- [ ] A11y workflows used in real projects and documented
- [ ] Layout debugging scenarios covered with examples

---

### M6: Network Pro (Months 5–8)
**Target**: v0.9.0

**Deliverables**:
- Request replay (`net.replay`)
- URL pattern blocking (`net.block`, `net.unblock`)
- Offline mode (`net.offline`)
- Timing analysis UX (`net.show --waterfall`)

**Success Criteria**:
- [ ] Diagnose and reproduce a failing request from a HAR using CLI
- [ ] Block tracking domains during debugging

---

### M7: Console and Diagnostics (Months 6–9)
**Target**: v1.0.0-rc.1

**Deliverables**:
- Console filtering and tailing (`console.tail`)
- Error tracing (`console.errors`)
- Logpoint injection (`console.inject`)
- Log/request correlation

**Success Criteria**:
- [ ] Tail and filter console reliably
- [ ] Correlate logs with network requests
- [ ] Exception summaries with stack traces

---

### M8: Performance and Profiling (Months 7–10)
**Target**: v1.1.0

**Deliverables**:
- Tracing capture (`perf.trace`)
- Filmstrip extraction (`perf.filmstrip`)
- Layout shift overlays (`perf.layout-shifts`)
- Basic CPU and memory sampling

**Success Criteria**:
- [ ] Produce a performance trace and human-readable summary
- [ ] Visualize Core Web Vitals

---

### M9: 1.0 Hardening (Months 9–12)
**Target**: v1.0.0

**Deliverables**:
- Schema v1.0 (stable, backward-compatible)
- Deprecation policy and notes
- Plugin hooks for community wrappers
- Monthly release cadence

**Success Criteria**:
- [ ] Backward-compatible stable public interface
- [ ] Plugin system with 1+ community plugins
- [ ] 100+ GitHub stars, 10+ contributors

---

## Short-Term Roadmap (1–3 Months)

### A. Output Schema and CLI Foundations

**Tasks**:
- Define JSON envelope v0: `{version, status, command, request, data, meta, errors[]}`
- Add global flags: `--json`, `--ndjson`, `--quiet`, `--timeout`, `--schema-version`
- Implement contract tests for output stability and exit codes

**Acceptance**:
- [ ] All existing commands respect flags and return stable schema
- [ ] Contract tests validate JSON shape with golden files
- [ ] `docs/SCHEMA.md` documents envelope and per-command data shapes

---

### B. Agent Workflow Documentation

**Tasks**:
- Write `docs/AGENT_WORKFLOWS.md`: connect, select, evaluate, listen to events, stream outputs, retry patterns
- Update `docs/CDP_METHOD_EXPOSURE.md` with wrapper conventions and examples
- Add 10 runnable snippets in bash/node/python using `bdg`

**Acceptance**:
- [ ] 10 runnable snippets pass CI
- [ ] Documentation covers error handling and retry strategies
- [ ] Examples demonstrate composability with `jq`, `grep`, `curl`

---

### C. Agent-Focused Patterns and Stateful Wrappers

**Philosophy**: Agents can use raw `bdg cdp` for most operations. Only add wrappers when:
1. **Stateful operations** (polling, streaming, file I/O)
2. **Complex transformations** (HAR format, multi-step workflows)
3. **Validated by actual usage** (add convenience wrappers only when agents consistently struggle)

#### Stateful Wrappers (High Value)
- `dom.wait --selector <sel> --state <attached|visible|hidden> [--timeout 5000]` - Polling loop with timeout
- `page.screenshot [--selector] [--full] [--out file.png]` - Screenshot with file handling

#### Documentation Patterns (Show, Don't Wrap)
Document how agents should use raw CDP for:
- **Element queries**: `bdg cdp Runtime.evaluate --params '{"expression": "document.querySelector(...)", "returnByValue": true}'`
- **Getting properties**: `bdg cdp Runtime.evaluate --params '{"expression": "document.querySelector(...).innerText"}'`
- **Bounding boxes**: `bdg cdp Runtime.evaluate --params '{"expression": "document.querySelector(...).getBoundingClientRect()"}'`
- **Target management**: `bdg cdp Target.getTargets`, `bdg cdp Target.attachToTarget`
- **Navigation**: `bdg cdp Page.navigate`, `bdg cdp Page.reload`

#### Examples with Error Handling
Provide battle-tested scripts in `examples/agents/`:
1. `wait-for-element.sh` - Polling pattern with timeout
2. `extract-element-data.sh` - Query → extract properties → format JSON
3. `safe-navigation.sh` - Navigate with retry and timeout

**Acceptance**:
- [ ] Documentation shows 10+ common patterns with raw CDP
- [ ] Each pattern includes error handling and retry logic
- [ ] Example scripts pass CI against real pages
- [ ] Stateful wrappers (`dom.wait`, `page.screenshot`) work reliably

---

### D. Network Foundation

**Target Commands**:
- `net.enable` - Enable network tracking
- `net.disable` - Disable network tracking
- `net.capture start|stop --file <out.ndjson>` - Stream network events to file
- `net.ls [--filter <pattern>]` - List captured requests with filters
- `net.har --out <file.har>` - Export as HAR file
- `net.cache --disable|--enable` - Control cache behavior
- `net.clear-cache` - Clear browser cache
- `net.throttle <preset|custom>` - Apply network throttling (slow-3g, fast-3g, offline)
- `net.block --url-pattern <pattern>` - Block requests matching pattern
- `net.unblock --url-pattern <pattern>` - Unblock requests

**Acceptance**:
- [ ] Capture and export HAR for a simple site
- [ ] Filters work (`status:>=400`, `domain:api.example.com`, `method:POST`)
- [ ] Cache disable reflected in request headers (`Cache-Control: no-cache`)
- [ ] Throttling visible in timing data

---

### E. Human-Friendly DOM Beta Commands

**Target Commands**:
- `dom.inspect --selector <sel>` - Returns structured summary (html, text, box, computed a11y, screenshot path)
- `dom.report --selector <sel> --out <report.json|md>` - Bundles summary and saves annotated screenshot
- `overlay.grid --selector <sel>|--all` - Visualize CSS grid/flex overlays in screenshots

**Acceptance**:
- [ ] Reports render correctly on two diverse sites
- [ ] Deterministic outputs (hashed screenshots, stable JSON ordering)
- [ ] Markdown reports are human-readable with embedded images

---

### F. Examples and Demos

**Agent Examples** (`examples/agents/`):
1. `dom-scrape.sh` - Extract structured data from a page
2. `a11y-audit.sh` - Audit accessibility of key elements
3. `network-capture.sh` - Capture and filter network requests
4. `error-tailing.sh` - Stream console errors to file
5. `screenshot-with-overlay.sh` - Annotated screenshot of error elements

**Human Examples** (`examples/humans/`):
1. `element-report.sh` - Generate visual report for debugging
2. `layout-overlay.sh` - Visualize grid/flex layouts
3. `a11y-quick-check.sh` - Quick accessibility scan

**Acceptance**:
- [ ] CI runs examples headlessly and validates outputs
- [ ] Each example includes README with use case and expected output

---

### G. Docs and Site

**Tasks**:
- Update `docs/CLI_REFERENCE.md` with all new commands
- Create `docs/SCHEMA.md` - JSON envelope and data shapes
- Create `docs/HUMAN_GUIDE.md` - Human-friendly walkthrough
- Create `docs/AGENT_WORKFLOWS.md` - Agent patterns and recipes
- Set up minimal docs site (Docusaurus or mkdocs)

**Acceptance**:
- [ ] Searchable docs with copy-pastable commands
- [ ] Consistent examples across all docs
- [ ] Cross-references between agent/human guides and CLI reference

---

### H. Release and Support

**Version Tags**:
- v0.4 - Agents DOM Core
- v0.5 - Network Foundation
- v0.6 - Humans DOM Beta

**Issue Management**:
- Labels: `dom`, `net`, `console`, `perf`, `docs`, `bug`, `wrapper`, `agent`, `human`
- Milestones: Align with release phases
- Project board: Kanban with "Ready", "In Progress", "Review", "Done"

---

## Long-Term Roadmap (6–12 Months)

### Human-Friendly Layer Expansion

**DOM Enhancements**:
- Deep a11y inspection (ARIA hints, role hierarchy)
- Layout diagnostics (computed styles, box model visualization)
- Element change watchers (monitor DOM mutations)
- Visual diff of elements across states (before/after screenshot comparison)

**Network Enhancements**:
- Request replay with parameter overrides
- Route mocking and blocklists (local dev workflows)
- Timing visualization reports (waterfall charts as HTML)

**Console Enhancements**:
- Log tail with selector-based filtering
- Exception correlation with network requests
- Logpoint injection and removal (temporary debug logs)

---

### Diagnostics and Performance

**Tracing**:
- Capture with presets (page load, user flow)
- CPU and memory sampling
- Layout shift overlays (visual markers on screenshots)
- Filmstrip extraction (frame-by-frame page load)

**Metrics**:
- Core Web Vitals summary (LCP, FID, CLS)
- Resource timing breakdowns
- Main thread blocking time

---

### Ecosystem and Packaging

**Plugin System**:
- `bdg plugin install <name>` - Install community plugins
- Plugin hooks for custom wrappers and formatters
- Sample plugin: `bdg-a11y` (extends reports with WCAG rules)

**Distribution**:
- Prebuilt binaries for macOS, Linux, Windows
- Homebrew tap: `brew install szymdzum/tap/bdg`
- NPM distribution: `npm install -g browser-debugger-cli`

---

### Documentation and Education

**Cookbook**:
- 25+ recipes split by agents vs humans
- Common debugging scenarios (401s, CORS, slow requests, DOM errors)

**Tutorial Series**:
- DOM Day 1: Query, inspect, report
- Network Day 2: Capture, filter, HAR export
- Console Day 3: Tail, correlate, inject logs

**Troubleshooting Guides**:
- Common CDP pitfalls (target not found, session timeout)
- Chrome version compatibility matrix
- Performance optimization tips

---

### Community Growth

**Contributor Onboarding**:
- `CONTRIBUTING.md` - How to add a wrapper command
- `CODE_OF_CONDUCT.md` - Expected behavior
- Architecture diagram (daemon, IPC, CDP, worker)
- Good first issues labeled per domain

**RFC Process**:
- Quarterly roadmapping with public RFCs
- Template: `docs/rfcs/TEMPLATE.md`
- Community voting on priorities

**Promotion**:
- Blog posts and screencasts
- Conference talks (JSConf, Web Directions)
- Integration with popular tools (Warp AI, Cursor)

---

## Domain Expansion Plans

### DOM Domain

**Current State** (v0.2.0):
- ✅ `dom.query` - Find elements by CSS selector
- ✅ `dom.eval` - Execute JavaScript in page context
- ✅ `dom.highlight` - Highlight elements with visual overlay
- ✅ `dom.get` - Get full HTML and attributes

**What Agents Actually Need**:
- ✅ Raw CDP access (already have via `bdg cdp`)
- ✅ Wait conditions wrapper (`dom.wait`) - polling logic is complex
- 📝 Documentation showing CDP patterns for common queries
- 📝 Example scripts with error handling and retry logic

**Gaps for Humans**:
- Visual overlays (box, grid, flex, accessibility)
- Element report (combine facts with annotated screenshot)
- Accessibility (accessible name, role, missing ARIA, contrast checks)
- Debugging manipulation (scrollIntoView, focus, toggle classes)

**Proposed Wrappers and Patterns**:
```bash
# Stateful Wrappers (build these)
bdg dom.wait --selector ".button" --state visible --timeout 5000
bdg page.screenshot --selector ".error" --out debug.png

# Raw CDP Patterns (document these)
bdg cdp Runtime.evaluate --params '{"expression": "document.querySelector(\".error\").outerHTML", "returnByValue": true}'
bdg cdp Runtime.evaluate --params '{"expression": "document.querySelector(\".error\").innerText", "returnByValue": true}'
bdg cdp Runtime.evaluate --params '{"expression": "document.querySelector(\".error\").getBoundingClientRect()", "returnByValue": true}'

# Human Commands (visual value)
bdg dom.inspect ".error"
bdg dom.report ".error" --out error-report.md
bdg overlay.highlight ".error" --color red
bdg overlay.grid ".container"
```

**Priority Order**:
1. P1: `dom.wait` + documentation patterns (unblocks agent workflows)
2. P2: `dom.inspect`, `dom.report`, `overlay.grid` (strong visual feedback for humans)
3. P3: Convenience wrappers only if agents struggle with raw CDP (validate first)

---

### Network Domain

**Current State** (v0.2.0):
- ✅ `network.getCookies` - List cookies from current page

**What Agents Actually Need**:
- ✅ Event streaming wrapper (`net.capture`) - stateful, needs lifecycle
- ✅ HAR export wrapper (`net.har`) - complex transformation
- 📝 Documentation for cache/throttle using raw CDP
- 📝 Example scripts showing request filtering patterns

**Gaps for Humans**:
- Request listing with grouping (by domain, status)
- Detailed request inspection (headers, payload preview, timing waterfall)
- HAR export for external tools
- Request replay to isolate issues
- Block patterns (tracking, ads, analytics)

**Proposed Wrappers and Patterns**:
```bash
# Stateful Wrappers (build these)
bdg net.capture start --file requests.ndjson  # Event streaming
bdg net.capture stop
bdg net.har --out capture.har  # Complex transformation

# Raw CDP Patterns (document these)
bdg cdp Network.enable
bdg cdp Network.setCacheDisabled --params '{"cacheDisabled": true}'
bdg cdp Network.clearBrowserCache
bdg cdp Network.emulateNetworkConditions --params '{"offline": false, "latency": 100, "downloadThroughput": 750000, "uploadThroughput": 250000}'
bdg cdp Network.setBlockedURLs --params '{"urls": ["*analytics*"]}'

# Human Commands (visual value)
bdg net.ls --group-by domain
bdg net.show --id req_123 --waterfall
```

**Priority Order**:
1. P1: `net.capture`, `net.har` + CDP documentation (unblocks workflows)
2. P2: `net.ls`, `net.show` (human-friendly inspection)
3. P3: Advanced features only if validated by usage

---

### Console Domain

**Current State** (v0.2.0):
- ✅ Basic console message capture and display

**What Agents Actually Need**:
- ✅ Event streaming wrapper (`console.tail`) - stateful operation
- 📝 Documentation for filtering using raw CDP
- 📝 Example scripts for exception handling

**Gaps for Humans**:
- Tail and grep-style filters
- Level selection (info, warn, error)
- Structured export
- Exception summaries with source snippets

**Proposed Wrappers and Patterns**:
```bash
# Stateful Wrappers (build these)
bdg console.tail --levels error,warn --filter "text:token" --ndjson

# Raw CDP Patterns (document these)
bdg cdp Runtime.enable
bdg cdp Log.enable
# Then listen to Console.messageAdded events

# Human Commands (visual value)
bdg console.stats --since 5m
bdg console.errors --group-by type
```

**Priority Order**:
1. P1: `console.tail` + CDP documentation (unblocks monitoring)
2. P2: `console.stats`, `console.errors` (human diagnostics)
3. P3: Advanced features only if validated

---

## Decision Frameworks

### When to Create a Human-Friendly Wrapper

✅ **Create a wrapper if**:
- High-friction multi-step CDP flow (e.g., wait → query → extract → format)
- Visual or accessibility value that raw JSON cannot convey
- Frequent task across users or domains (validated by issues or examples)
- Safety and correctness benefits vs manual composition

❌ **Point to `bdg cdp` if**:
- Rarely used CDP methods
- Low-level tuning or non-visual backend domains
- Primarily useful to agents where composition is straightforward

---

### Prioritization Heuristic

**P1 (Highest)**: Unblocks agent workflows OR delivers strong visual feedback for humans
- Examples: `dom.wait`, `dom.inspect`, `net.capture`, `net.har`

**P2 (Medium)**: Common debugging diagnostics with broad applicability
- Examples: `net.show`, `console.tail`, `dom.a11y`

**P3 (Low)**: Nice-to-have or niche; defer until requested by multiple users
- Examples: `net.replay`, `console.inject`, advanced profiling

---

### Lightweight Guardrails (What NOT to Build)

❌ **No full automation primitives**:
- No `dom.click`, `dom.type`, `dom.submit`
- No retry/wait loops with complex conditions
- Not competing with Puppeteer/Playwright

❌ **No interactive TUI or GUI**:
- CLI only, pipe-friendly output
- Visual feedback via screenshots and overlays, not live interfaces

❌ **No test runner or assertion framework**:
- Not building `bdg test` or `bdg assert`
- Users integrate with existing test runners

❌ **No deep recording or codegen**:
- No `bdg record` that generates scripts
- Focus on debugging and inspection, not automation scaffolding

---

## Success Metrics and Measurement

### Adoption Metrics
- **Monthly active sessions**: Track unique users running `bdg` commands
- **Ratio of `bdg cdp` vs wrappers**: Measure wrapper value (target: 30% wrappers by M4)
- **Example workflows executed in CI**: Validates real-world utility

### Reliability and Performance
- **Command success rate**: Target 95%+ across all commands
- **Median runtime**: Keep commands under 2s for typical operations
- **Flake rate across top 10 sites**: Target <5% flakiness

### Quality and Documentation
- **Doc task completion test pass rate**: Can users complete tasks from docs alone?
- **Time to upgrade between minor versions**: Target <5min without breakage

### Community Engagement
- **External issues and PRs per month**: Target 5 issues, 1 PR by M4
- **Average time to first response on issues**: Target <48 hours

### Targets by M4 (End of Month 3)
- [ ] 5 example workflows run green in CI on main
- [ ] 90% command success across smoke sites (example.com, github.com, wikipedia.org)
- [ ] 5 external issues and 1 PR merged
- [ ] 3+ blog posts or screencasts published

---

## Operating Model

### Release Cadence
- **Fortnightly releases** with `CHANGELOG.md` and upgrade notes
- Domains labeled: `dom`, `net`, `console`, `perf`
- WIP wrappers protected behind feature flags if needed (e.g., `BDG_ENABLE_REPLAY=1`)

---

### Schema Management
- **`docs/SCHEMA.md`** defines envelope, per-command data shapes, and versioning
- `--schema-version` flag for negotiation
- **Deprecation policy**: 3 months notice, sunset dates in CHANGELOG
- **Contract tests** lock JSON shape with golden files

---

### Testing Strategy
- **CI runs Chrome stable and beta**: Catch regressions early
- **Smoke tests against real public pages**: example.com, github.com, wikipedia.org, news.ycombinator.com
- **Deterministic outputs**: Timeouts and retry caps to reduce flakiness
- **Golden screenshot tests**: Fuzzy image diff tolerance for overlays

---

### Repository Organization

**Source Code**:
- `src/ipc/commands.ts` - Registry and naming conventions (namespaces: `dom`, `net`, `console`, `page`, `target`, `perf`)
- `src/commands/` - Command implementations grouped by domain
- `src/telemetry/` - Telemetry collectors (network, console, dom)

**Documentation**:
- `docs/agents/` - How-to guides and patterns for AI agents
- `docs/humans/` - User guides with visual walkthroughs
- `docs/reference/` - CLI reference and schema definitions
- `docs/rfcs/` - RFCs for major features

**Examples**:
- `examples/agents/` - Agent scripts (bash, node, python)
- `examples/humans/` - Human workflows (bash scripts with screenshots)

---

## Next Steps

1. **Review and refine this roadmap** with stakeholders
2. **Create GitHub Project board** with milestones
3. **Start M1: Agents DOM Core** (output schema + agent commands)
4. **Document decision-making** in `docs/rfcs/` for controversial choices
5. **Set up CI pipeline** for example workflows

---

## References

- [CDP Method Exposure Design](./CDP_METHOD_EXPOSURE.md)
- [Agent-Friendly CLI Principles](./AGENT_FRIENDLY_TOOLS.md)
- [CLI Reference](./CLI_REFERENCE.md)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)

---

**Feedback?** Open an issue or discussion on GitHub!
