# Browser Debugger CLI

Lightweight CLI that streams Chrome DevTools Protocol telemetry (DOM, network, console) for humans and agents.

---

## Installation

```bash
npm install -g browser-debugger-cli
```

---

## Quick Start

```bash
# Start session (open example.com in Chrome)
bdg example.com

# [bdg] Session started via daemon
#  Available commands:
#   bdg dom              DOM inspection
#   bdg console          Console inspection
#   bdg network          Network inspection
#   bdg stop             Stop session

bdg dom query "document.title"
# 'Example Domain'
```

Telemetry (network, console, DOM) is emitted to stdout when you stop the session. Pipe it into JSON-aware tools for analysis:

```bash
bdg stop > telemetry.json
jq '.data.console[] | select(.type == "error")' telemetry.json
```

---

## License

MIT – see [LICENSE](LICENSE) for details.
