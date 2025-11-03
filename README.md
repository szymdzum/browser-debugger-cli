# Browser Debugger CLI

Lightweight CLI that streams Chrome DevTools Protocol telemetry (DOM, network, console) so humans and agents can debug web apps without bespoke MCP servers.

---

## Highlights

- **Agent-friendly** – Works with any terminal-first assistant; teach the workflow once via a skill doc.
- **CDP-native** – Talks directly to Chrome over WebSocket; no headless browser wrappers or runtime dependencies beyond Node + Chrome.
- **Optimised output** – Compact JSON, default filtering, and body-skipping keep token usage low.
- **Daemon roadmap** – Background session + IPC design (see [docs/DAEMON_IPC_ARCHITECTURE.md](docs/DAEMON_IPC_ARCHITECTURE.md)) will provide live queries without disk writes.

For the full CLI playbook (usage patterns, optimisation flags, philosophy notes), see [docs/CLI_AGENT_WORKFLOW.md](docs/CLI_AGENT_WORKFLOW.md).

---

## Installation

```bash
npm install -g browser-debugger-cli
```

Requires Node.js ≥ 18 and a Chrome/Chromium build with remote debugging enabled.

---

## Quick Start

```bash
# Start collection (auto-launches Chrome if needed)
bdg localhost:3000

# Interact with the page, then stop collection
bdg stop
```

Telemetry (network, console, DOM) is emitted to stdout when you stop the session. Pipe it into JSON-aware tools for analysis:

```bash
bdg stop > telemetry.json
jq '.data.console[] | select(.type == "error")' telemetry.json
```

Need more patterns, flags, or best practices? Jump to the [CLI Agent Workflow guide](docs/CLI_AGENT_WORKFLOW.md).

---

## Roadmap Snapshot

- ✅ Stable CLI workflow with preview/full JSON writers
- 🔄 In progress: daemon + IPC (live CDP queries, no intermediate files)  
  → Spec & review: [docs/DAEMON_IPC_ARCHITECTURE.md](docs/DAEMON_IPC_ARCHITECTURE.md)  
  → Review notes: [docs/DAEMON_IPC_ARCHITECTURE_REVIEW.md](docs/DAEMON_IPC_ARCHITECTURE_REVIEW.md)
- 🔜 Agent skill pack (`SKILL.md`) documenting recommended commands

Contributions and feedback welcome—open an issue or PR with ideas and edge cases.

---

## License

MIT
