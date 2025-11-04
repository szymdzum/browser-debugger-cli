# bdg CLI Cheatsheet

Quick reference for all `bdg` commands and flags.

## Table of Contents

- [Main Command](#main-command)
- [Session Management](#session-management)
- [Data Inspection](#data-inspection)
- [Common Workflows](#common-workflows)

---

## Main Command

### Basic Usage

```bash
bdg <url> [options]
```

Start browser telemetry collection. Runs until stopped with Ctrl+C or `bdg stop`.

**Examples:**

```bash
bdg localhost:3000
bdg example.com
bdg http://localhost:8080/app
bdg "localhost:3000/path?query=param"
```

---

## Options Reference

### Basic Options

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| `-p` | `--port <number>` | Chrome debugging port | 9222 |
| `-t` | `--timeout <seconds>` | Auto-stop after timeout | none |
| `-r` | `--reuse-tab` | Navigate existing tab instead of creating new | false |
| `-u` | `--user-data-dir <path>` | Chrome user data directory | ~/.bdg/chrome-profile |
| `-a` | `--all` | Include all data (disable filtering) | false |
|      | `--compact` | Use compact JSON (no indentation) | false |

**Examples:**

```bash
bdg localhost:3000 -p 9223                    # Custom port
bdg localhost:3000 -t 30                      # Auto-stop after 30s
bdg localhost:3000 -r                         # Reuse existing tab
bdg localhost:3000 -u ~/custom-profile        # Custom profile
bdg localhost:3000 -a                         # Include all data (no filtering)
bdg localhost:3000 --compact                  # Compact JSON output
```

### Chrome Configuration

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| `-L` | `--log-level <level>` | Chrome launcher log level (verbose\|info\|error\|silent) | silent |
| `-P` | `--chrome-prefs <json>` | Chrome preferences as inline JSON | none |
| `-F` | `--chrome-prefs-file <path>` | Path to JSON file with Chrome preferences | none |
| `-G` | `--chrome-flags <flags...>` | Additional Chrome command-line flags | none |

**Examples:**

```bash
bdg localhost:3000 -L verbose                                     # Verbose Chrome logging
bdg localhost:3000 -P '{"download.default_directory":"/tmp"}'    # Inline prefs
bdg localhost:3000 -F ./chrome-prefs.json                        # Prefs from file
bdg localhost:3000 -G --disable-gpu --no-sandbox                 # Chrome flags
```

### Connection Settings

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| `-I` | `--connection-poll-interval <ms>` | Milliseconds between CDP readiness checks | 500 |
| `-R` | `--max-connection-retries <count>` | Maximum retry attempts before failing | 50 |
| `-S` | `--port-strict` | Fail if port is already in use | false |

**Examples:**

```bash
bdg localhost:3000 -I 1000                    # Poll every 1 second
bdg localhost:3000 -R 100                     # Retry up to 100 times
bdg localhost:3000 -S                         # Strict port mode
```

### Data Collection

| Flag | Long Form | Description | Mode |
|------|-----------|-------------|------|
| `-d` | `--dom` | Enable only DOM collector | Additive |
| `-n` | `--network` | Enable only network collector | Additive |
| `-c` | `--console` | Enable only console collector | Additive |
| `-D` | `--skip-dom` | Disable DOM collector | Subtractive |
| `-N` | `--skip-network` | Disable network collector | Subtractive |
| `-C` | `--skip-console` | Disable console collector | Subtractive |

**Additive Mode** (select specific collectors):

```bash
bdg localhost:3000 -d                         # DOM only
bdg localhost:3000 -n                         # Network only
bdg localhost:3000 -c                         # Console only
bdg localhost:3000 -d -n                      # DOM and network only
bdg localhost:3000 -d -c                      # DOM and console only
bdg localhost:3000 -n -c                      # Network and console only
```

**Subtractive Mode** (disable specific collectors):

```bash
bdg localhost:3000 -D                         # Network and console (no DOM)
bdg localhost:3000 -N                         # DOM and console (no network)
bdg localhost:3000 -C                         # DOM and network (no console)
bdg localhost:3000 -D -N                      # Console only
bdg localhost:3000 -D -C                      # Network only
bdg localhost:3000 -N -C                      # DOM only
```

### Network Optimization

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| `-B` | `--fetch-all-bodies` | Fetch all response bodies (override auto-optimization) | false |
| `-i` | `--fetch-bodies-include <patterns>` | Only fetch bodies matching patterns (trumps exclude) | none |
| `-x` | `--fetch-bodies-exclude <patterns>` | Additional patterns to exclude from body fetching | none |
| `-y` | `--network-include <patterns>` | Only capture URLs matching patterns (trumps exclude) | none |
| `-z` | `--network-exclude <patterns>` | Additional URL patterns to exclude | none |
| `-m` | `--max-body-size <megabytes>` | Maximum response body size in MB | 5 |

**Pattern Syntax:**
- Use wildcards (`*`) to match any characters
- Patterns are comma-separated
- Include patterns always trump exclude patterns

**Examples:**

```bash
# Fetch all bodies (disable auto-optimization)
bdg localhost:3000 -B

# Only fetch API and GraphQL responses
bdg localhost:3000 -i "*/api/*,*/graphql"

# Exclude tracking pixels
bdg localhost:3000 -x "*tracking*,*analytics*"

# Only capture API requests
bdg localhost:3000 -y "api.example.com"

# Exclude analytics domains
bdg localhost:3000 -z "*analytics*,*ads*,*tracking*"

# Increase max body size to 10MB
bdg localhost:3000 -m 10

# Combined optimization
bdg localhost:3000 -i "*/api/*" -z "*analytics*" -m 20
```

---

## Session Management

### status

Check if a session is running and view collection statistics.

```bash
bdg status [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--verbose` | Include Chrome diagnostics (binary path, installations) |
| `--json` | Output in JSON format |

**Examples:**

```bash
bdg status                                    # Basic status
bdg status --verbose                          # With Chrome diagnostics
bdg status --json                             # JSON output
```

### stop

Stop active session and free ports.

```bash
bdg stop [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Output in JSON format |

**Examples:**

```bash
bdg stop                                      # Stop session
bdg stop --json                               # JSON output
```

### cleanup

Clean up stale session files.

```bash
bdg cleanup [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--force` | Force cleanup even if session appears active |
| `--aggressive` | Kill all Chrome processes (uses chrome-launcher killAll) |
| `--all` | Also remove session.json output file |

**Examples:**

```bash
bdg cleanup                                   # Clean stale files
bdg cleanup --force                           # Force cleanup
bdg cleanup --aggressive                      # Kill all Chrome processes
bdg cleanup --all                             # Clean everything including output
```

---

## Data Inspection

### peek

Preview collected data without stopping the session.

```bash
bdg peek [options]
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--last <count>` | Number of items to show | 10 |
| `--network` | Show only network requests | false |
| `--console` | Show only console messages | false |
| `--follow` | Live updates every second | false |
| `--json` | Output in JSON format | false |
| `--verbose` | Verbose output (full URLs, emojis) | false |

**Examples:**

```bash
bdg peek                                      # Last 10 items (compact)
bdg peek --last 50                            # Last 50 items
bdg peek --network                            # Only network requests
bdg peek --console                            # Only console messages
bdg peek --follow                             # Live updates
bdg peek --verbose                            # Full URLs and emojis
bdg peek --json                               # JSON output
```

### details

Get detailed information for a specific request or console message.

```bash
bdg details <type> <id> [options]
```

**Arguments:**

- `type`: `network` or `console`
- `id`: Request ID (for network) or index (for console)

**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Output in JSON format |

**Examples:**

```bash
bdg details network 12345.678                 # Full request/response details
bdg details console 5                         # Full console message
bdg details network 12345.678 --json          # JSON output
```

### query

Execute JavaScript in the active session for live debugging.

```bash
bdg query <script> [options]
```

**Arguments:**

- `script`: JavaScript code to execute in the browser

**Options:**

| Flag | Description |
|------|-------------|
| `--json` | Output in JSON format |

**Examples:**

```bash
bdg query "document.title"                    # Get page title
bdg query "window.location.href"              # Get current URL
bdg query "document.querySelectorAll('a').length"  # Count links
bdg query "JSON.stringify(localStorage)"      # Dump localStorage
```

---

## Common Workflows

### Quick Start

```bash
# Start collection
bdg localhost:3000

# In another terminal: check status
bdg status

# In another terminal: preview data
bdg peek --last 20

# When done: stop
bdg stop
```

### Targeted Collection

```bash
# Only capture network and console (no DOM)
bdg localhost:3000 -n -c

# Only capture API calls
bdg localhost:3000 -y "api.example.com" -D -C

# Capture everything except analytics
bdg localhost:3000 -z "*analytics*,*tracking*,*ads*"
```

### Debugging Workflow

```bash
# Start collection
bdg localhost:3000 -t 60

# In another terminal: live monitoring
bdg peek --follow --verbose

# Get specific request details
bdg details network 12345.678

# Query live DOM
bdg query "document.querySelector('.error')?.textContent"

# Stop when done
bdg stop
```

### Performance Optimization

```bash
# Minimal data collection (API only, no bodies, compact output)
bdg localhost:3000 \
  -y "*/api/*" \
  -x "*" \
  --compact \
  -D \
  -C
```

### Agent/Automation Usage

```bash
# Start collection in background
bdg localhost:3000 &
BDG_PID=$!

# User interacts with browser...

# Stop and capture output
bdg stop > analysis.json

# Analyze with jq
jq '.data.console[] | select(.type == "error")' analysis.json
```

### Custom Chrome Configuration

```bash
# Custom profile with specific prefs and flags
bdg localhost:3000 \
  -u ~/custom-profile \
  -P '{"download.default_directory":"/tmp"}' \
  -G --disable-gpu --no-sandbox \
  -L verbose
```

---

## Breaking Changes

### v0.0.1-alpha.0

- **`-c` flag changed**: Previously `--compact`, now `--console`
  - Use long form `--compact` for compact JSON output
  - Use `-c` for console-only collection

---

## Tips

1. **Combine short flags**: `bdg example.com -dnp 9223` (dom, network, port)
2. **Use quotes for URLs with special chars**: `bdg "localhost:3000/path?query=value"`
3. **Include patterns trump exclude**: `-i "*/api/*" -x "*"` captures only API calls
4. **Compact mode saves 30% disk space**: Add `--compact` for production use
5. **Verbose peek for humans, default for agents**: `--verbose` adds emojis and full URLs
6. **Follow mode for live debugging**: `bdg peek --follow --verbose`
7. **Query for live inspection**: `bdg query "document.title"` works while collecting

---

## Getting Help

```bash
bdg --help                                    # General help
bdg --version                                 # Show version
bdg status --help                             # Command-specific help
```

For more information, see the full documentation in the README.
