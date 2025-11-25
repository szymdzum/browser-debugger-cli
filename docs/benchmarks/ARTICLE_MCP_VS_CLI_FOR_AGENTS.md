# MCP vs CLI: Which Interface Do AI Agents Actually Prefer?

**A Benchmark-Driven Comparison of Browser Automation Paradigms**

---

## Introduction

When building tools for AI agents, developers face a fundamental interface choice: expose functionality through the Model Context Protocol (MCP), or provide a traditional command-line interface (CLI) that agents invoke via shell commands.

Both approaches have vocal advocates. MCP promises structured tool definitions, type safety, and seamless integration with AI platforms. CLI tools offer Unix composability, predictable output, and decades of battle-tested design patterns.

We ran a series of benchmarks comparing two browser automation tools—one MCP-based, one CLI-based—to answer a practical question: **which interface paradigm serves AI agents better for real-world developer tasks?**

---

## The Contenders

### Chrome DevTools MCP Server

The official MCP server for Chrome DevTools, maintained by the Chrome team. It exposes browser automation through the MCP protocol with tools like:

- `new_page` / `close_page` - Session management
- `take_snapshot` - Full accessibility tree capture
- `click` / `fill` - Element interaction via accessibility UIDs
- `evaluate_script` - JavaScript execution
- `list_console_messages` / `list_network_requests` - Telemetry

**Design philosophy**: Accessibility-first. Interactions happen through the accessibility tree, providing robust element targeting that survives DOM changes.

### bdg (Browser Debugger CLI)

A command-line tool providing direct Chrome DevTools Protocol (CDP) access. Commands include:

- `bdg <url>` / `bdg stop` - Session lifecycle
- `bdg dom query` / `bdg dom click` - CSS selector-based interaction
- `bdg console` / `bdg peek` - Live telemetry monitoring
- `bdg cdp <method>` - Direct CDP method invocation
- `bdg network har` - HAR export

**Design philosophy**: Power-user debugging. Full CDP access with Unix-style composability.

---

## Benchmark Design

We tested five scenarios representing actual developer debugging workflows:

| Test | Difficulty | Task |
|------|------------|------|
| Basic Error | Easy | Find and diagnose one JS error |
| Multiple Errors | Moderate | Capture and categorize 5+ errors |
| SPA Debugging | Advanced | Debug React app, correlate console/network |
| Form Validation | Expert | Test validation logic, find bugs |
| Memory Leak | Master | Detect and quantify DOM memory leak |

**Methodology**:
- Same URLs and time limits for both tools
- Alternating test order to prevent learning bias
- Metrics: task score, completion time, tokens consumed
- Token Efficiency Score (TES) = (Score × 100) / (Tokens / 1000)

Full benchmark specification: [BENCHMARK_DEVTOOLS_DEBUGGING_V3.1.md](./BENCHMARK_DEVTOOLS_DEBUGGING_V3.1.md)

---

## Results Summary

| Metric | bdg (CLI) | MCP |
|--------|-----------|-----|
| **Total Score** | 77/100 | 60/100 |
| **Total Time** | 441s | 323s |
| **Total Tokens** | ~38.1K | ~39.4K |
| **Token Efficiency (TES)** | 202.1 | 152.3 |

**Winner: CLI (+17 points, +33% token efficiency)**

---

## Test-by-Test Analysis

### Test 1: Basic Error Detection

| Tool | Score | Time | Tokens |
|------|-------|------|--------|
| bdg | 18/20 | 69s | ~3.6K |
| MCP | 14/20 | 46s | ~4.8K |

**What happened**: Both tools successfully navigated to the page and triggered an error. The difference emerged in output quality:

- **bdg**: Full stack trace with 6 frames, function names, line/column numbers
- **MCP**: Basic error message "$ is not defined", limited location info

MCP was faster but provided less actionable debugging information. For a developer, bdg's output means immediately understanding the call chain; MCP's output requires additional investigation.

---

### Test 2: Multiple Error Collection

| Tool | Score | Time | Tokens |
|------|-------|------|--------|
| bdg | 18/20 | 75s | ~18.7K |
| MCP | 12/20 | 48s | ~9.3K |

**What happened**: The page had 17 "Run" buttons, each triggering different errors.

- **bdg**: Used JavaScript evaluation to click all 17 buttons with timeouts in a single command. Captured 18 errors (14 unique) with full stack traces.
- **MCP**: Made 11 individual click calls, missing 6 buttons. Captured only 3 errors.

This test revealed a fundamental capability gap. bdg's `Runtime.evaluate` access enables batch operations:

```bash
bdg cdp Runtime.evaluate --params '{
  "expression": "document.querySelectorAll(\"button\").forEach((b,i) => setTimeout(() => b.click(), i*100))"
}'
```

MCP doesn't expose arbitrary JavaScript execution—each interaction requires a separate tool call. For comprehensive testing, this limitation compounds.

---

### Test 3: SPA Debugging

| Tool | Score | Time | Tokens |
|------|-------|------|--------|
| bdg | 14/20 | 100s | ~4.7K |
| MCP | 13/20 | 57s | ~6.6K |

**What happened**: Both tools tested a React TodoMVC app. Neither found significant bugs (the app is well-built). Both identified a 404 favicon error.

This was the closest test—when an application has no bugs to find, the tools perform similarly. The marginal bdg advantage came from HAR export capability for network analysis.

---

### Test 4: Form Validation Testing

| Tool | Score | Time | Tokens |
|------|-------|------|--------|
| bdg | 15/20 | 93s | ~3.5K |
| MCP | 13/20 | 102s | ~15.2K |

**What happened**: Testing a form with validation rules revealed MCP's verbosity problem.

The form included a country dropdown with 195 options. Every MCP snapshot included the full accessibility tree—all 195 country options, repeated on every interaction. Token usage ballooned to 15.2K for the same task bdg completed in 3.5K tokens.

bdg tested more scenarios (4 vs 3) in less time and finished under the time limit. MCP exceeded the limit by 42 seconds, incurring a penalty.

---

### Test 5: Memory Leak Detection

| Tool | Score | Time | Tokens |
|------|-------|------|--------|
| bdg | 12/20 | 104s | ~7.6K |
| MCP | 8/20 | 70s | ~3.5K |

**What happened**: This test exposed a fundamental capability difference.

bdg used CDP's HeapProfiler methods directly:

```bash
bdg cdp Runtime.getHeapUsage
# Baseline: 833KB used, 1.5MB total

# Trigger leak...

bdg cdp Runtime.getHeapUsage
# After: 790KB used, 3MB embedder heap (+44% growth)
```

MCP has no access to profiling APIs. It could observe DOM growth visually but couldn't measure actual memory consumption. Without quantification, it couldn't prove a leak existed—only that more elements appeared on screen.

This isn't MCP being "bad"—it's MCP not exposing the capability. For memory debugging, that's a dealbreaker.

---

## The Accessibility Tree Question

A common defense of MCP's verbosity: "The accessibility tree provides complete page understanding in one call."

This argument has two problems:

### 1. CLI Tools Can Use Accessibility Trees Too

bdg provides selective accessibility access:

```bash
bdg dom a11y describe 0           # Single element
bdg dom a11y ".submit-button"     # Specific selector
```

The difference isn't *whether* to use accessibility data—it's *how much* to retrieve:

| Approach | bdg | MCP |
|----------|-----|-----|
| Query strategy | Fetch what you need | Dump everything |
| 195-option dropdown | ~50 tokens | ~5,000 tokens |
| Complex page (Amazon) | ~1,200 tokens | ~52,000 tokens |

### 2. Completeness ≠ Usefulness

An agent receiving 52,000 tokens of accessibility tree still needs to parse it to find relevant elements. That parsing happens in the agent's context window, consuming capacity for reasoning.

With selective queries, the agent asks for what it needs. The tool does the filtering. The agent's context stays focused.

---

## Why CLI Won This Benchmark

### 1. Token Efficiency at Scale

For the Amazon product page test:

```
MCP: 52,000 tokens (single snapshot, truncated at system limit)
bdg: 1,200 tokens (two targeted queries)
```

That's 43x more efficient. In a context window, that difference determines whether you can complete a complex debugging session or run out of space mid-task.

### 2. Capability Coverage

| Capability | bdg | MCP |
|------------|-----|-----|
| Console errors with stack traces | ✓ | Partial |
| Memory profiling | ✓ | ✗ |
| Network HAR export | ✓ | ✗ |
| Batch JavaScript execution | ✓ | ✗ |
| Selective DOM queries | ✓ | ✗ |
| Direct CDP method access | ✓ (300+ methods) | ✗ |

For developer debugging tasks, these aren't edge features—they're core workflows.

### 3. Unix Composability

CLI output pipes naturally:

```bash
bdg console --json | jq '.errors | length'
bdg network har - | jq '.log.entries[] | select(.response.status >= 400)'
bdg dom query "button" | head -5
```

MCP responses require the agent to parse and filter internally. That's additional reasoning steps and context consumption.

### 4. Predictable Output Size

With CLI tools, agents can estimate token impact before calling:

- `bdg dom query ".error"` → proportional to matched elements
- `bdg console --last 10` → bounded by limit parameter

MCP's `take_snapshot` returns... whatever the page contains. Could be 5K tokens, could be 52K. The agent can't predict or control this.

---

## When MCP Might Make Sense

This benchmark tested developer debugging workflows. MCP's design optimizes for different scenarios:

### Cross-Platform Integration

MCP is a protocol, not a tool. The same MCP server works with Claude Desktop, VS Code extensions, and any MCP-compatible client. If you're building for that ecosystem, MCP integration is valuable.

### Sandboxed Environments

MCP's restricted capabilities (no arbitrary JS eval, no profiling) can be features in contexts requiring safety guarantees. If you're building a user-facing automation tool where arbitrary code execution is a risk, MCP's constraints are appropriate.

### Accessibility-First Testing

For WCAG compliance auditing where you genuinely need the full accessibility tree, MCP's comprehensive snapshots are useful. The verbosity is the point.

---

## Implications for Tool Builders

### If You're Building for AI Agents

1. **Selective queries over bulk dumps**. Let agents request specific data rather than forcing them to parse everything.

2. **Predictable output sizing**. Provide limits, pagination, or filtering so agents can control context consumption.

3. **Full capability access**. If the underlying system can do it, expose it. Don't pre-decide what agents "need."

4. **Structured, parseable output**. JSON with consistent schemas beats prose descriptions.

5. **Composability**. Outputs that pipe to other tools extend capability without additional implementation.

### If You're Choosing Between Paradigms

For **power-user developer workflows**: CLI wins. Direct access, Unix composition, predictable output.

For **ecosystem integration and sandboxing**: MCP has structural advantages that matter in different contexts.

---

## Conclusion

We set out to compare MCP and CLI as interfaces for AI agents doing browser automation. The benchmark results are clear: for developer debugging workflows, CLI provides more capability with better efficiency.

The margin wasn't close—77 vs 60 points, 33% better token efficiency. CLI completed tasks that MCP structurally couldn't (memory profiling), and did shared tasks with less overhead (selective queries vs full dumps).

This doesn't mean MCP is "bad." It means MCP optimizes for different constraints than an AI agent debugging a web application. Protocol standardization and sandboxed execution matter in some contexts. They just aren't the contexts we tested.

For tool builders: consider your users. If AI agents are a primary audience, the CLI paradigm—selective queries, predictable output, full capability access—serves them better than protocol abstractions that trade power for portability.

---

## Appendix: Raw Data

### Detailed Token Analysis by Test

| Test | bdg Tokens | MCP Tokens | Ratio |
|------|------------|------------|-------|
| Test 1: Basic Error | 3,600 | 4,800 | 0.75x |
| Test 2: Multiple Errors | 18,700 | 9,300 | 2.0x |
| Test 3: SPA Debugging | 4,700 | 6,600 | 0.71x |
| Test 4: Form Validation | 3,500 | 15,200 | 0.23x |
| Test 5: Memory Leak | 7,600 | 3,500 | 2.17x |
| **Total** | **38,100** | **39,400** | **0.97x** |

Note: Similar total tokens, but bdg achieved 28% higher score—meaning tokens were spent more effectively.

### Token Efficiency Score Breakdown

```
TES = (Score × 100) / (Tokens / 1000)

bdg: (77 × 100) / 38.1 = 202.1
MCP: (60 × 100) / 39.4 = 152.3

Advantage: +33% for CLI
```

### Capability Matrix

| CDP Domain | bdg Access | MCP Access |
|------------|------------|------------|
| Runtime | Full | evaluate_script only |
| DOM | Full | Via accessibility tree |
| Network | Full + HAR export | list_network_requests |
| Console | Full + streaming | list_console_messages |
| HeapProfiler | Full | None |
| Debugger | Full | None |
| Performance | Full | None |
| Accessibility | Selective queries | Full tree dumps |

---

**Benchmark Version**: 3.1
**Test Date**: November 2025
**Full Results**: [BENCHMARK_RESULTS_2025-11-24.md](./BENCHMARK_RESULTS_2025-11-24.md)
