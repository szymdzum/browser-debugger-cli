# CLI Reference

Complete command reference for **bdg** (Browser Debugger CLI).

## Session Lifecycle

### Start a session
```bash
bdg localhost:3000
# Launches daemon in background
# Returns immediately after handshake

bdg https://example.com --chrome-flags "--ignore-certificate-errors"
BDG_CHROME_FLAGS="--ignore-certificate-errors" bdg https://localhost:5173   # Same, via environment

bdg localhost:3000 --viewport 1280x800       # Exact viewport (CSS px) for the whole session
bdg localhost:3000 --color-scheme dark       # Emulate prefers-color-scheme: light or dark
```

The start output is a few lines: the target, notices (session name, HTTP error, auto-stop), the most useful next commands and a pointer to `bdg --help`. `-q` prints one line.

- `--viewport <WxH>` (e.g. `1280x800`; `X`, `×` and `,` work too, each side 1-10000) gives the page exactly that viewport for the session, through navigations and reloads (`Emulation.setDeviceMetricsOverride` at the display's pixel ratio). A launched Chrome also opens its window at that size, so tabs the page opens get it too. It works with `--chrome-ws-url`: the override belongs to the session's connection and Chrome drops it when the session ends. Without it, a launched Chrome opens a 1920×1080 window (the viewport is smaller by the scrollbar, and by the browser UI in a visible window). Invalid values exit 81
- `--color-scheme light|dark` emulates `prefers-color-scheme` for the session (`Emulation.setEmulatedMedia`). Without it the page sees the system setting: headless Chrome follows the OS, so a dark OS renders dark pages. Other values exit 81 with a suggestion
- `bdg status` shows the viewport and color scheme the page renders with (`Viewport: 1265×800 (--viewport 1280x800)`, the layout viewport without the scrollbar; `Color scheme: dark (system setting)`); JSON has them in `pageState` (and the start options as `viewport` / `colorScheme`)

A URL that cannot be loaded at all (DNS failure, connection refused, missing file) fails with exit code 80; a page that loads with an HTTP error still starts the session and warns about the status.

A page that has not finished loading when the start returns (the start waits about 2 s; e.g. a script whose server never answers) still starts the session (exit 0) with a warning naming up to 3 requests it waits on, load-blocking ones (scripts, styles, images, frames) first:

```text
⚠ The page is still loading (document.readyState: loading); waiting on: GET code.jquery.com/ui/1.13.2/jquery-ui.js (pending 2s). Elements may be missing until it finishes: bdg dom wait <selector> waits for one
```

JSON adds `data.loading: { readyState, pending: [{ method, url, resourceType?, pendingMs }], pendingCount }` (absent once the document is complete). `bdg page navigate`/`reload`/`back`/`forward` report the same (`⚠` line, `data.loading`). While the page is still loading, "not found" errors (`dom query`, `get`, `layout`, `click`, `fill` and the other actions, `eval --frame`) and an empty `dom frames` say so and suggest `bdg dom wait` (one extra `document.readyState` check, only when something was not found).

### Check session status
```bash
bdg status                      # Basic status information
bdg status --verbose            # Include the Chrome executable, mode and profile
bdg status --json               # JSON output
```

### Stop the session
```bash
bdg stop                        # Stop session (closes Chrome launched by bdg)
bdg stop --kill-chrome          # Kept for compatibility (no additional effect)
```

### Multiple sessions
Several agents on one machine can each run their own session: a named session has its own daemon, Chrome, profile, CDP port and files.

```bash
bdg localhost:3000 --session agent-1        # Start a named session
BDG_SESSION=agent-2 bdg localhost:5173      # Same, via environment
bdg --session agent-1 peek                  # --session goes before or after the subcommand
bdg dom eval "document.title" --session agent-1
BDG_SESSION=agent-2 bdg status              # Status shows the session name and its port
bdg sessions                                # List sessions (name, state, port, PID, URL), incl. crashed ones
bdg stop --session agent-1                  # Stops agent-1 only
bdg cleanup --session agent-2               # Cleans up agent-2 only
bdg cleanup --session agent-2 --purge       # ... and deletes its directory (Chrome profile, logs)
```

- **Selection**: `--session <name>` (accepted by every command) wins over `BDG_SESSION`; without either, commands use the default session as before. Names are 1-40 letters, digits, `-` or `_`, starting with a letter or digit, so `--session --json` is an error instead of a session named `--json` (exit 81 otherwise)
- **Case**: names are case-insensitive and stored lower-cased: `--session ALPHA` is the session `alpha` (same directory, listed and shown as `alpha`) on every file system
- **Hints**: the hints, suggestions and errors of a named session carry `--session <name>` (`bdg stop --session agent-1`, `No active session "agent-1"`), so copying them never acts on the default session
- **Directories**: a named session lives in `~/.bdg/sessions/<name>/`. `BDG_SESSION_DIR` moves the base directory: the default session uses `$BDG_SESSION_DIR` itself (unchanged) and named sessions `$BDG_SESSION_DIR/sessions/<name>/`. The daemon socket path (`<dir>/daemon.sock`) must fit the OS limit for Unix sockets with room for a temporary `.<pid>` suffix: at most 95 bytes on macOS, 99 on Linux. A longer path is refused with exit 81, for the default session too; the error blames the directory when even a one-letter name would not fit, and the name otherwise
- **Removing a session**: a stopped named session keeps its directory (Chrome profile of ~60 MB, logs, `port.txt`) for its next start. `bdg cleanup --session <name> --purge` deletes it (add `--force` to stop a running one first); `--purge` needs `--session`, and keeps the directory (exit 90) if the daemon still answers, cleanup reported a problem, or the session's Chrome has not exited after cleanup
- **Ports**: without `--port`, a named session takes the first free port from 9223 upwards that no other running session has claimed (9222 is left to the default session), and keeps it in its `port.txt` for the next start. Sessions starting at the same time never pick the same port, also across different `BDG_SESSION_DIR`s (claims and the selection lock live in a per-user directory under the OS temp directory). bdg only connects to the Chrome it launched: if another process answers on the port, an automatically chosen port is replaced (up to 3 tries) and an explicit `--port` fails with exit 100. The default session keeps choosing from 9222
- **Independence**: `stop`, `cleanup` and every other command act on the selected session only; `bdg cleanup` without `--session` cleans the default session, as before
- **Crashed sessions**: `bdg sessions` also lists sessions whose daemon died: `crashed` while the Chrome bdg launched for them still runs (JSON has its `chromePid`), `stale` when only their files are left (a daemon that runs but has not opened its socket yet is `starting`). Both come with the command that cleans them up (`cleanup` in JSON, e.g. `bdg cleanup --session p3`). A directory made by an earlier build whose name differs only in case (`ALPHA`) is listed as the session `--session alpha` reaches when that is the same directory (case-insensitive file systems), with the usual `bdg cleanup --session alpha`; directories `--session` cannot reach (`--json`, or `ALPHA` on a case-sensitive file system) are listed as `stale` with an `rm -rf <path>` to remove them by hand
- **Attaching**: `--chrome-ws-url` refuses (exit 90) a Chrome that another running bdg session launched (stopping that session would close it), and a tab another session is attached to; another tab of a shared Chrome can be attached with its page URL from `/json/list`. Sessions of this base directory are checked, and sessions of other `BDG_SESSION_DIR`s that claimed a port

## Live Monitoring

### Preview collected data
```bash
bdg peek                        # Last 10 items (compact format)
bdg peek --last 50              # Show last 50 items
bdg peek --network              # Show only network requests
bdg peek --console              # Show only console messages
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

**Note:** `peek` shows network and console data. For the page structure use `bdg dom a11y tree` (accessibility tree) or `bdg dom query`.

### Continuous monitoring
```bash
bdg tail                        # Live updates every second (like tail -f)
bdg tail --last 50              # Show last 50 items
bdg tail --network              # Show only network requests
bdg tail --console              # Show only console messages
bdg tail --interval 2000        # Custom update interval (2 seconds)
bdg tail --verbose              # Verbose output (full URLs, resource and MIME types)

# Note: 'bdg peek --follow' also works, but 'tail' has better semantics
```

### Get full details
```bash
bdg details network <requestId>     # Full request/response with bodies
bdg details console <index>         # Full console message with args
```

Binary response bodies (images, fonts) are only captured in sessions started with `--all`; in `--json` output they are base64 with `responseBodyBase64: true`.

## DOM Commands

### Selectors

DOM commands (`query`, `get`, `click`, `fill`, `hover`, `pressKey`, `scroll`, `submit`, `screenshot --selector/--scroll`, `a11y describe`) take CSS selectors and search the page like a user sees it: the document, open shadow roots and same-origin iframes.

Three Playwright-style filters can be added to an element of a selector (of each selector in a list), alone or combined:

| Filter | Keeps elements whose... |
|--------|-------------------------|
| `:has-text("text")` | text (whitespace collapsed) contains `text`, case-insensitive; also matches ancestors, so give an element selector. Empty text is rejected (exit 81) |
| `:text-is("text")` | text (trimmed, whitespace collapsed) is exactly `text`, case-sensitive |
| `:visible` | is rendered, has a non-empty box and `visibility: visible` (not `display:none` or inside it, not inside a closed `<details>` or under `content-visibility: hidden`, not zero-size); like Playwright, `opacity: 0` still counts as visible |

The text is the rendered text (`innerText`) of a visible element and its `textContent` when it is hidden (`display: none`, `visibility: hidden`), so, like Playwright, text filters match hidden elements too: add `:visible` to leave them out. Button inputs (`input[type=submit|button|reset]`) match by their value. When a selector with `:visible` matches nothing, the error says how many elements match without it.

```bash
bdg dom click 'button:has-text("Save")'            # Button containing "Save"
bdg dom click 'nav a:text-is("Home")'              # Link whose text is exactly "Home"
bdg dom query 'li:visible'                         # Only rendered list items
bdg dom fill 'input[name="q"]:visible' "shoes"     # The visible one of several inputs
bdg dom query '.item:has-text("x"):visible, button:has-text("Load more")'
```

**Scoped to a row or label.** A filter on an earlier element of the selector scopes the rest: the part after it is matched inside each element that passes the filter. This reaches the control in the row or label that holds the text. Only a descendant (space) or child (`>`) combinator can follow a filtered element (`+`/`~` exit 81). Filters also work inside `:has()`, which tests what an element contains:

```bash
bdg dom click 'li:has-text("Write report") .toggle'           # The checkbox in the row saying "Write report"
bdg dom click 'li:has(label:text-is("Write report")) .toggle' # Same, by the exact label text
bdg dom fill 'label:has-text("Customer name") input' "Ada"    # The input inside that label
bdg dom click 'tr:text-is("Ada Lovelace") > td button'        # A button in a table row
```

A descendant step after a filter (and a `:has()` with filters) also searches the open shadow roots under the element, with the whole step inside one shadow tree (`my-card:has-text("Pro") button` finds a button in the card's shadow root); a child step (`>`) stays in the element's own tree. Matches come in document order, each once. Inside other pseudo-classes (`:not(:visible)`, `:is(a:has-text("x"))`) or after a sibling combinator inside `:has()` (`:has(+ a:visible)`) the filters are rejected with exit 81; a `:has()` with filters is already relative, so write `:has(> a:visible)`, not `:has(:scope > a:visible)`. Text may be double- or single-quoted (escape a quote inside with `\`) or unquoted (`:has-text(Save)`). Other Playwright syntax (`:text()`, `text=…`, `>>`) is not supported.

**Labels stand for their control.** `dom fill`, `dom click` (and `--double`) and `dom pressKey` on a `<label>` act on its form control (`label.control`: the `for` target or the control inside it), like Playwright; the result's element type says so (`input (via label)`). A click goes to the label itself when the control is hidden or transparent (custom checkboxes), which activates the control the same way. Filling a label without a control exits 81 and suggests `bdg dom a11y query 'name=…'` or `bdg dom form`.

```bash
bdg dom fill 'label:has-text("Customer name")' "Ada"   # Fills the field the label names
bdg dom click 'label:text-is("Remember me")'            # Checks the checkbox
```

### Accessibility Tree Inspection

Inspect the accessibility tree exposed by Chrome DevTools Protocol.

```bash
# View full accessibility tree
bdg dom a11y tree               # Display tree (first 50 nodes, human-readable)
bdg dom a11y tree --json        # Full tree in JSON format

# Query nodes by role, name, or description
bdg dom a11y query role=button                    # Find all buttons
bdg dom a11y query name=Submit                    # Find by accessible name (substring, case-insensitive)
bdg dom a11y query 'name=E-mail address:'         # A name with spaces or colons: quote the whole field
bdg dom a11y query 'role=textbox name=E-mail address:'  # Combine criteria (AND logic)
bdg dom a11y query 'description=Click to submit'  # Find by description
bdg dom a11y query role=button --json             # JSON output

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
- Combine with spaces or commas for AND logic: `role=button,name=Submit`
- `key:value` works too. A role ends at the next field; a name or description runs to the next `role=`/`name=`/`description=` with a value, or to the end of the argument, so it may contain spaces and colons (`'name=E-mail address:'`). Quote the whole pattern for the shell (`name="E-mail address:"` reaches bdg without its quotes, which is fine when the name is last). A `word:` inside a name that looks like a misspelled field (`name=Save rol:button`) exits 81 with a "did you mean"; quote the name if it really contains it. Put a value in inner quotes when it contains field-like text: `'name="Choose role: admin" role=combobox'`

**Output:**
- Tree view shows role, name, description, and key properties
- Ignored nodes are automatically filtered out
- Human-readable format limited to 50 nodes (use `--json` for complete output)

**JSON Output (jq-friendly):**

The `--json` output returns nodes as an array for natural jq filtering:

```bash
# Get first node
bdg dom a11y tree --json | jq '.data.nodes[0]'

# Find all checkboxes
bdg dom a11y tree --json | jq '[.data.nodes[] | select(.role == "checkbox")]'

# Find by name pattern
bdg dom a11y tree --json | jq '[.data.nodes[] | select(.name | test("submit"; "i"))]'

# Get roles and names only
bdg dom a11y tree --json | jq '.data.nodes[] | {role, name}'
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
bdg dom get "#content"                        # [Generic] <div> + a Text: line (up to 500 characters)

# Raw HTML output
bdg dom get "h1" --raw                        # Get full HTML with attributes
bdg dom get "button" --raw --all             # Get all matching elements
bdg dom get "button" --raw --nth 2           # Get 3rd matching element (0-based)
bdg dom get --node-id 123                    # Get by node id (from query/get --raw or a11y describe)

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
[Generic] <div#content>
Text: Welcome to the docs. This guide covers ... (cut at 500 characters; --raw shows the HTML)
```

An element whose text is longer than the one-line preview gets a `Text:` line with up to 500 characters of it (whitespace collapsed); `--json` has it as `domContext.text`.

**When to use `--raw`:**
- Need exact HTML structure with classes and attributes
- Multiple elements required (`--all`)
- Specific element selection (`--nth`, `--node-id`)
- CSS/HTML debugging

**Token Efficiency:**
- Simple elements: 45-75% reduction
- Complex elements: 82-99% reduction

### Element Query

Find elements by CSS selector (returns compact summary).

```bash
bdg dom query "button"                        # Find all buttons
bdg dom query ".error-message"                # Find by class
bdg dom query "#login-form input"             # Complex selectors
bdg dom query --json                          # JSON output
```

**Output:**
- Shows count and preview of matched elements (the first 50; `--json` has all)
- Lists nodeId, tag, classes, and text preview (the text as rendered: hidden parts left out)
- No match exits 83, like `dom get` and `dom a11y`
- Matches outside the viewport or hidden get a hint: `(below fold)`, `(above viewport)`, `(left of viewport)`, `(right of viewport)`, `(hidden)`, or `(out of view in ul#list)` for one scrolled out of a container; `--json` has `inViewport` (and `clippedBy`) for the first 100 matches (see `dom layout`)
- `<option>` elements show their `value` attribute and label: `[2] <option value="ca"> Canada (hidden)`
- One `Next:` line follows (hidden with `-q`): `bdg dom get 0` (text), `bdg dom get 0 --raw` (HTML), `bdg dom layout 0` (position). They take the index, so they work for matches in shadow roots and iframes too

### Event Listeners

List the event listeners that run for an element: on the element itself, its ancestors (through open shadow roots), its document and its window. Frameworks attach most handlers by delegation (React on its root container, jQuery on `document`), so ancestors matter.

```bash
bdg dom listeners "#save"                     # All listeners, grouped by event type
bdg dom listeners "button" --index 2          # Third match (0-based)
bdg dom listeners 0                           # Cached query index (stale index exits 87)
bdg dom listeners "#save" --type click,keydown  # Only these event types (--type is repeatable)
bdg dom listeners "#save" --all               # Every listener of framework roots (React) too
bdg dom listeners "#save" --json
```

**Output:**
```text
Event listeners for button#save (93)

click
  target    button#save  handleSave  script 12:1:2345  [React onClick] ()=>f(e)
  document  document     rowClicked  script 5:3:12     [jQuery, delegate .row] function rowClicked() { … }
  target    button#save  u0          script 9:1:3812   [no-op] function u0(){}

Framework roots (one line per node; --all lists each listener):
  ancestor  div#__next  React root: 45 event types, capture and bubble (dispatchDiscreteEvent, dispatchContinuousEvent, dispatchEvent)
```

- The handlers that run for the element come first: event types whose nearest handler is on the element come before those handled only by ancestors, document or window (alphabetically on ties). Within a type, nearest first (`target`, `ancestor`s outward, `document`, `window`), framework handlers before plain listeners on the same node, `[no-op]` handlers last
- Handler: name, a one-line source preview (80 characters) and its location (`script <id>:<line>:<column>`, 1-based like DevTools; JSON `lineNumber`/`columnNumber` are 0-based as in CDP)
- Inline `on…` attributes and `on…` properties are included; empty handlers (React puts `onclick = function noop(){}` on clickable elements) are marked `[no-op]` and do not count as the element's own handler
- React roots are collapsed: on an ancestor recognised as a React root container (React's `__reactContainer$…`/`_reactRootContainer` keys, or dispatchers named `dispatchDiscreteEvent`/`dispatchContinuousEvent`/`dispatchEvent`), the function objects that each listen for several event types and together for many (bound functions count as the function they call) become one line under `Framework roots`; `--all` lists them one by one. Other handlers that listen for many types (an analytics listener on `document`) are never collapsed. With `--type`, only the requested types count, so `--type click` shows React's click dispatchers individually
- React: the `on…` handler props React runs for the element's events are listed with their name, source and location, marked `[React onClick]` (`framework: "React"`, `reactProp` in JSON): the element's own, and those of its React parents, found by walking React's fiber tree (so a portal's React parents count, shown by their description, and DOM parents outside the React tree don't; without a fiber, the DOM ancestors). Props are read from `__reactProps$…` (React 17-19), `__reactEventHandlers$…` (React 16) or the fiber's `memoizedProps`, without running getters. The event type comes from the prop (`onClick` → `click`, `onClickCapture` → `click` with `useCapture`, `onDoubleClick` → `dblclick`, `onFocus`/`onBlur` → `focusin`/`focusout` as React listens for them, `onGotPointerCapture` → `gotpointercapture`). Parents' bubble-phase props for events React does not bubble (`onMouseEnter`/`Leave`, `onPointerEnter`/`Leave`, `onScroll`, `onLoad`, `onError`, media events, …) are left out. At most 50 props are listed per call, after `--type` filtering (`reactHandlersSkipped` counts the rest). Preact is not resolved
- jQuery: when the page has jQuery (`jQuery._data`), its dispatcher is replaced by the jQuery handlers it runs for the element, with their real name, source and location, marked `[jQuery]`; delegated ones (`$(document).on('click', '.row', fn)`) show `delegate .row` and only when the element matches the selector. A jQuery dispatcher none of whose handlers run for the element (its delegates match other elements) is left out. At most 50 jQuery handlers are resolved per call; beyond that the dispatcher is listed as is and a note (`jqueryHandlersSkipped` in JSON) says how many were not resolved. A page whose `jQuery`/`$` globals throw only loses the jQuery details
- When an interaction event (click, input, keydown, …) has no listener of its own on the element (`[no-op]` aside), a note says how it reaches its handlers: React's `[no-op]` placeholder next to resolved React handlers, a React root container without an `on…` prop for it, jQuery delegation, or plain listeners on ancestors, document or window
- The heading names the cached index and the iframe holding the element (`Event listeners for p [2] in iframe#sd (3)`)
- No listeners at all is not an error (exit 0); a selector without match exits 83, an `--index` out of range 81. A `--type` that matches nothing but is close to a listened type (`Click`, `onclick`) suggests it (`typeSuggestions` in JSON)
- Elements in open shadow roots and same-origin iframes are found like with the other DOM commands
- Uses `DOMDebugger.getEventListeners`; the Debugger domain is not enabled, so `debugger;` statements do not pause the page

**JSON (`data`):** `{ selector, index?, element, frame?, matchCount?, warning?, typeSuggestions?, jqueryHandlersSkipped?, reactHandlersSkipped?, listeners: [{ type, on: "target"|"ancestor"|"document"|"window", node, useCapture, passive, once, noop?, framework?: "jQuery"|"React", reactProp?, delegateSelector?, handler: { name, preview, scriptId, lineNumber, columnNumber } }], collapsed?: [{ on, node, framework?, types, count, capture, bubble, handlers: [{ name, preview, scriptId, lineNumber, columnNumber }] }] }`

### Element Layout

Where elements are and whether a user can see them, without a screenshot: position and size, viewport position, what covers them, and the styles that decide how they show. Takes a selector (every match, or one with `--index`) or a cached query index.

```bash
bdg dom layout "button"                       # Every match (first 20 listed; --json up to 100, the rest counted in omitted)
bdg dom layout "button" --index 2             # Third match only (0-based; out of range exits 81)
bdg dom layout 0                              # Cached query index (stale index exits 87)
bdg dom layout "#save" --json
```

**Output:**
```text
Page: viewport 1280×720, scrolled to 0,0, document 1280×2500
3 elements match "button" (page x,y and size in CSS px):
  [0] button#menu.icon "Menu"  10,10 40×40  visible
  [1] button#accept "Accept"  300,60 100×30  visible  covered by div#cookie-banner.modal
  [2] button#save "Save"  420,1180 120×40  below fold (scroll down 500px to centre it)
```

- Coordinates are CSS pixels; `bounds` is relative to the top-level page (iframe offsets and page scroll included), `viewport` to the visible area
- `inViewport`: `visible`, `partly` (with `percentVisible`), `above`, `below`, `left`, `right` or `hidden` (with `hiddenReason`: `display: none`, `visibility: hidden`, zero size, `inside a closed <details>`, `content-visibility: hidden on div#…`, `clipped by div#acc: zero height` for content of a collapsed `height: 0; overflow: hidden` accordion, inside a hidden iframe). Human output shows no coordinates for hidden elements
- Same-origin iframes and overflow containers (scroll lists, `overflow: hidden`) clip what counts as visible, following containing blocks (an absolutely positioned dropdown escapes a static `overflow: hidden` parent; fixed elements are not clipped). CSS `zoom` and `transform: scale()` on or around a container are taken into account. A `<body>` that scrolls on its own (the root element has `overflow` other than `visible`) clips like any container. When one cuts the element off, `clippedBy` names it (`out of view in ul#list (below)`, `out of view in body (below)`) and there is no `scrollBy`
- `scrollBy`: the page scroll (`bdg dom scroll --down/--up/--right/--left`) that centres an element that is not fully in view (aligns the top of one taller than the viewport), like `bdg dom scroll <selector>`, so sticky headers and fixed footers at the edges do not cover it; limited to how far the page can actually scroll. Human output says so: `(scroll down 500px to centre it)`, or `to bring it into view` for an element larger than the viewport
- `offScreenReason` replaces `scrollBy` when no page scroll can bring the element fully into view: `fixed position, page scroll does not move it` (the element or a container is `position: fixed` relative to the viewport, e.g. an off-canvas menu; a fixed element inside a transformed container scrolls with the page and gets `scrollBy`) or `beyond the page's scroll range` (e.g. a `left: -9999px` skip link). The position (`left`, `above`, `partly`, …) is kept; human output shows `left of viewport (off-screen: …)`
- Scroll-locked pages: when the page cannot scroll (the document is no taller than the viewport) because `body` or `html` is `position: fixed` or `overflow: hidden`, as a consent or modal dialog does, content below the fold gets `page scrolling is locked (position: fixed, overflow: hidden on body)` instead (in-flow content of a fixed `body` is not called fixed). When a visible dialog is on the page (`dialog[open]`, `[aria-modal=true]`, `[role=dialog]`, `[role=alertdialog]`), it is named as the likely cause: `…, likely by dialog div#sp_message_container_1482251`. Human output: `below fold; page scrolling is locked (…)`. Close the dialog first
- The page line names the `prefers-color-scheme` the page sees (`…, dark color scheme`; `page.colorScheme` in JSON). `page.viewport` is the layout viewport without scrollbars, the same size `dom scroll` reports
- `coveredBy`: the topmost element at the center of the largest visible box (a wrapped link has one per line), when it is another element (not one inside it), e.g. a modal backdrop or sticky header; overlays over an iframe count too. An ancestor counts only when it is painted above the element, e.g. a card's `::after` overlay (`dom click` reports the same element). Where the viewport or a scroll container has overlay scrollbars (macOS, mobile; they take no space), the 16 px strip along its right and bottom edges is avoided when the element shows outside it, because those scrollbars catch hit tests for about a second after a scroll. Not reported for elements hit-testing skips (`pointer-events: none`)
- `inert: true` for elements inside an `inert` element (through shadow roots): shown, but not interactive; human output adds `inert`
- `invisible`: why an element that is rendered still cannot be seen: `opacity: 0` on it or an ancestor, including a slot or shadow wrapper around slotted content (`opacity: 0 on div#menu`), or a `clip-path: inset()` / `clip: rect()` that cuts it away entirely (the "visually hidden" pattern). These elements keep their `inViewport` and count as visible for `:visible` (like Playwright); human output adds the reason
- Elements in open shadow roots and same-origin iframes are found like with the other DOM commands; one page-side pass measures them all
- Known limit: CSS transforms on iframes (and zoom) are not applied to the offsets of elements inside them; a rotated or skewed container (or one inside a rotated or skewed ancestor) clips at its unscaled size from its bounding box's corner

**JSON (`data`):** `{ selector, count, omitted?, page: { viewport: { width, height }, scroll: { x, y }, document: { width, height }, colorScheme? }, elements: [{ index, tag, element, text?, context?, bounds: { x, y, width, height }, viewport: { x, y }, inViewport, percentVisible?, hiddenReason?, scrollBy?: { x, y }, clippedBy?, offScreenReason?, coveredBy?, invisible?, inert?, computed: { display, visibility, position, opacity, zIndex } }] }`

### Waiting for Elements

`dom click` and the other actions wait for the requests they start, not for results a page shows later (timers, spinners, animations). `bdg dom wait` waits for those instead of `sleep` loops:

```bash
bdg dom wait "#finish" --visible              # A match becomes visible (timer-based loading)
bdg dom wait ".toast" --text "Saved"          # A match contains the text (case-insensitive)
bdg dom wait "#loading" --gone                # Nothing matches any more (--visible: nothing visible)
bdg dom wait 'li:has-text("Buy milk")'        # Selector filters work too (:has-text, :text-is, :visible)
bdg dom wait "#app" --load                    # ...and document.readyState is complete
bdg dom wait --load                           # Only the page load
bdg dom wait "#result" --timeout 30000        # Default 10000 ms; up to 600000
```

**Output:**
```text
✓ div#finish visible after 5.1s
```

- Selectors reach open shadow roots and same-origin iframes, like the other DOM commands; an invalid selector exits 81
- The page is watched (DOM mutations, plus a 100 ms poll for style changes the mutations do not show) and answers as soon as the matches change; a navigation during the wait continues it on the new document
- Already met: returns at once (`after 0.0s`). `--gone` needs two snapshots in a row of the same document without matches, once it is no longer `loading` (about 50 ms when nothing matches already), so the empty document right after a navigation does not count
- `--text` needs a selector (`body` searches the whole page); hidden elements match by their text nodes, as with `:has-text`
- Timeout: exit 102 with what the page showed last and a next step, e.g. `Timed out after 10s waiting for div#finish to be visible (last seen: 2 matches, none visible)`, then `The matches are hidden; see why with bdg dom layout 'div#finish'`

**JSON (`data`):** `{ selector?, text?, visible?, gone?, load?, elapsedMs, count, textCount?, visibleCount, readyState }`

### JavaScript Evaluation

Execute JavaScript in the page context.

```bash
bdg dom eval "document.title"                     # Evaluate expression
bdg dom eval "document.querySelector('h1').textContent"
bdg dom eval --json                               # JSON output with full Runtime.evaluate response
```

Human output prints a string result as is (`My Page`, not `"My Page"`) unless that would read as
another value: the empty string, `undefined` and strings that are valid JSON (`"42"`, `"[1,2]"`) stay
JSON-quoted. Other values are printed as formatted JSON (`undefined` for no value). `--json` keeps the value in `data.result`.

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

**Limits and failures:**

- A script still running after 20 s is terminated (exit 102)
- An awaited or returned promise that does not settle within 20 s exits 102 with "The awaited promise did not settle within 20s" (nothing was busy)
- A page that navigates while the script runs (`location.href = …; await …`) exits 83 with "The page navigated while the script ran": the result is lost with the old document. A tab closed while the script runs exits 83 with "The page was closed while the script ran"

**Iframes (`--frame`):**

`--frame <frame>` runs the script in one iframe's main world (its own `window`,
`document` and page globals), including cross-origin iframes that Chrome runs in
a separate process. List the frames first:

```bash
bdg dom frames                                    # [0] http://localhost:3000/widget  name=widget  same-origin
                                                  # [1] https://pay.example/  #checkout  cross-origin, out-of-process
                                                  #   [2] about:blank  same-origin  (nested in [1], same origin as it)
bdg dom frames --json                             # { frames: [{ index, url, name?, id?, origin, crossOrigin, outOfProcess, parentIndex? }] }

bdg dom eval --frame 1 'document.title'           # By index (0-based; the main page is not listed)
bdg dom eval --frame checkout 'location.href'     # By name or id attribute of the <iframe> (exact match first)
bdg dom eval --frame pay.example 'window.config'  # By part of the name, id or URL (case-insensitive)
```

- Human output prints `Frame: <url>` on stderr (hidden with `-q`), so stdout is only the value and pipes into `jq`; `--json` adds `"frame": "<url>"` to `data` (`"frame": ""` for a frame without URL; human output shows `Frame: (no URL)`)
- Everything else works as in the page: top-level `await`, awaited promises, JSON-safe values, 20 s limit, exit 91 when the script throws; a busy frame is reported as "The frame was busy…" (102)
- Several matching frames exit 81 and list them; no match exits 83 and lists all frames
- Nested iframes are listed depth-first (indented below their parent; `parentIndex` in JSON); out-of-process frames come after in-process siblings. Human output shortens URLs over 100 characters and shows `(no URL)` for frames without one; JSON has the full URL
- `origin` is the origin the frame's scripts run with (from its execution context): srcdoc and about:blank frames inherit their parent's, data: URLs and `sandbox` frames without `allow-same-origin` are opaque (`"null"`). `crossOrigin` is true when the page cannot reach the frame's document (`contentDocument` is null): a different or opaque origin
- Frames added or removed while the page is listed are skipped. A frame that navigates or is removed while the script runs (or between the lookup and the run) exits 83 ("The frame navigated while the script ran" / "The frame was removed before the script finished", or "The frame navigated or was removed…" when its parent does not answer within 2 s); re-run `bdg dom frames`. A busy out-of-process frame is checked and stopped through the session's own connection; if its scripts cannot be stopped, the 102 error says so instead of calling the frame usable

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
Summary: 0/5 fields filled | 4 required fields empty: Email address, Password, Confirm password, Terms & Conditions | NOT ready (no fields filled)

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
      "requiredRemaining": 4,
      "emptyFieldLabels": ["Email address", "Password", "Confirm password", "Newsletter", "Terms & Conditions"],
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
- **Readiness**: a radio or checkbox group (same name) counts as one field, filled when any option is checked. Required means the `required` attribute, `aria-required="true"`, or a label with a standalone `*` (`Name *`, `* Name`, or an element of its own holding `*`; a footnote star such as `Terms*` does not count). The form is `READY to submit` only when every required field is filled, nothing is invalid, the submit button is enabled, and at least one field is filled (an untouched form is `NOT ready (no fields filled)`); when no field is marked required the empty ones are named (`READY to submit (no field is marked required; empty: Last Name)`). In JSON, `summary.readyToSubmit` is therefore `false` for an untouched form (it used to be `true` when no field was required), the field counts (`totalFields`, `filledFields`, ...) count a choice group once, and `emptyFieldLabels` names the empty fields
- **Primary button** (a heuristic): at most one button is `(primary)`. A button whose label starts with a cancel, back or delete word never is (Cancel, Reset, Back, Previous, Close, Clear, Discard, Delete, Remove, Abbrechen, Zurück, Annuler, Retour, Cancelar, Volver, Annulla, Indietro, Anuluj, Wstecz), nor a reset button. Then, in order: a button written as a submit button (`type="submit"`, `<input type=submit>`); among the form's untyped `<button>`s (each submits the form) the one styled as primary (`primary`, `btn-primary`, `btn_primary`, `submit` classes), else the last one; else any button styled as primary. Buttons outside a `<form>` submit nothing, so only their style counts

**Workflow Example:**
```bash
# 1. Discover form structure
bdg dom form --json | jq '.data.forms[0].summary.readyToSubmit'

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

Interact with page elements using real mouse and keyboard input. All interaction commands automatically wait for network stability after the action (disable with `--no-wait`).

JavaScript dialogs (`alert`, `confirm`, `prompt`, `beforeunload`) are accepted automatically so they never block a session; `prompt()` receives an empty string. Dialogs opened by `fill`/`click`/`submit`/`pressKey` are listed in their result (`data.dialogs` in JSON), and every accepted dialog also appears in `bdg console`.

The network wait watches requests from before the action, so a request an event handler sends right away (`onclick = () => fetch(...)`) is waited for: the command returns once no request has been running for 150 ms, or after 2 s with the rest still running (a click that starts a navigation to a slow page returns after 2 s with the page request pending).

DOM actions (`fill`, `click` incl. `--double`/`--right`, `hover`, `pressKey`, `submit`, `scroll`) also report the network requests they triggered: every request, and every WebSocket connection (`GET ws://… → 101`), that started after the action began and before the command returned (after its usual stability wait; no extra waiting). Requests still running then are shown as pending, and ones whose response arrived while the body still loads (EventSource streams, slow downloads) as `200 (loading)` (`"loading": true` in JSON); `data:`/`blob:` URLs and CORS preflights are left out. Human output lists documents, XHR/fetch, EventSource, WebSocket, ping and CSP-report requests, every request that is not a GET (e.g. a `sendBeacon` POST typed `Other`) and assets that failed first, up to 10, under `Requests during the action (N):` with N the total, and counts the static assets that loaded (stylesheets, scripts, fonts, images, media, by CDP resource type) on one line, e.g. `+ 97 assets (css, js, fonts, images)`; the rows, the `... and N more` note and the assets line add up to N (nothing is shown when there were none; `-q` keeps the list, it is a result, not a hint). JSON keeps every request with its `resourceType` and lists up to 50 (pages, API calls and failures kept before assets when there are more). `dom submit`'s `Network Requests` (`data.networkRequests`) is the number of these reportable requests (listed plus `triggeredRequestsOmitted`; `data:`/`blob:` URLs and preflights not counted), the same total as the list title; it used to come from a separate counter in `data.triggeredRequests` (`[]` when none, absent when network telemetry is off) and how many more there were in `data.triggeredRequestsOmitted` (those are only in `bdg network list`). With `--no-wait` only requests bdg saw start before the command returned are listed (often none yet: use `bdg network list` afterwards). `bdg page navigate`/`reload`/`back`/`forward` do not list requests (they are the page load: use `bdg network list`). Attribution is by time, not cause: a request a page timer or poller starts during the action is listed too (and a poller keeps the network busy, so the action waits the full 2 s).

```text
✓ Element Clicked

Selector:      #save
Element:       button#save.primary "Save"
Method:        mouse events

Requests during the action (5):
  POST 127.0.0.1:8080/api/save → 200 (85ms)
  GET 127.0.0.1:8080/api/items → pending
  + 3 assets (css, images)
```

```json
"triggeredRequests": [
  { "requestId": "1234.5", "method": "POST", "url": "http://127.0.0.1:8080/api/save", "resourceType": "Fetch", "status": 200, "durationMs": 85 },
  { "requestId": "1234.6", "method": "GET", "url": "http://127.0.0.1:8080/api/items", "resourceType": "XHR", "pending": true }
]
```

`Element` (`data.element` in JSON) names the element the action hit, by its tag, id, classes and text, or the text of a nearby ancestor (`input.toggle in div.view "Write report"`), so a click by index or on one of several matches says which one it was. The status line has a check mark only for a clean success: an action with warnings (covered element clicked with DOM events, click not received, value mismatch, several matches) prints `⚠ Element Clicked (with warnings)` with the warning right below it, before the details and requests.

Actions also say what changed on the page, after the details and before the requests. A navigation is shown as `Page: navigated to https://…/secure (200)` (a new document, also at the same URL, as after a form POST that redirects back) or `Page: URL changed to …/#/active (same document)` (history API, hash), `navigation: { url, sameDocument, status }` in JSON. Messages that appeared or changed in alert/status/`aria-live` elements, `<output>` or elements whose class or id has a word like flash, alert, error, toast, notice, message, invalid or feedback are listed as `New text: "Your password is invalid!" (div#flash.flash.error)` (`messages: [{ text, element }]`, at most 3, 120 characters each, without close buttons such as the "×" or aria-hidden parts; after a navigation every message of the new page counts). Both are left out when nothing changed. A `click` or `submit` that changed nothing at all (no DOM change, request, navigation, dialog or new window, checked again 300 ms later) prints `⚠ Element Clicked (no visible effect: no DOM change, no requests, no navigation)` and has `effect: "none"`, still exiting 0. It is not claimed with `--no-wait`, for `hover` and `--right`, when the click hit a form control, label, media, iframe or popover button (their effect needs no DOM change), or when focus moved to an element that is not a button or link; focus/hover class changes on the clicked element don't count as changes. This costs one page script before and one after the action (about 1 ms on small pages, under 10 ms on large ones).

```text
✓ Form Submitted

Selector:           #login
Element:            button.radius "Login"
Submit Button:      used
Network Requests:   11
Wait Time:          1390ms
Page:               navigated to https://the-internet.herokuapp.com/login (200)
New text:           "Your password is invalid!" (div#flash.flash.error)
```

After `dom fill` the field's value is read back. When it is not the value given (the page rejected, reformatted or moved the input, e.g. a handler that writes it into another field) the command still succeeds (exit 0) but warns first, `The field's value is "" after filling (expected "Lovelace"); the page may have rejected or moved the input`, and JSON has `valueMismatch: { "expected": "Lovelace", "actual": "" }`. When another text field of the form holds the value given, the warning ends `the value appeared in input#first-name instead` (`movedTo`). Values are compared as the browser normalises them (colors case-insensitively, numbers and ranges as numbers, email trimmed, textarea line endings, times without zero seconds); a value the page cut to the field's maxlength is reported as `The value was cut to 10 characters by maxlength` (`truncatedTo`), and a password mismatch only by length (`The password field's value differs from the one filled (length 8, expected 12)`, masked values plus `expectedLength`/`actualLength`). The value is read back separately, a moment after the fill returned and for at most 1 s; when the change navigated the page (a `<select onchange="form.submit()">`) the fill reports success without it. A warning rather than an error, because pages legitimately reformat values (phone masks, trimming, upper-casing).

Failed requests have `failed: true` and `errorText` (no `status`).

Interactions run one at a time per session (concurrent `pressKey` calls no longer interleave). Values the browser would not take as given (a color that is not `#rrggbb`, a range value outside min/max or off-step, an unparseable number or date) fail with exit 81 and leave the field's previous value; a number outside min/max is filled with a warning.

```bash
# Fill inputs
bdg dom fill "#username" "admin"
bdg dom fill "input[type='password']" "secret" --no-blur
bdg dom fill "#search" "query" --index 1          # Second match (indices are 0-based)
bdg dom fill 0 "value"                            # Use cached query index (0-based)
bdg dom fill "#upload" "./a.png,./b.png"          # File input: one path, or several separated by commas
bdg dom fill "#upload" ""                         # Clear a file input

# Click elements
bdg dom click "#login-btn"
bdg dom click "button.submit" --index 2
bdg dom click 0                                   # Use cached query index (0-based)
bdg dom click "#fast-btn" --no-wait               # Skip network stability wait
bdg dom click "#start" && bdg dom wait "#finish" --visible   # Results shown later by a timer
bdg dom click ".row" --double                     # Double-click
bdg dom click ".row" --right                      # Right-click (context menu)
bdg dom hover "nav .menu"                         # Hover (opens hover menus)
bdg dom fill "#tags" "a,c"                        # <select multiple>: several options

# Navigate the session page
bdg page navigate https://example.com/next        # Load a URL and wait for it
bdg page back                                     # History back / forward
bdg page reload

# Press keys (for Enter-to-submit, keyboard navigation)
bdg dom pressKey ".new-todo" Enter                # TodoMVC pattern: submit with Enter
bdg dom pressKey "#search" Enter                  # Search box submit
bdg dom pressKey "input" Tab                      # Tab to next field
bdg dom pressKey "input" ArrowDown --times 3     # Navigate autocomplete
bdg dom pressKey "body" Escape                    # Close modal/dialog
bdg dom pressKey "textarea" a --modifiers ctrl   # Select all (Ctrl+A; meta = Cmd+A works too)
bdg dom pressKey "textarea" z --modifiers ctrl   # Undo (also C, X, V; ctrl+shift+z redoes)
bdg dom pressKey 0 Enter                          # Use cached query index

# Submit forms (smart wait for navigation/network)
bdg dom submit "#login-form"
bdg dom submit "#login-form" --wait-network 2000  # Wait 2s for network idle
bdg dom submit "#login-form" --wait-navigation    # Wait for page navigation (any new document, also at the same URL)

# Scroll page (waits for lazy-loaded content)
bdg dom scroll "footer"                           # Scroll element into view
bdg dom scroll --down 500                         # Scroll down by pixels
bdg dom scroll --bottom                           # Scroll to page bottom
bdg dom scroll --top                              # Scroll to page top
bdg dom scroll "li.item" --index 5               # Scroll to nth match
```

Scroll output reports the viewport without scrollbars (`Viewport: 1905×993`) and the page size of the scrolling element, the same numbers as `dom layout`.

**Press Key Options:**
| Option | Description |
|--------|-------------|
| `--index <n>` | Element index if selector matches multiple (0-based) |
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

# Capture viewport only (.jpg/.jpeg files are JPEG, everything else PNG;
# --format png|jpeg|jpg must match the extension)
bdg dom screenshot visible.jpg --no-full-page

# Full resolution (disable auto-resize)
bdg dom screenshot full-res.png --no-resize

# Scroll to element before capture (captures viewport)
bdg dom screenshot footer.png --scroll "footer"

# One element: a selector or query index as the second argument (or --selector / --index)
bdg dom screenshot card.png ".card"
bdg dom screenshot card.png --selector ".card"
bdg dom screenshot card.png 2

# Custom quality
bdg dom screenshot high-res.jpg --quality 100
```

**Element screenshots:** the capture covers the element's border box plus content that overflows it (uncleared floats, absolutely positioned or transformed children), so a container whose floated content hangs out of it is not cropped to its heading; content an `overflow: hidden` ancestor cuts off and fixed descendants are left out. Human output then says `(grown from 940×37 to 940×285 to include content overflowing the element)`; JSON keeps the border box in `element.bounds` (page coordinates, like `dom layout`) and adds `element.captured`. Elements of a scrolled page are captured where they are (the page scroll is taken into account). An element given both as an argument and with `--selector`/`--index` must be the same one (exit 81 otherwise).

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
bdg network list --filter "mime-type:image/*"         # Any image type

# Filter by response size
bdg network list --filter "larger-than:1MB"
bdg network list --filter "larger-than:100KB"

# Filter by duration (ms or s)
bdg network list --filter "duration:>1s"
bdg network list --filter "duration:<=200ms"

# Filter by response headers
bdg network list --filter "has-response-header:set-cookie"
bdg network list --filter "has-response-header:content-security-policy"

# Filter by state
bdg network list --filter "is:from-cache"          # Cached responses
bdg network list --filter "is:running"             # In-progress requests
bdg network list --filter "is:failed"              # No response (DNS, refused, aborted, blocked)

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
bdg network list --preset failed                   # is:failed

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
| `is:failed` | Requests that got no response (DNS, refused, aborted, blocked) | |
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

# Export before stopping: telemetry lives in the session and is discarded by `bdg stop`
bdg network har final.har && bdg stop

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

# Export final, then stop (the data goes away with the session)
bdg network har final.har
bdg stop
```

### HTTP Headers Inspection

Inspect HTTP request and response headers from captured network requests.

```bash
# Show headers from main page navigation (smart default)
bdg network headers

# Show headers from specific request ID
bdg peek --json | jq -r '.data.network[0].requestId'
bdg network headers <request-id>

# Filter to specific header (case-insensitive)
bdg network headers --header content-security-policy
bdg network headers --header Content-Type

# Combine request ID and header filter
bdg network headers <request-id> --header content-type

# JSON output for scripting
bdg network headers --json
bdg network headers --header content-security-policy --json | jq '.data.responseHeaders | to_entries[0].value'
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
bdg peek --json | jq -r '.data.network[] | select(.url | contains("api")) | .requestId'
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

# Search for methods by keyword (names, descriptions and common words:
# "viewport" finds Emulation.setDeviceMetricsOverride first; name matches come first)
bdg cdp --search cookie
bdg cdp --search viewport

# Describe a specific method (parameters and return types)
bdg cdp Network.getCookies --describe

# Execute a method
bdg cdp Network.getCookies
bdg cdp Page.navigate --params '{"url": "https://example.com"}'
```

**Event-Based Domains:**

Some CDP domains use event-based reporting rather than synchronous responses. When methods return empty results, bdg provides contextual hints:

```bash
bdg cdp Audits.enable
# Issues are reported through Audits.issueAdded events, so the result is empty:
# {
#   "method": "Audits.enable",
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
bdg cleanup                     # Remove files left by a crashed session, kill its orphaned Chrome
bdg cleanup --force             # Kill a stuck session (daemon + its Chrome), then clean up
bdg cleanup --aggressive        # Alias for --force
bdg cleanup --remove-output     # Also remove legacy session.json
bdg cleanup --json              # JSON output
```

## Collection Options

**Note:** All three collectors (DOM, network, console) are enabled by default.
Network and console data stream continuously; DOM state is queried live with `bdg dom` commands.

### Basic Options
```bash
bdg localhost:3000 --port 9223              # Custom CDP port
bdg localhost:3000 --timeout 30             # Auto-stop after timeout
bdg localhost:3000 --all                    # Include all data (disable filtering)
bdg localhost:3000 --user-data-dir ~/custom # Custom Chrome profile directory
```

Profiles bdg manages (`~/.bdg/chrome-profile`, a named session's profile) have the password manager and its leak check turned off, because their bubbles capture clicks in headless Chrome. bdg leaves a profile given with `-u`/`--user-data-dir` as it is; turn them off there yourself (Settings > Passwords) if clicks stop reaching the page after a login.

### Advanced Options
```bash
# Chrome Options
bdg localhost:3000 --headless                   # Launch Chrome in headless mode
bdg localhost:3000 --chrome-ws-url 9222        # Connect to existing Chrome instance

# --chrome-ws-url takes the DevTools port of a running Chrome (9222, host:port or
# http://host:port; bdg looks up the browser URL in /json/version), the browser URL
# itself (ws://host:port/devtools/browser/<id>; bdg uses the first open tab, or opens one)
# or a page URL from /json/list (ws://host:port/devtools/page/<id>).
# Useful to log in by hand first (OAuth, passkeys) in a Chrome started with
# --remote-debugging-port=9222 --user-data-dir=<dir>, then attach bdg to it.
# The Chrome keeps running after bdg stop. --port, -u and --[no-]headless cannot be
# combined with it (exit 81; the running Chrome has its own); a stale browser id or a
# missing page id is refused (83); a port out of range or `host:` without a port is
# invalid (80); an HTTP server that is not DevTools (e.g. the app's port) is reported as
# "not a Chrome DevTools endpoint" (101); a Chrome or tab used by another running bdg
# session is refused (90). In status JSON, chromePid is null for an attached Chrome.

# Output Optimization
bdg localhost:3000 --max-body-size 10           # Set max response body size (MB, default: 5)
```

## Default Behaviors

Things bdg does without being asked, and how to change them:

- **Tracking and ad domains are not recorded**: requests to analytics, tag-manager, ad and social widget domains (Google Analytics/Tag Manager/Ads, DoubleClick, ad exchanges, Clarity, Bing, Facebook, TikTok, LinkedIn, Twitter, comScore, Nielsen, Chartbeat, Permutive, Optimizely, Adobe Analytics and similar) are dropped. Use `--all` to record them
- **Large or binary response bodies are not fetched**: images, fonts, media and stylesheets get a placeholder body, as do bodies over `--max-body-size` (5 MB by default). `--all` fetches them (within the size limit); HAR exports mark skipped bodies with a comment
- **`console.group` headers are hidden**: the messages inside a group are kept; `--all` keeps the group start/end entries too
- **Dialogs are accepted automatically**: `alert`/`confirm` are accepted and `prompt` is answered with an empty string, so a dialog never blocks the page
- **One page is followed**: the session stays on its tab; links opening a new tab (`target="_blank"`, `window.open`) are not followed
- **`--timeout <seconds>`** (1-3600) stops the session that many seconds after the page has loaded, as with `bdg stop`; the start output shows the time (`autoStopAt` with `--json`)
- **The CDP port is remembered**: without `--port`, the port is saved in `port.txt` and reused while it is free (and not claimed by another running session), so each session directory keeps its port

## Session Files

bdg stores session data in `~/.bdg/` (override with `BDG_SESSION_DIR`); a named session (`--session <name>`) uses `~/.bdg/sessions/<name>/` with the same files:

- **daemon.sock** - Unix socket for IPC; a session is running iff it accepts connections
- **daemon.pid** - Daemon process ID (informational)
- **session.meta.json** - Session metadata (Chrome PID, CDP port, target info)
- **chrome.pid** - Chrome launched by bdg, kept until Chrome is confirmed dead
- **daemon.log** - Daemon output, appended across sessions (moved to `daemon.log.1` once it exceeds 5 MB)
- **port.txt** - CDP port reused by the next session in this directory
- **chrome-profile/** - Chrome user data directory

**Key Behaviors:**
- **One daemon = one session**: only `bdg <url>` starts the daemon; it exits when the session ends (stop, Chrome disconnect, or `--timeout`)
- **One session per directory**: the daemon claims its socket atomically; a second `bdg <url>` for the same session reports the running one. Use `--session <name>` to run more (see [Multiple sessions](#multiple-sessions))
- **Commands without a session**: exit 83 ("No active session") without starting anything; `bdg status` reports `active: false` (exit 0)
- **Crash recovery**: files left by a killed daemon are cleaned up by `bdg status`, `bdg cleanup` or the next `bdg <url>`; an orphaned Chrome is killed only if its command line carries the `--bdg-session-dir=<dir>` marker bdg adds at launch

## Output Format

Every command that accepts `--json` (`-j`) prints exactly one response envelope to stdout.
Human-readable logs and hints go to stderr.

### Success
```json
{
  "version": "x.y.z",
  "success": true,
  "data": { }
}
```

`data` is the command's result, for example `data.network` for `peek`,
`data.requests` / `data.totalCount` / `data.filteredCount` for `network list`, `data.nodes`
for `dom a11y tree`, and `data.targetUrl` / `data.port` / `data.chromePid` for `bdg <url> --json`.

### Error
```json
{
  "version": "x.y.z",
  "success": false,
  "error": "Invalid --port: \"abc\" is not an integer",
  "exitCode": 81,
  "suggestion": "Use a value between 1 and 65535"
}
```

`exitCode` always equals the process exit code (see `bdg --help --json` for the full list).
Usage errors such as unknown options or missing arguments are reported the same way, with exit code 81.

In follow mode (`-f --json`), every refresh prints one complete envelope. If the session goes
away while following, an error envelope is printed on each retry until you stop the command.

Put `--json` after the command (`bdg peek --json`); `bdg --json peek` also works.

See [`src/types.ts`](../src/types.ts) for complete type definitions.

## Related Documentation

- **Architecture**: [`docs/architecture/BIDIRECTIONAL_IPC.md`](architecture/BIDIRECTIONAL_IPC.md) - Daemon/worker architecture
- **Testing**: [`docs/quality/TESTING_PHILOSOPHY.md`](quality/TESTING_PHILOSOPHY.md) - Testing strategy
- **Release Process**: [`docs/RELEASE_PROCESS.md`](RELEASE_PROCESS.md) - How to release new versions
- **Docker**: [`docs/DOCKER.md`](DOCKER.md) - Running bdg in Docker containers
