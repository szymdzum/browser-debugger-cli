# Roadmap Overview

**Last Updated**: 2025-11-06  
**Current Version**: 0.2.0  
**Status**: In active development

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

## Milestone Overview

The roadmap is organized into phases, with each milestone documented in detail:

### Near-Term (Months 1-3)
- **[01_AGENTS_FOUNDATION.md](01_AGENTS_FOUNDATION.md)** - M1: Documentation & stateful wrappers (Weeks 0-4)
- **[02_NETWORK_FOUNDATION.md](02_NETWORK_FOUNDATION.md)** - M2: Network capture & CDP patterns (Weeks 3-8)
- **[03_HUMANS_DOM_BETA.md](03_HUMANS_DOM_BETA.md)** - M3: Human-friendly DOM commands (Weeks 6-12)
- **[04_COMMUNITY_PREVIEW.md](04_COMMUNITY_PREVIEW.md)** - M4: Community release (End of Month 3)

### Long-Term (Months 4-12)
- **[05_LONG_TERM.md](05_LONG_TERM.md)** - M5-M9: Complete features, hardening, and 1.0 release

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

### Prioritization Heuristic

**P1 (Highest)**: Unblocks agent workflows OR delivers strong visual feedback for humans
- Examples: `dom.wait`, `dom.inspect`, `net.capture`, `net.har`

**P2 (Medium)**: Common debugging diagnostics with broad applicability
- Examples: `net.show`, `console.tail`, `dom.a11y`

**P3 (Low)**: Nice-to-have or niche; defer until requested by multiple users
- Examples: `net.replay`, `console.inject`, advanced profiling

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

## Operating Model

### Release Cadence
- **Fortnightly releases** with `CHANGELOG.md` and upgrade notes
- Domains labeled: `dom`, `net`, `console`, `perf`
- WIP wrappers protected behind feature flags if needed (e.g., `BDG_ENABLE_REPLAY=1`)

### Schema Management
- **`docs/SCHEMA.md`** defines envelope, per-command data shapes, and versioning
- `--schema-version` flag for negotiation
- **Deprecation policy**: 3 months notice, sunset dates in CHANGELOG
- **Contract tests** lock JSON shape with golden files

### Testing Strategy
- **CI runs Chrome stable and beta**: Catch regressions early
- **Smoke tests against real public pages**: example.com, github.com, wikipedia.org, news.ycombinator.com
- **Deterministic outputs**: Timeouts and retry caps to reduce flakiness
- **Golden screenshot tests**: Fuzzy image diff tolerance for overlays

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

## Getting Started

1. **Review vision and principles** (this document)
2. **Check current milestone**: [01_AGENTS_FOUNDATION.md](01_AGENTS_FOUNDATION.md)
3. **Understand decision frameworks** (when to build wrappers vs document CDP)
4. **See detailed implementation guide**: [M1_IMPLEMENTATION_GUIDE.md](M1_IMPLEMENTATION_GUIDE.md)

## References

- [CDP Method Exposure Design](../CDP_METHOD_EXPOSURE.md)
- [Agent-Friendly CLI Principles](../principles/AGENT_FRIENDLY_TOOLS.md)
- [CLI Reference](../CLI_REFERENCE.md)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
