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

**JSON Output (jq-friendly):**

The `--json` output returns nodes as an array for natural jq filtering:

```bash
# Get first node
bdg dom a11y tree --json | jq '.nodes[0]'

# Find all checkboxes
bdg dom a11y tree --json | jq '[.nodes[] | select(.role == "checkbox")]'

# Find by name pattern
bdg dom a11y tree --json | jq '[.nodes[] | select(.name | test("submit"; "i"))]'

# Get roles and names only
bdg dom a11y tree --json | jq '.nodes[] | {role, name}'
```

**Shell Quote Handling:**

Attribute selectors with quotes can be tricky due to shell escaping. If you see "Element not found" with an attribute selector, the shell may have stripped quotes.

Recommended pattern for attribute selectors:
```bash
# Step 1: Query first (caches results)
bdg dom query '[data-test-id="marketing-consent"]'

# Step 2: Use index to inspect (0-based)
bdg dom a11y describe 0
```

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
```text
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

**Shell Quote Handling:**

JavaScript expressions with quotes require careful escaping. If you see a SyntaxError, the shell may have stripped quotes.

```bash
# Recommended: Use single quotes around the script
bdg dom eval 'document.querySelector("h1").textContent'

# If script contains single quotes, use double quotes outside
bdg dom eval "document.querySelector('h1').textContent"

# For complex scripts, use heredoc
bdg dom eval "$(cat <<'EOF'
(() => {
  const el = document.querySelector("input");
  return el ? el.value : null;
})()
EOF
)"
```

When errors occur, bdg shows the script as received to help diagnose shell escaping issues:
```text
Error: ReferenceError: input is not defined
Script received: document.querySelector(input).value

Shell quote damage detected:
  querySelector(input) - quotes stripped by shell

Try: bdg dom eval 'document.querySelector("input")'
```

### Form Discovery

Discover forms on the page with semantic labels, current values, validation state, and suggested commands.

```bash
# Basic discovery (auto-selects most relevant form)
bdg dom form

# JSON output for programmatic use
bdg dom form --json

# Show all forms on page
bdg dom form --all

# Quick scan (names, types, required only)
bdg dom form --brief
```

**Human Output:**
```sql
FORMS DISCOVERED: 1
══════════════════════════════════════════════════════════════════════

Form: "Create Account" (step 2 of 3)
──────────────────────────────────────────────────────────────────────
   #  Type         Label                    Value                Status
──────────────────────────────────────────────────────────────────────
   0  email        Email address*           empty                required
   1  password     Password*                empty                required
   2  password     Confirm password*        empty                required
   3  checkbox     Newsletter               unchecked            ok
   4  checkbox     Terms & Conditions*      unchecked            required
──────────────────────────────────────────────────────────────────────
   5  button       Back                     (secondary)          enabled
   6  button       Create Account           (primary)            enabled
══════════════════════════════════════════════════════════════════════
Summary: 0/5 fields filled | 3 required remaining | NOT ready

Remaining:
  bdg dom fill 0 "<value>"                   # Email address
  bdg dom fill 1 "<value>"                   # Password
  bdg dom click 4                            # Terms & Conditions
```

**JSON Output Structure:**
```json
{
  "formCount": 1,
  "selectedForm": 0,
  "forms": [{
    "index": 0,
    "name": "Create Account",
    "step": { "current": 2, "total": 3 },
    "fields": [...],
    "buttons": [...],
    "summary": {
      "totalFields": 5,
      "filledFields": 0,
      "requiredRemaining": 3,
      "readyToSubmit": false,
      "blockers": [...]
    }
  }]
}
```

**Key Features:**
- **Semantic labels**: Extracts labels from `<label>`, `aria-label`, `placeholder`, etc.
- **State detection**: Shows current values, checked/unchecked state
- **Validation**: Detects HTML5 and custom validation errors
- **Custom components**: Flags non-native inputs with interaction warnings
- **Ready-to-use commands**: Shows exact commands to fill each field

**Workflow Example:**
```bash
# 1. Discover form structure
bdg dom form --json | jq '.forms[0].summary.readyToSubmit'

# 2. Fill required fields using provided indices
bdg dom fill 0 "user@example.com"
bdg dom fill 1 "SecurePass123"
bdg dom click 4                              # Accept terms

# 3. Check progress
bdg dom form

# 4. Submit when ready
bdg dom click 6                              # Primary submit button
```

### Form Interaction

Interact with page elements using React-compatible events. All interaction commands automatically wait for network stability after the action (disable with `--no-wait`).

```bash
# Fill inputs
bdg dom fill "#username" "admin"
bdg dom fill "input[type='password']" "secret" --no-blur
bdg dom fill "#search" "query" --index 1          # Use 1-based index for multiple matches
bdg dom fill 0 "value"                            # Use cached query index (0-based)

# Click elements
bdg dom click "#login-btn"
bdg dom click "button.submit" --index 2
bdg dom click 0                                   # Use cached query index (0-based)
bdg dom click "#fast-btn" --no-wait               # Skip network stability wait

# Press keys (for Enter-to-submit, keyboard navigation)
bdg dom pressKey ".new-todo" Enter                # TodoMVC pattern: submit with Enter
bdg dom pressKey "#search" Enter                  # Search box submit
bdg dom pressKey "input" Tab                      # Tab to next field
bdg dom pressKey "input" ArrowDown --times 3     # Navigate autocomplete
bdg dom pressKey "body" Escape                    # Close modal/dialog
bdg dom pressKey "textarea" a --modifiers ctrl   # Select all (Ctrl+A)
bdg dom pressKey 0 Enter                          # Use cached query index

# Submit forms (smart wait for navigation/network)
bdg dom submit "#login-form"
bdg dom submit "#login-form" --wait-network 2000  # Wait 2s for network idle
bdg dom submit "#login-form" --wait-navigation    # Wait for page navigation

# Scroll page (waits for lazy-loaded content)
bdg dom scroll "footer"                           # Scroll element into view
bdg dom scroll --down 500                         # Scroll down by pixels
bdg dom scroll --bottom                           # Scroll to page bottom
bdg dom scroll --top                              # Scroll to page top
bdg dom scroll "li.item" --index 5               # Scroll to nth match
```

**Press Key Options:**
| Option | Description |
|--------|-------------|
| `--index <n>` | Element index if selector matches multiple (1-based) |
| `--times <n>` | Press key multiple times (default: 1) |
| `--modifiers <mods>` | Modifier keys: shift,ctrl,alt,meta (comma-separated) |
| `--no-wait` | Skip network stability check |

**Supported Keys:**
- Navigation: `Enter`, `Tab`, `Escape`, `Space`, `Backspace`, `Delete`
- Arrows: `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`
- Page: `Home`, `End`, `PageUp`, `PageDown`
- Letters: `a`-`z`
- Digits: `0`-`9`
- Function: `F1`-`F12`

### Screen Capture

Capture screenshots of the current page. By default, images are auto-resized to fit within Claude Vision's optimal token budget (~1,600 tokens, 1568px max edge).

```bash
# Capture full page (default, auto-resized for Claude Vision)
bdg dom screenshot output.png

# Capture viewport only
bdg dom screenshot visible.jpg --format jpeg --no-full-page

# Full resolution (disable auto-resize)
bdg dom screenshot full-res.png --no-resize

# Scroll to element before capture (captures viewport)
bdg dom screenshot footer.png --scroll "footer"

# Custom quality
bdg dom screenshot high-res.jpg --format jpeg --quality 100
```

**Auto-resize behavior:**
- Images exceeding 1568px on longest edge are scaled down
- Tall pages (aspect ratio > 3:1) automatically capture viewport only
- Use `--no-resize` for full resolution when needed
- Token estimates account for device pixel ratio (Retina displays)

## Network Commands

### List Network Requests

List and filter captured network requests using Chrome DevTools-compatible filter syntax.

```bash
# List recent requests (default: last 100)
bdg network list

# Show all requests
bdg network list --last 0

# Filter by status code
bdg network list --filter "status-code:>=400"      # Errors (4xx, 5xx)
bdg network list --filter "status-code:200"        # Only 200 OK
bdg network list --filter "status-code:>=500"      # Server errors only

# Filter by domain (supports wildcards)
bdg network list --filter "domain:api.*"           # API subdomain
bdg network list --filter "domain:*.example.com"   # All subdomains
bdg network list --filter "!domain:cdn.*"          # Exclude CDN

# Filter by HTTP method
bdg network list --filter "method:POST"
bdg network list --filter "method:DELETE"

# Filter by MIME type
bdg network list --filter "mime-type:application/json"
bdg network list --filter "mime-type:text/html"

# Filter by response size
bdg network list --filter "larger-than:1MB"
bdg network list --filter "larger-than:100KB"

# Filter by response headers
bdg network list --filter "has-response-header:set-cookie"
bdg network list --filter "has-response-header:content-security-policy"

# Filter by state
bdg network list --filter "is:from-cache"          # Cached responses
bdg network list --filter "is:running"             # In-progress requests

# Filter by URL scheme
bdg network list --filter "scheme:https"
bdg network list --filter "scheme:wss"             # WebSocket secure

# Combine multiple filters (AND logic)
bdg network list --filter "domain:api.* status-code:>=400"
bdg network list --filter "method:POST mime-type:application/json"

# Use presets for common filters
bdg network list --preset errors                   # status-code:>=400
bdg network list --preset api                      # resource-type:XHR,Fetch
bdg network list --preset large                    # larger-than:1MB
bdg network list --preset cached                   # is:from-cache
bdg network list --preset documents                # resource-type:Document
bdg network list --preset media                    # resource-type:Image,Media
bdg network list --preset scripts                  # resource-type:Script
bdg network list --preset pending                  # is:running

# Combine preset with additional filters
bdg network list --preset api --filter "status-code:>=400"

# Filter by resource type (alternative to --filter)
bdg network list --type XHR,Fetch
bdg network list --type Document,Script

# Stream in real-time
bdg network list --follow
bdg network list --follow --filter "status-code:>=400"

# Verbose output (full URLs)
bdg network list --verbose

# JSON output
bdg network list --json
```

**Filter Syntax Reference:**

| Filter | Description | Examples |
|--------|-------------|----------|
| `status-code:<op><n>` | HTTP status code | `status-code:404`, `status-code:>=400` |
| `domain:<pattern>` | Domain with wildcards | `domain:api.*`, `domain:*.example.com` |
| `method:<method>` | HTTP method | `method:POST`, `method:DELETE` |
| `mime-type:<type>` | Response MIME type | `mime-type:application/json` |
| `resource-type:<types>` | CDP resource type(s) | `resource-type:XHR,Fetch` |
| `larger-than:<size>` | Response size threshold | `larger-than:1MB`, `larger-than:100KB` |
| `has-response-header:<name>` | Has specific header | `has-response-header:set-cookie` |
| `is:from-cache` | Cached responses | |
| `is:running` | In-progress requests | |
| `scheme:<scheme>` | URL scheme | `scheme:https`, `scheme:wss` |

**Operators (for status-code and larger-than):**
- `=` - Equal (default)
- `>=` - Greater than or equal
- `<=` - Less than or equal
- `>` - Greater than
- `<` - Less than

**Negation:**
- Use `!` prefix to exclude matches: `!domain:cdn.*`, `!method:GET`
- Note: Use `!` instead of `-` to avoid CLI conflicts

**Size Units:**
- `B` - Bytes
- `KB` - Kilobytes (1024 bytes)
- `MB` - Megabytes
- `GB` - Gigabytes

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

### HTTP Headers Inspection

Inspect HTTP request and response headers from captured network requests.

```bash
# Show headers from main page navigation (smart default)
bdg network headers

# Show headers from specific request ID
bdg peek --json | jq -r '.data.preview.data.network[0].requestId'
bdg network headers <request-id>

# Filter to specific header (case-insensitive)
bdg network headers --header content-security-policy
bdg network headers --header Content-Type

# Combine request ID and header filter
bdg network headers <request-id> --header content-type

# JSON output for scripting
bdg network headers --json
bdg network headers --json | jq '.data.responseHeaders["content-security-policy"]'
```

**Smart Defaults:**
- Without arguments, shows headers from the main page navigation (most recent Document request)
- Fallback: If no Document request found, uses most recent request with headers
- "Just works" philosophy - most common use case requires no configuration

**Output:**
- **Human-readable format** (default):
  - URL of the request
  - Response headers (alphabetically sorted)
  - Request headers (alphabetically sorted)
  - Request ID for correlation with `bdg peek` output
- **JSON format** (`--json` flag):
  - Structured data with `url`, `requestId`, `requestHeaders`, `responseHeaders`
  - Ideal for scripting and automation

**Use Cases:**
- Security auditing (CSP, HSTS, X-Frame-Options headers)
- CORS troubleshooting (Access-Control-* headers)
- Caching analysis (Cache-Control, ETag, Last-Modified)
- Content negotiation (Accept, Content-Type, Content-Encoding)

**Example workflow:**
```bash
# Start session
bdg https://example.com

# Quick check of main page security headers
bdg network headers --header content-security-policy
bdg network headers --header strict-transport-security

# Inspect specific request (XHR, fetch, etc.)
bdg peek --json | jq -r '.data.preview.data.network[] | select(.url | contains("api")) | .requestId'
bdg network headers <api-request-id>

# Export all headers for analysis
bdg network headers --json > headers.json

# Stop session
bdg stop
```

### Cookie Inspection

List cookies for the current page or a specific URL.

```bash
# List all cookies
bdg network getCookies

# Filter by URL
bdg network getCookies --url https://api.example.com

# JSON output
bdg network getCookies --json
```

## Console Commands

### Smart Console Inspection

Inspect console messages with smart error/warning prioritization and deduplication.

```bash
# Smart summary (default) - current page, errors/warnings deduplicated
bdg console

# Show messages from all page loads (not just current)
bdg console --history
bdg console -H

# List all messages chronologically
bdg console --list
bdg console -l

# Limit to last N messages
bdg console --last 50

# Stream console messages in real-time
bdg console --follow
bdg console -f

# JSON output with summary statistics
bdg console --json
```

**Default behavior:**
- Shows messages from **current page load only** (most recent navigation)
- Errors deduplicated with occurrence count and source location
- Warnings listed with source location
- Summary count of info/debug messages
- **Objects automatically expanded** with nested structure visible

Use `--history` to see messages from all page loads during the session.

**Object Expansion:**

Console messages with objects are automatically expanded to show nested values:

```text
# Before (without expansion)
[log] User: [object Object]

# After (with expansion)
[log] User: {name: "John", roles: ["admin", "user"]}
```

- Nested objects expanded up to 3 levels deep
- Arrays show actual contents: `[1, 2, 3]` instead of `Array(3)`
- Large objects truncated with `…` indicator
- Special types formatted: Date, RegExp, Error, Map, Set

## CDP Commands

### Protocol Introspection & Execution

Directly execute Chrome DevTools Protocol (CDP) methods and explore the available API surface.

```bash
# List all available domains
bdg cdp --list

# List methods in a domain
bdg cdp Network --list

# Search for methods by keyword
bdg cdp --search cookie

# Describe a specific method (parameters and return types)
bdg cdp Network.getCookies --describe

# Execute a method
bdg cdp Network.getCookies
bdg cdp Page.navigate --params '{"url": "https://example.com"}'
```

**Event-Based Domains:**

Some CDP domains use event-based reporting rather than synchronous responses. When methods return empty results, bdg provides contextual hints:

```bash
bdg cdp Audits.checkContrast
# This method triggers contrast analysis but results are sent via Audits.issueAdded events.
# Alternative: bdg dom eval with getComputedStyle() for direct contrast checking.
# {
#   "method": "Audits.checkContrast",
#   "result": {}
# }
```

The `--describe` output includes domain notes for event-based APIs:

```bash
bdg cdp Audits --describe
# {
#   "type": "domain",
#   "domain": "Audits",
#   "note": "Event-based domain. Results arrive via events (e.g., Audits.issueAdded)..."
# }
```

**Domains with Event-Based Patterns:**

| Domain | Behavior | Alternative |
|--------|----------|-------------|
| Audits | Issues via `Audits.issueAdded` events | `bdg dom eval` with `getComputedStyle()` |
| Profiler | Data after `Profiler.stop` | Call start, perform actions, then stop |
| HeapProfiler | Events after `takeHeapSnapshot` | Collect events or use snapshots |
| Tracing | Data via `Tracing.dataCollected` | Call start, perform actions, then end |
| Overlay | Visual only, returns empty | Use `Overlay.hideHighlight` to clear |

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
