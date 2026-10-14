# Agent-Friendly CLI Design Principles

An agent-friendly tool is designed for programmatic consumption: **information density** and **predictability** come before human ergonomics. Agents work under different constraints than people.

## Core Differences: Agents vs Humans

- **Token-constrained.** Every byte of help text and output costs tokens. Principle: maximum signal, minimum noise.
- **Limited context.** No memory between invocations; the tool must describe itself quickly and completely. Principle: self-describing but concise interfaces.
- **Deterministic.** Ambiguous output breaks pipelines, and a schema change is a breaking change. Principle: stable, predictable interfaces.

## Five Foundational Principles

### 1. Machine-Friendly Escape Hatches

Every command runs non-interactively. Agents cannot answer prompts.

In bdg: commands take everything as arguments and flags, `-q, --quiet` minimizes output, and `--session <name>` / `BDG_SESSION` select a session without a prompt.

*Source: InfoQ, "Patterns for AI Agent Driven CLIs" (August 2025)*

### 2. Treat Output as an API Contract

Output formats are versioned interfaces. Changes are additive: new fields are allowed, removing or renaming one is a breaking change.

In bdg every `--json` response uses one envelope that carries the bdg version:

```console
$ bdg network list --json
{"version":"0.17.0","success":true,"data":{"requests":[{"requestId":"86925.2","method":"GET","url":"http://localhost:53381/favicon.ico","status":404,"duration":6, …}]}}
```

*Source: InfoQ (August 2025)*

### 3. Semantic Exit Codes

Exit codes tell the agent what to do next, not just whether it failed. bdg follows Square's two-tier scheme:

```text
0        Success
80-99    User errors (invalid input, missing resource, conflicts)
100-119  Software errors (Chrome launch, CDP connection, timeouts, bugs)
130/143  Interrupted by Ctrl-C / SIGTERM (shell convention)
```

Agent decision logic: 0 proceed; 80-99 do not retry the same call, fix the input or pick another resource (`81` invalid arguments, `83` not found, `87` stale cache: re-run the query); 100-119 usually transient or a bug, retry once with backoff or report. The full list is in `bdg --help --json` under `exitCodes`.

*Source: Square Engineering, "Command Line Observability with Semantic Exit Codes" (January 2023)*

### 4. Structured Output with Multiple Formats

Human-readable by default, machine-readable on request. Primary data goes to stdout; errors and hints to stderr.

```console
$ bdg network list --preset errors            # compact lines for a human or an agent
$ bdg network list --preset errors --json     # the same data as the JSON envelope
```

*Source: clig.dev, AWS CLI documentation*

### 5. Feedback for Long Operations

Long commands must not look hung. `bdg peek --follow`, `bdg network list --follow` and `bdg console --follow` stream events as they happen; a session started with `--timeout <seconds>` ends by itself and says why.

*Source: InfoQ (August 2025)*

## Design Philosophy

### Information Layering

1. **Primary data** (stdout): the answer to the question, stable schema.
2. **Metadata** (stdout, on request): `--verbose` adds full URLs and details.
3. **Context** (stderr): warnings and explanatory messages, never in the way of a pipeline.

### One Command, One Question

Commands reflect the investigation workflow and compose through pipes:

```bash
bdg network list --filter "duration:>1s" --json | jq -r '.data.requests[].requestId'   # slow requests
bdg details network <id> --json                                                          # one request in full
bdg network list --preset errors                                                        # failed requests only
bdg console --level error                                                                # console errors only
```

Not `bdg diagnose-everything`, which would mix network, console and performance into one answer nobody can filter.

### Errors Are Typed Information

Agents need semantic signals more than friendly prose. bdg errors carry the exit code, a message and a next step:

```console
$ bdg details network nope --json
{"version":"0.17.0","success":false,"error":"Network request not found: nope","suggestion":"List request ids with: bdg network list","exitCode":83}
```

Typos get a suggestion too (`bdg dom clik` answers `Did you mean: click?`; see [TYPO_DETECTION.md](TYPO_DETECTION.md)).

### The Tool Does Not Retry, the Agent Does

Agents have their own retry logic and backoff. A tool that retries internally hides failures and burns time. bdg reports the failure with its exit code (for example `102`, CDP timeout) and lets the caller decide.

### Text Streams

stdout carries data, stderr carries logs and progress, the exit code carries success. Never mix them: progress on stdout breaks pipes, data on stderr is lost.

## Self-Describing Tools

Agents query capabilities instead of reading documentation (see [SELF_DOCUMENTING_SYSTEMS.md](SELF_DOCUMENTING_SYSTEMS.md)):

```bash
bdg --help --json                       # every command, flag and exit code
bdg network list --help --json          # one command in full: options, defaults, behaviors
bdg cdp --list                          # CDP domains
bdg cdp Network.getCookies --describe   # one method: parameters, return types, example
```

## Context Without Verbosity

Context is essential information, not narration. Compare:

```text
Connecting to Chrome DevTools Protocol...
Found 47 requests in the last 30 seconds
Filtering for failed requests...
```

with the structured form bdg prints, one line per request and a count in the header:

```console
$ bdg network list --preset errors
NETWORK REQUESTS (1 matching, 2 in all)
[ID]       START STS METH TYP     SIZE   TIME  URL
[86925.2]  +0.1s 404 GET  OTH    143 B    6ms  localhost:53381/favicon.ico
```

## CLI vs MCP: Trade-offs

The industry consensus recommends MCP for agent integration: dynamic discovery, schemas, stateful multi-turn interactions. These notes reflect experience building a CLI-first tool.

- **Context efficiency:** the command structure is the schema; no protocol overhead or server definitions.
- **Debuggability:** a failing command shows its exact error and exit code.
- **Composability:** output pipes into `jq`, `grep`, `sort`.
- **Model knowledge:** models are trained extensively on shell patterns.

MCP is the better fit for tools that need runtime capability negotiation, complex authentication or bidirectional real-time interaction. bdg chose the CLI because DevTools operations are atomic queries against a long-lived session, and its users already work in a terminal. This is a trade-off for one use case, not a universal ranking.

## Checklist

- [ ] Each command answers one question, and every command supports `--json`
- [ ] Data on stdout, logs and errors on stderr
- [ ] `--json` has a stable schema with a version, additive changes only
- [ ] Exit codes follow the semantic ranges; errors carry a suggestion
- [ ] No internal retry loops, no prompts
- [ ] `--help --json` describes the command; error messages name the next step

## References

1. InfoQ, "Keep the Terminal Relevant: Patterns for AI Agent Driven CLIs" (August 2025): https://www.infoq.com/articles/ai-agent-cli/
2. Square Engineering, "Command Line Observability with Semantic Exit Codes" (January 2023): https://developer.squareup.com/blog/command-line-observability-with-semantic-exit-codes/
3. Command Line Interface Guidelines: https://clig.dev/
4. Unix philosophy (McIlroy, Bell Labs, 1978): do one thing well, expect output to become the input of another program.
5. AWS CLI / Azure CLI documentation: multi-format output and consistent flag conventions.

## Conclusion

Agent-friendly tools are good CLI tools that take the Unix philosophy seriously and adapt to LLM constraints: deterministic, composable operations with structured output. For bdg, every design decision asks: does this help an agent decide what to do next?
