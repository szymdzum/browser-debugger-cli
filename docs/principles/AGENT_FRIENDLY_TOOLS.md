# Agent-Friendly CLI Design Principles

## The Fundamental Question: What Is "Agent-Friendly"?

An agent-friendly tool is one designed for programmatic consumption where **information density** and **predictability** take precedence over human ergonomics. It recognizes that AI agents operate under fundamentally different constraints than human users.

## Core Differences: Agents vs Humans

### Agents Are Token-Constrained
- Every byte of help text, output, and command costs tokens
- Tokens are literal currency in agent operations
- Verbose output directly increases operational costs
- **Principle**: Maximum signal, minimum noise

### Agents Have Limited Context Windows
- No persistent memory between invocations unless explicitly provided
- Must understand tool capabilities quickly and completely
- Cannot "remember" previous interactions or help text
- **Principle**: Self-describing but concise interfaces

### Agents Require Deterministic Behavior
- Ambiguous output breaks automated pipelines
- Same input must always produce same output structure
- Schema changes are breaking changes
- **Principle**: Stable, predictable interfaces

## Five Foundational Principles

### 1. Machine-Friendly Escape Hatches

**Every command must support non-interactive execution.**

**Implementation:**
- `--no-prompt` / `--no-interactive` flags to disable stdin reads
- `--yes` / `-y` flags for automatic confirmations
- Environment variables for global configuration (e.g., `NO_COLOR=true`)
- Tool-specific environment variables (e.g., `BDG_PROJECT_ID=2558`)

**Rationale:** Agents cannot respond to prompts. Interactive tools break automation.

**Source:** InfoQ, "Patterns for AI Agent Driven CLIs" (August 2025)

---

### 2. Treat Output as API Contracts

**Output formats are versioned interfaces that must remain stable.**

**Implementation:**
- Semantic versioning for output schema changes
- Schema validation on every change
- Additive changes only (new fields allowed, removing fields = major version bump)
- Version numbers in structured output: `{"version": "1.0", "data": {...}}`

**Rationale:** Breaking output format disrupts all downstream automation. Agents parse output programmatically; humans can adapt to changes.

**Source:** InfoQ, "Patterns for AI Agent Driven CLIs" (August 2025)

---

### 3. Semantic Exit Codes

**Exit codes communicate actionable information, not just success/failure.**

**Implementation (based on Square's system):**
```
0        Success
1        Generic failure (backward compatibility)
80-99    User errors (invalid arguments, bad permissions, resource issues)
100-119  Software errors (bugs, integration failures, timeouts)
```

**Recommended Subdivisions (for finer-grained error handling):**
```
80-89    Input/validation errors (invalid arguments, bad permissions)
90-99    Resource/state errors (not found, already exists, conflicts)
100-109  Integration/external errors (API down, timeout, auth failed)
110-119  Internal software errors (bugs in the tool itself, panics)
```

**Agent Decision Logic:**
- 0: Proceed to next step
- 80-89: Don't retry, fix input/permissions first
- 90-99: Ask for clarification or try alternate resource
- 100-109: Retry with backoff (likely transient failure)
- 110-119: Report bug, don't retry

**Rationale:** Agents make programmatic decisions based on exit codes. Generic failure codes (0/1) provide no decision-making information. Square's two-tier system (80-99 user, 100-119 software) provides the foundation; subdivisions enable more sophisticated retry logic.

**Source:** Square Engineering, "Command Line Observability with Semantic Exit Codes" (January 2023)

---

### 4. Structured Output with Multiple Formats

**Support both human-readable and machine-parseable output.**

**Implementation:**
- Default: Structured text (key-value pairs, line-based)
- `--json`: Full JSON structure
- `--plain`: Tab-separated for grep/awk compatibility
- Consistent flags across all commands: `-o json` or `--output json`

**Output Separation:**
- Primary data → `stdout`
- Logs/warnings/progress → `stderr`
- Errors → `stderr` (with structured format when `--json` used)

**Example:**
```bash
# Default (human & agent readable)
$ bdg network requests
ID: req_123
URL: https://api.example.com/data
Status: 200
Duration: 145ms

# JSON mode (pure machine readable)
$ bdg network requests --json
{"id":"req_123","url":"https://api.example.com/data","status":200,"duration_ms":145}
```

**Rationale:** Agents need parseable structure. Humans need readable context. Both served by the same tool with format flags.

**Source:** Command Line Interface Guidelines (clig.dev), AWS CLI documentation

---

### 5. Real-Time Feedback for Long Operations

**Progress reporting prevents agent timeouts and enables early failure detection.**

**Implementation:**
- Progress indicators on `stderr` (never `stdout`)
- Event streaming for long-running operations
- Incremental output when possible (streaming JSON Lines)
- Timeout hints: `Estimated: 2m 30s remaining`

**Example:**
```bash
$ bdg performance trace --duration 30s
[stderr] Capturing trace... 15s elapsed
[stderr] Capturing trace... 30s complete
[stdout] {"trace_file": "/tmp/trace.json", "size_mb": 45.2}
```

**Rationale:** Long-running commands appear "hung" to agents without feedback. Progress on stderr allows agents to monitor without parsing complexity.

**Source:** InfoQ, "Patterns for AI Agent Driven CLIs" (August 2025)

---

## Design Philosophy for Agent-First Tools

### Dual-Mode Architecture: Janus-Faced Design

Tools should **detect execution context** and adapt:

**Detection Strategy:**
```
if stdout.is_tty():
    # Human mode: colors, formatting, helpful context
else:
    # Agent mode: structured output, no colors, minimal decoration
```

**Override with explicit flags:**
- `--json`: Force machine-readable output
- `--no-color`: Disable ANSI escape codes
- `--no-interactive`: Disable all prompts

### Information Layering: Three Output Tiers

**Layer 1: Primary Data** (`stdout`)
- The answer to the question asked
- What agents will parse and compose
- Must be stable, versioned schema

**Layer 2: Metadata** (`stdout`, optional)
- Timestamps, URLs, identifiers
- Included with `--verbose` or `--metadata`
- Structured when present

**Layer 3: Context** (`stderr`)
- Progress indicators
- Warnings
- Explanatory messages
- Never interferes with pipelines

### Command Topology: Navigable Mental Model

**Commands should reflect investigation workflow:**
```
tool
├── resource                    # Top-level entity
│   ├── get <id>               # Retrieve one
│   ├── list [filters]         # Query many
│   └── subresource <id>       # Navigate relationships
│
└── action                     # Operational commands
    ├── start <target>
    └── stop <target>
```

**Composability Pattern:**
```bash
# Output of one command feeds the next
tool resource list --status=failed --json | \
  jq -r '.[] | .id' | \
  xargs -I {} tool resource get {} --json
```

Each command:
- Does one thing completely
- Returns structured, parseable output
- Can be composed with other commands via pipes

---

## Error Handling Philosophy

### Errors Are Typed Information

Agents need **semantic error signals** to make decisions, not friendly messages.

**Error Structure:**
```json
{
  "error": {
    "code": 92,
    "type": "resource_not_found",
    "message": "Network request req_123 not found",
    "details": {
      "request_id": "req_123",
      "reason": "Request may have been cleared from cache"
    },
    "recoverable": false,
    "retry_after": null,
    "suggestions": [
      "List recent requests: bdg network requests --recent",
      "Check request ID format: should be req_*"
    ]
  }
}
```

**Key Fields for Agent Decision-Making:**
- `code`: Semantic exit code (matches process exit code)
- `type`: Machine-readable error category
- `recoverable`: Should agent retry?
- `retry_after`: When to retry (for rate limits, timeouts)
- `suggestions`: Array of next actions agent can take

### Tool Doesn't Retry - Agent Does

**Anti-Pattern:**
```bash
# Tool retries internally (bad)
$ bdg network requests
Connecting... failed
Retrying in 2s...
Retrying in 4s...
Error: Connection failed after 3 attempts
```

**Correct Pattern:**
```bash
# Tool reports error clearly (good)
$ bdg network requests --json
{"error": {"code": 105, "type": "connection_timeout", "recoverable": true, "retry_after": 2}}
$ echo $?
105
```

**Rationale:** Agents have their own retry logic, backoff strategies, and decision trees. Tool should provide clear signals, not hide failures behind retry loops.

---

## Unix Philosophy Foundations

### Do One Thing Well

**Each command has a specific, well-defined purpose:**
- `bdg network requests` → List network requests
- `bdg network failed` → List failed requests only
- `bdg console errors` → List console errors

**Not:**
- `bdg diagnose-everything` → Analyzes network, console, performance in one command

### Composability Through Pipes

**Design for composition:**
```bash
# Find slow requests, get details, extract URLs
bdg network slow --threshold 1000ms --json | \
  jq -r '.[] | .id' | \
  xargs -I {} bdg network timing {} --json | \
  jq -r '.url'
```

**Requirements:**
- Line-based or JSON output
- Stable field names
- Predictable structure
- Clean stdout (no decoration)

### Text Streams as Universal Interface

**Standard streams have distinct purposes:**
- `stdin`: Accept piped input when appropriate
- `stdout`: Primary data output (parseable)
- `stderr`: Logs, warnings, progress (ignorable)
- Exit code: Success/failure signal

**Never mix purposes:** Progress bars on stdout break pipes. Data on stderr is lost.

---

## Self-Describing Tools

### Tool Introspection

Agents don't read documentation - they query capabilities.

**Help as Data:**
```bash
$ bdg --help-json
{
  "version": "1.2.0",
  "commands": {
    "network": {
      "description": "Network request inspection",
      "subcommands": ["requests", "failed", "slow", "timing"],
      "flags": {
        "--json": "Output in JSON format",
        "--limit": "Maximum number of results (default: 50)"
      }
    }
  },
  "output_formats": ["text", "json"],
  "exit_codes": {
    "0": "success",
    "85": "invalid_argument",
    "92": "resource_not_found",
    "105": "connection_timeout"
  }
}
```

### Schema Discovery

For complex tools, provide JSON schemas:
```bash
$ bdg network requests --schema
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "id": {"type": "string"},
    "url": {"type": "string"},
    "method": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE"]},
    "status": {"type": "integer"},
    "duration_ms": {"type": "number"}
  }
}
```

**Rationale:** Agents can validate output, understand structure, and adapt to schema versions.

---

## Context Without Verbosity

### Bad: Verbose Explanations
```
Connecting to Chrome DevTools Protocol...
Successfully established connection on port 9222
Querying network activity...
Found 47 requests in the last 30 seconds
Filtering for failed requests...
3 requests failed with status codes >= 400
Here are the results:
```

### Good: Structured Context
```
Connected: localhost:9222
Total Requests: 47
Failed: 3/47
Time Range: 30s

req_001 | POST /api/data | 500 | 145ms
req_015 | GET /config.json | 404 | 23ms
req_042 | PUT /update | 503 | 2341ms
```

### Best: JSON with Metadata
```json
{
  "connection": "localhost:9222",
  "summary": {
    "total_requests": 47,
    "failed_requests": 3,
    "time_range_seconds": 30
  },
  "requests": [
    {
      "id": "req_001",
      "method": "POST",
      "url": "/api/data",
      "status": 500,
      "duration_ms": 145
    }
  ]
}
```

**Key Principle:** Context is essential information, not chatty narration. Both humans and agents need context - they just need it structured differently.

---

## CLI vs MCP: Design Trade-offs for Agent Tools

**Note:** The industry consensus (including the InfoQ article) recommends **MCP adoption for agent integration**. MCP provides dynamic capability discovery and structured schemas. The observations below reflect personal experience building CLI-first tools and should be considered alongside MCP's benefits.

### CLI Advantages (Observed in Practice)

**Context Efficiency:**
- **CLI**: Command structure is the schema (`bdg network requests --failed`)
- **MCP**: Protocol overhead + server definitions + request/response wrapping
- **Observation**: Simpler commands can be more token-efficient in practice

**Debuggability:**
- **CLI**: `$ bdg network requests` fails → see exact error message
- **MCP**: Errors wrap in protocol layers, may require additional debugging steps

**Composability:**
- **CLI**: `bdg network requests | jq | grep | sort`
- **MCP**: Responses don't naturally compose with Unix tools
- **Strength**: Unix pipeline patterns for filtering and transformation

**Model Knowledge:**
- **CLI**: LLMs trained extensively on bash/zsh command patterns
- **MCP**: Newer protocol, less representation in training data
- **Caveat**: MCP enables dynamic discovery, which can offset this

### MCP Advantages (Industry Perspective)

**Dynamic Discovery:**
- Agents discover capabilities at runtime without hardcoded knowledge
- Schema validation prevents errors from format changes
- Versioned capability negotiation

**Standardization:**
- Single protocol for tool integration across ecosystems
- Reduces fragmentation compared to CLI tool diversity

**Complex Interactions:**
- Stateful, multi-turn interactions
- Complex authentication flows
- Real-time bidirectional communication

### Design Decision for bdg

**For this project (Chrome DevTools telemetry):** CLI is the chosen approach because:
- DevTools operations are atomic queries (list requests, get console logs)
- No stateful multi-turn workflows needed
- Target users already work in terminal environments
- Unix composability is a natural fit for data filtering/analysis

**This doesn't mean CLI is universally superior** - it's a trade-off based on use case. Tools requiring dynamic discovery, complex state management, or cross-platform consistency may benefit more from MCP.

---

## Practical Design Checklist

### ✅ Command Design
- [ ] Each command answers one specific question
- [ ] Subcommands reflect logical navigation path
- [ ] Command names are verbs or nouns, never sentences
- [ ] All commands support `--json` flag
- [ ] All commands support `--no-interactive` flag

### ✅ Output Design
- [ ] Primary data goes to stdout
- [ ] Logs/progress go to stderr
- [ ] Default output is human-readable AND line-parseable
- [ ] JSON output has stable schema with version number
- [ ] No ANSI colors when stdout is not a TTY

### ✅ Error Handling
- [ ] Exit codes follow semantic ranges (0, 80-89, 90-99, 100-109, 110-119)
- [ ] Errors include `type`, `code`, `recoverable`, `suggestions`
- [ ] Error messages on stderr
- [ ] JSON errors when `--json` flag used
- [ ] No retry logic (let agents decide)

### ✅ Composability
- [ ] Commands can be piped together
- [ ] Output can be filtered with grep/awk/jq
- [ ] Commands accept stdin when appropriate
- [ ] Each command has single responsibility

### ✅ Documentation
- [ ] `--help` provides human-readable usage
- [ ] `--help-json` provides machine-readable schema
- [ ] Examples in help show composition patterns
- [ ] Error messages include suggestions for next steps

---

## References

1. **InfoQ Article**: "Keep the Terminal Relevant: Patterns for AI Agent Driven CLIs" (August 2025)
   - URL: https://www.infoq.com/articles/ai-agent-cli/
   - Machine-friendly escape hatches
   - Output as API contracts
   - Real-time feedback patterns

2. **Square Engineering**: "Command Line Observability with Semantic Exit Codes" (January 2023)
   - URL: https://developer.squareup.com/blog/command-line-observability-with-semantic-exit-codes/
   - Exit code ranges: 80-99 user errors, 100-119 software errors
   - Error type separation for SLOs

3. **Command Line Interface Guidelines** (clig.dev)
   - URL: https://clig.dev/
   - GitHub: https://github.com/cli-guidelines/cli-guidelines
   - Unix philosophy application to modern CLIs
   - Output separation (stdout/stderr)
   - Composability patterns

4. **Unix Philosophy** (Bell Labs, Doug McIlroy, 1978)
   - Classic formulation of "do one thing well"
   - Expect output to become input to another program
   - Design for composition

5. **AWS CLI / Azure CLI Documentation**
   - AWS CLI: https://docs.aws.amazon.com/cli/
   - Azure CLI: https://docs.microsoft.com/en-us/cli/azure/
   - Multi-format output patterns
   - Consistent flag conventions
   - JMESPath query integration

---

## Conclusion

Agent-friendly tools are not a separate category from good CLI tools - they are an evolution that takes Unix philosophy seriously while adapting to LLM constraints.

**The Core Insight:** Design for deterministic, composable operations with structured output. This serves both agents (who need parseable data) and humans (who benefit from predictability).

**For bdg:** Every design decision should ask: "Does this help an agent make decisions?" If yes, implement it. If no, remove it.
