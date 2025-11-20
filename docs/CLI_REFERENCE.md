# CLI Reference

Complete command reference for **bdg** (Browser Debugger CLI).

## Session Lifecycle

### Start a session
```bash
bdg localhost:3000
# Launches daemon in background
# Returns immediately after handshake
```

### Check session status
```bash
bdg status                      # Basic status information
bdg status --verbose            # Include Chrome diagnostics
bdg status --json               # JSON output
```

### Stop the session
```bash
bdg stop                        # Stop session only
bdg stop --kill-chrome          # Stop session and kill Chrome
# OR
bdg stop && bdg cleanup --aggressive  # Alternative way to kill Chrome
```

## Live Monitoring

### Preview collected data
```bash
bdg peek                        # Last 10 items (compact format)
bdg peek --last 50              # Show last 50 items
bdg peek --network              # Show only network requests
bdg peek --console              # Show only console messages
bdg peek --dom                  # Show DOM/A11y tree (available after stop)
bdg peek --type Document        # Filter by resource type (Document requests only)
bdg peek --type XHR,Fetch       # Multiple types (XHR or Fetch requests)
bdg peek --json                 # JSON output
bdg peek --verbose              # Verbose output (full URLs, resource types)
```

**Resource Type Filtering:**
The `--type` flag filters network requests by CDP resource type. Case-insensitive, comma-separated.

Valid types: `Document`, `Stylesheet`, `Image`, `Media`, `Font`, `Script`, `TextTrack`, `XHR`, `Fetch`, `Prefetch`, `EventSource`, `WebSocket`, `Manifest`, `SignedExchange`, `Ping`, `CSPViolationReport`, `Preflight`, `FedCM`, `Other`

**Examples:**
```bash
# Debug CSP headers on main HTML document
bdg peek --type Document --verbose

# Monitor AJAX requests only
bdg peek --type XHR,Fetch --follow

# Show all script loads
bdg peek --type Script --last 100
```

**Note:** DOM data (including A11y tree) is only captured when the session stops. During a live session, `bdg peek --dom` will show "(none)".

### Continuous monitoring
```bash
bdg tail                        # Live updates every second (like tail -f)
bdg tail --last 50              # Show last 50 items
bdg tail --network              # Show only network requests
bdg tail --console              # Show only console messages
bdg tail --interval 2000        # Custom update interval (2 seconds)
bdg tail --verbose              # Verbose output (full URLs, emojis)

# Note: 'bdg peek --follow' also works, but 'tail' has better semantics
```

### Get full details
```bash
bdg details network <requestId>     # Full request/response with bodies
bdg details console <index>         # Full console message with args
```

## DOM Commands

### Accessibility Tree Inspection

Inspect the accessibility tree exposed by Chrome DevTools Protocol.

```bash
# View full accessibility tree
bdg dom a11y tree               # Display tree (first 50 nodes, human-readable)
bdg dom a11y tree --json        # Full tree in JSON format

# Query nodes by role, name, or description
bdg dom a11y query role=button                    # Find all buttons
bdg dom a11y query name="Submit"                  # Find by accessible name
bdg dom a11y query role=button,name="Submit"      # Combine criteria (AND logic)
bdg dom a11y query description="Click to submit"  # Find by description
bdg dom a11y query --json                         # JSON output

# Describe specific element by CSS selector
bdg dom a11y describe "button[type='submit']"     # Get accessibility info for element
bdg dom a11y describe "#login-form"               # Query by ID
bdg dom a11y describe ".nav-link:first-child"     # Complex selectors supported
bdg dom a11y describe --json                      # JSON output
```

**Query Pattern Syntax:**
- `role=<value>` - Filter by ARIA role (case-insensitive)
- `name=<value>` - Filter by accessible name (case-insensitive)
- `description=<value>` - Filter by accessible description (case-insensitive)
- Combine with commas for AND logic: `role=button,name=Submit`

**Output:**
- Tree view shows role, name, description, and key properties
- Ignored nodes are automatically filtered out
- Human-readable format limited to 50 nodes (use `--json` for complete output)

### Element Inspection

Get semantic accessibility structure or raw HTML for page elements.

```bash
# Semantic output (default) - 70%+ token reduction
bdg dom get "h1"                              # Get semantic A11y representation
bdg dom get "button"                          # [Button] "Submit" (focusable)
bdg dom get "#searchInput"                    # [Searchbox] "Search" (focusable)
bdg dom get ".nav-link"                       # First matching element

# Raw HTML output
bdg dom get "h1" --raw                        # Get full HTML with attributes
bdg dom get "button" --raw --all             # Get all matching elements
bdg dom get "button" --raw --nth 2           # Get 2nd matching element
bdg dom get --raw --node-id 123              # Get by DOM nodeId

# JSON output
bdg dom get "h1" --json                       # A11y node structure as JSON
bdg dom get "h1" --raw --json                # HTML as JSON
```

**Semantic vs Raw HTML:**

| Feature | Semantic (Default) | Raw HTML (`--raw`) |
|---------|-------------------|-------------------|
| **Token Efficiency** | 70-99% reduction | Full HTML |
| **Use Case** | AI agents, automation | Debugging, inspection |
| **Format** | `[Role] "Name" (properties)` | Complete HTML with attributes |
| **Filtering** | First match only | `--all`, `--nth`, `--node-id` |

**Semantic Output Examples:**
```
[Heading L1] "Welcome"
[Button] "Submit Form" (focusable)
[Link] "Learn more" (focusable)
[Searchbox] "Search" (focusable, required)
[Navigation] "Main menu"
[Paragraph]
```

**When to use `--raw`:**
- Need exact HTML structure with classes and attributes
- Multiple elements required (`--all`)
- Specific element selection (`--nth`, `--node-id`)
- CSS/HTML debugging

**Token Efficiency:**
- Simple elements: 45-75% reduction
- Complex elements: 82-99% reduction
- See `docs/TOKEN_EFFICIENCY.md` for detailed analysis

### Element Query

Find elements by CSS selector (returns compact summary).

```bash
bdg dom query "button"                        # Find all buttons
bdg dom query ".error-message"                # Find by class
bdg dom query "#login-form input"             # Complex selectors
bdg dom query --json                          # JSON output
```

**Output:**
- Shows count and preview of matched elements
- Lists nodeId, tag, classes, and text preview
- Use results with `bdg dom get` for full details

### JavaScript Evaluation

Execute JavaScript in the page context.

```bash
bdg dom eval "document.title"                     # Evaluate expression
bdg dom eval "document.querySelector('h1').textContent"
bdg dom eval --json                               # JSON output with full Runtime.evaluate response
```

## Network Commands

### HAR Export

Export collected network requests as HAR 1.2 format (HTTP Archive).

```bash
# Export from live session
bdg network har                           # Default: ~/.bdg/capture-2025-11-19-143045.har
bdg network har myfile.har                # Custom filename (relative or absolute path)
bdg network har ~/exports/debug.har       # Absolute path

# Export after session stopped
bdg stop
bdg network har final.har                 # Reads from ~/.bdg/session.json

# JSON output (for scripting)
bdg network har --json                    # Returns metadata about exported file
```

**Output:**
- Valid HAR 1.2 format compatible with Chrome DevTools and HAR Viewer
- Includes all request/response data (URLs, methods, headers, bodies)
- Complete timing breakdown: blocked, DNS, connect, SSL, send, wait, receive
- Binary content automatically base64 encoded
- Creator and browser metadata included
- Server IP address and connection ID tracking
- Timing fields use `-1` for unknown values (HAR spec compliant)

**File Location:**
- Default: `~/.bdg/capture-YYYY-MM-DD-HHMMSS.har` (timestamped to prevent overwrites)
- Custom path: Use explicit filename argument

**Usage:**
- Drag and drop HAR file into Chrome DevTools → Network tab
- Open in online HAR Viewer: http://www.softwareishard.com/har/viewer/
- Analyze requests, headers, timings, and response bodies
- Share network captures for debugging

**Example workflow:**
```bash
# Capture session
bdg https://example.com --headless

# Export multiple snapshots during session
bdg network har snapshot1.har
# ... wait for more activity ...
bdg network har snapshot2.har

# Stop and export final
bdg stop
bdg network har final.har
```

## Maintenance

### Clean up stale sessions
```bash
bdg cleanup                     # Remove stale session files
bdg cleanup --force             # Force cleanup even if session appears active
bdg cleanup --all               # Also remove session.json output file
bdg cleanup --aggressive        # Kill all Chrome processes (uses chrome-launcher killAll)
bdg cleanup --json              # JSON output
```

## Collection Options

**Note:** All three collectors (DOM, network, console) are enabled by default.
DOM data is captured as a snapshot at session end, while network and console data stream continuously.

### Basic Options
```bash
bdg localhost:3000 --port 9223              # Custom CDP port
bdg localhost:3000 --timeout 30             # Auto-stop after timeout
bdg localhost:3000 --all                    # Include all data (disable filtering)
bdg localhost:3000 --user-data-dir ~/custom # Custom Chrome profile directory
```

### Advanced Options
```bash
# Chrome Options
bdg localhost:3000 --headless                   # Launch Chrome in headless mode
bdg localhost:3000 --chrome-ws-url <url>        # Connect to existing Chrome instance

# Output Optimization
bdg localhost:3000 --compact                    # Compact JSON (no indentation, 30% size reduction)
bdg localhost:3000 --max-body-size 10           # Set max response body size (MB, default: 5)
```

## Session Files

bdg stores session data in `~/.bdg/`:

- **daemon.pid** - Daemon process ID
- **daemon.sock** - Unix socket for IPC
- **session.meta.json** - Session metadata (Chrome PID, CDP port, target info)
- **session.json** - Final output (written on stop only)
- **chrome-profile/** - Chrome user data directory

**Key Behaviors:**
- **Only one session at a time**: Lock prevents concurrent sessions
- **Automatic cleanup**: All session files removed on stop
- **Stale session detection**: Automatically cleans up if PID is dead
- **No intermediate writes**: Data stays in memory until stop (IPC queries access live data)

## Output Format

### Success Format
```json
{
  "version": "0.5.1",
  "success": true,
  "timestamp": "2025-11-06T12:00:00.000Z",
  "duration": 45230,
  "target": {
    "url": "http://localhost:3000/dashboard",
    "title": "Dashboard"
  },
  "data": {
    "network": [...],
    "console": [...],
    "dom": {...}
  }
}
```

### Error Format
```json
{
  "version": "0.5.1",
  "success": false,
  "timestamp": "2025-11-06T12:00:00.000Z",
  "duration": 1234,
  "target": { "url": "", "title": "" },
  "data": {},
  "error": "Error message here"
}
```

See [`src/types.ts`](../src/types.ts) for complete type definitions.

## Related Documentation

- **Architecture**: [`docs/architecture/BIDIRECTIONAL_IPC.md`](architecture/BIDIRECTIONAL_IPC.md) - Daemon/worker architecture
- **Testing**: [`docs/quality/TESTING_PHILOSOPHY.md`](quality/TESTING_PHILOSOPHY.md) - Testing strategy
- **Release Process**: [`docs/RELEASE_PROCESS.md`](RELEASE_PROCESS.md) - How to release new versions
- **Docker**: [`docs/DOCKER.md`](DOCKER.md) - Running bdg in Docker containers
