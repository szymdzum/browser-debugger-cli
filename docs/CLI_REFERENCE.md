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

CHROME_PATH=/usr/bin/microsoft-edge bdg localhost:3000   # Launch another Chromium-based browser (Edge)
bdg localhost:3000 --viewport 1280x800       # Exact viewport (CSS px) for the whole session
bdg localhost:3000 --color-scheme dark       # Emulate prefers-color-scheme: light or dark
```

The start output is a few lines: the target, notices (session name, HTTP error, auto-stop), the most useful next commands and a pointer to `bdg --help`. `-q` prints one line.

- `--viewport <WxH>` (e.g. `1280x800`; `X`, `×` and `,` work too, each side 1-10000) gives the page exactly that viewport for the session, through navigations and reloads (`Emulation.setDeviceMetricsOverride` at the display's pixel ratio). A launched Chrome also opens its window at that size, so tabs the page opens get it too. It works with `--chrome-ws-url`: the override belongs to the session's connection and Chrome drops it when the session ends. Without it, a launched Chrome opens a 1920×1080 window (the viewport is smaller by the scrollbar, and by the browser UI in a visible window). Invalid values exit 81
- `--color-scheme light|dark` emulates `prefers-color-scheme` for the session (`Emulation.setEmulatedMedia`). Without it the page sees the system setting: headless Chrome follows the OS, so a dark OS renders dark pages. Other values exit 81 with a suggestion
- `--mobile` emulates a phone for the session: a mobile viewport (390x844 unless `--viewport` gives one) at pixel ratio 3 with mobile layout (meta viewport honoured, overlay scrollbars, so `100vw` fits and the layout is the full width), touch (`pointer: coarse`, `navigator.maxTouchPoints` 5) and an Android Chrome user agent with mobile client hints. Use it for responsive checks instead of a narrow desktop window, whose classic scrollbar takes ~15px (a 375px viewport lays out at 360). `bdg status` shows `(emulated 390x844, phone)`.
- `bdg page emulate --viewport <WxH> --color-scheme light|dark` changes either mid-session (`--mobile` turns phone emulation on; a `--viewport` without it, or `--reset`, turns it off), the same way (no reload: the page re-lays out and media queries re-evaluate), and `--reset` goes back to the browser window and the system setting. It prints what is emulated and the layout viewport the page now has (`Layout: 885x700 (without scrollbars)`; JSON `{ emulated: { viewport?, colorScheme? }, viewport?, colorScheme? }`); screenshots and `bdg status` follow the change. Nothing to change, or an invalid value, exits 81
- `bdg status` shows the viewport and color scheme the page renders with (`Viewport: 1265×800 (emulated 1280x800)`, the layout viewport without the scrollbar; `Color scheme: prefers-color-scheme: dark (from the system setting)`, the media preference the page sees, not the theme it renders); JSON has them in `pageState` (and the start options as `viewport` / `colorScheme`)
- `CHROME_PATH` sets the browser binary bdg launches instead of the installed Chrome. Microsoft Edge is tested (on macOS: `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`); other Chromium-based browsers (Brave, Chromium) should work the same way. A path that does not exist, is a directory or is not executable exits 100 before anything is launched. Output still calls the browser "Chrome". Firefox and Safari do not implement CDP and are not supported

A URL that cannot be loaded at all (DNS failure, connection refused, missing file) fails with exit code 80; a page that loads with an HTTP error still starts the session and warns about the status.

When a start fails after it launched the session's daemon and the daemon reported the failure (an attach refusal, Chrome that cannot be launched, a URL that cannot be loaded), the daemon exits, and `bdg` returns the error only once it is gone (waiting up to 3 s), so a `bdg sessions` or another start right after it does not see the session as still starting. A timeout or an unexpected error does not wait (the daemon may still be starting the session). When the daemon is still running after the wait, the error says so (`The daemon (PID 4242) was still shutting down after 3s; check with bdg sessions, or end it with bdg cleanup --force`), and the JSON error has `daemonStillRunning: true`, `daemonPid` and the commands in `suggestion` (after any suggestion the error already had).

A page that has not finished loading when the start returns (the start waits about 2 s; e.g. a script whose server never answers) still starts the session (exit 0) with a warning naming up to 3 requests it waits on, load-blocking ones (scripts, styles, images, frames) first:

```text
⚠ The page is still loading (document.readyState: loading); waiting on: GET code.jquery.com/ui/1.13.2/jquery-ui.js (pending 2s). Elements may be missing until it finishes: bdg dom wait <selector> waits for one
```

JSON adds `data.loading: { readyState, pending: [{ method, url, resourceType?, pendingMs }], pendingCount }` (absent once the document is complete). `bdg page navigate`/`reload`/`back`/`forward` report the same (`⚠` line, `data.loading`). While the page is still loading, "not found" errors (`dom query`, `get`, `layout`, `click`, `fill` and the other actions, `eval --frame`) and `dom frames` say so and suggest `bdg dom wait` (one extra `document.readyState` check, only when something was not found; `dom frames` checks every time: `No iframes yet; the page is still loading, so the list may be incomplete (bdg dom wait --load)`, or a note under a list, and its JSON has `data.readyState` until the page is complete).

### Check session status
```bash
bdg status                      # Basic status information
bdg status --verbose            # Include the Chrome executable, mode and profile
bdg status --json               # JSON output
bdg page info                   # Just the URL and title of the session page (--json: data.url, data.title)
```

The first line of `bdg status` is `Session active: <url> — <title>`; the sections below it (process, target, activity, collectors) follow.

When the page's renderer crashes (out of memory, a Chrome bug, a killed renderer process), the session stays up but the page cannot answer. `bdg status`, `bdg peek`, `bdg console` and `bdg network list` then start with `⚠ The page crashed at 18:42:10 (renderer gone); bdg page reload brings it back` (JSON `pageState.crashedAt`, `pageCrashedAt` in `peek`, `console` and `network list --json`); `console --follow` and `network list --follow` print it once when the page crashes (JSON: a line with `pageCrashedAt`). Commands that need the page fail at once with exit 107 (`PAGE_CRASHED`) and the same way back, as do commands that were waiting on the page when it crashed. `status`, `peek`, `console`, `network`, `details`, `page reload`/`navigate`/`back`/`forward` and `bdg cdp` methods the browser answers (`Page.reload`, `Page.navigate`, `Target.*`, `Browser.*`, `Network.*` except response bodies, `Storage.*`) keep working. Reloading or navigating brings the page back.

### Stop the session
```bash
bdg stop                        # Stop session (closes Chrome launched by bdg)
bdg stop --kill-chrome          # Kept for compatibility (no additional effect)
```
`bdg stop` returns once the session's daemon has exited (waiting up to 3 s), so a `bdg sessions` or a new start right after it no longer sees the session. When the daemon is still running after the wait, a warning says so (`The daemon (PID 4242) was still shutting down after 3s; check with bdg sessions, or end it with bdg cleanup --force`; JSON `data.warnings`), and the exit code stays 0.

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
- **Directories**: a named session lives in `~/.bdg/sessions/<name>/`. `BDG_SESSION_DIR` moves the base directory: the default session uses `$BDG_SESSION_DIR` itself (unchanged) and named sessions `$BDG_SESSION_DIR/sessions/<name>/`. The daemon socket path (`<dir>/daemon.sock`) must fit the OS limit for Unix sockets with room for a temporary `.<pid>` suffix: at most 95 bytes on macOS, 99 on Linux. A longer path is refused with exit 81, for the default session too; the error blames the directory when even a one-letter name would not fit, and the name otherwise. A directory that cannot be created or written is refused before anything starts: exit 103 when the path goes through a file or a pseudo-filesystem (`/proc`, `/sys`), 82 when its nearest existing directory is not writable
- **Permissions**: session directories are created `0700` and `daemon.log` `0600`. A session directory, or one between it and the base directory, that is a symlink, owned by another user or writable by others (including a shared sticky directory such as `/tmp` itself) is refused with exit 103 by `bdg <url>` and by every command that connects to the daemon; `bdg sessions` lists it as `untrusted`. Your own directory that others can only read, or your group can write (an older `~/.bdg` created `0755`, or `0775` under umask 002), is accepted: `~/.bdg`, `sessions/` and named session directories are tightened to `0700`, a base directory chosen with `BDG_SESSION_DIR` is left as it is. The base directory may be a symlink (dotfiles, another disk) when its target passes the same check; `sessions/` and named session directories may not. A directory owned by another uid (a bind mount, `sudo -E` keeping your `HOME`) is refused. A symlink in place of `daemon.log` is refused, not followed
- **Removing a session**: a stopped named session keeps its directory (Chrome profile of ~60 MB, logs, `port.txt`) for its next start. `bdg cleanup --session <name> --purge` deletes it (add `--force` to stop a running one first); `--purge` needs `--session`, and keeps the directory (exit 90) if the daemon still answers, cleanup reported a problem, or the session's Chrome has not exited after cleanup
- **Ports**: without `--port`, a named session takes the first free port from 9223 upwards that no other running session has claimed (9222 is left to the default session), and keeps it in its `port.txt` for the next start. Sessions starting at the same time never pick the same port, also across different `BDG_SESSION_DIR`s (claims and the selection lock live in a per-user directory under the OS temp directory). bdg only connects to the Chrome it launched: if another process answers on the port, an automatically chosen port is replaced (up to 3 tries) and an explicit `--port` fails with exit 100. The default session keeps choosing from 9222
- **Independence**: `stop`, `cleanup` and every other command act on the selected session only; `bdg cleanup` without `--session` cleans the default session, as before
- **Crashed sessions**: `bdg sessions` also lists sessions whose daemon died: `crashed` while the Chrome bdg launched for them still runs (JSON has its `chromePid`), `stale` when only their files are left (a daemon that still runs after closing its socket is `ending`). Both come with the command that cleans them up (`cleanup` in JSON, e.g. `bdg cleanup --session p3`). A session that ended without `bdg stop` (its Chrome crashed or was closed, its page was closed, or `--timeout` was reached) is listed as `ended`, with why and when under the table (`p3 ended at 18:42:10: Chrome crashed or was closed`; JSON `endReason`: `crash`, `closed` or `timeout`, and `endedAt` in epoch ms), until the session starts again or `bdg cleanup` clears it. A directory made by an earlier build whose name differs only in case (`ALPHA`) is listed as the session `--session alpha` reaches when that is the same directory (case-insensitive file systems), with the usual `bdg cleanup --session alpha`; directories `--session` cannot reach (`--json`, or `ALPHA` on a case-sensitive file system) are listed as `stale` with an `rm -rf <path>` to remove them by hand
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
bdg peek --full                 # Console message texts whole
```

Console message texts are cut like `bdg console --list` cuts them: at 200 characters followed by `… N more chars (use --full)` (the compact view also at 2 lines). In `--json` a text over 10000 characters is cut with `truncatedFrom` (its original length). `--full` prints them whole.

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
bdg peek --follow                     # Live updates every second (like tail -f)
bdg peek --follow --last 50           # Show last 50 items
bdg peek --follow --console           # Show only console messages
bdg peek --follow --type XHR,Fetch    # Only API requests
bdg peek --follow --interval 2000     # Custom update interval (100-60000 ms)
bdg peek --follow --verbose           # Verbose output (full URLs, resource and MIME types)
```

`bdg tail` still works with the same options but is deprecated: it prints a note and runs `peek --follow`. `--interval` without `--follow` exits 81.

Follow modes (`peek --follow`, `console --follow`, `network list --follow`):
- Ctrl-C exits 130 and SIGTERM 143, as shells expect.
- With `--json` they print one compact object per line (NDJSON), so a script can parse each line as it comes.
- They stop with exit 83 when the session they follow ends (`The session ended; stopped following`), so a follower running in the background finds out.
- Other failures (a busy page, a timeout) are retried: reported once in text, and as one error line per refresh with `--json`.

### Get full details
```bash
bdg details network <requestId>     # Full request/response with bodies
bdg details console <index>         # Full console message with args
```

Binary response bodies (images, fonts) are only captured in sessions started with `--all`; in `--json` output they are base64 with `responseBodyBase64: true`.

A response body bdg did not capture is reported with the reason instead (`bodyNotCaptured` in `--json`, `(not captured: …)` in text, the `content.comment` in a HAR): a binary or too large body, a resource skipped by default, a body evicted at the total body budget, or one Chrome no longer had when bdg asked for it (`Chrome no longer had the body (its network buffer evicted it, or the request was cancelled)`, e.g. after several large requests in a row; another error fetching it gives `Chrome did not return the body: <error>`). Responses that have no body (HEAD, 204, 205, 304) get no reason.

`details network` shows the address Chrome connected to with its port (`Remote Address: 93.184.215.14:443`; `serverIPAddress` and `serverPort` in JSON). Behind a proxy that is the proxy's address. CDP has no proxy flag, so bdg guesses: a loopback address on another port than the URL's (its explicit port, else 80/443) for a host that is not this machine is labelled `127.0.0.1:9000 (loopback; likely a local proxy)`. A host mapped to loopback in `/etc/hosts` (`myapp.test`) is connected to on the URL's port and gets no label; a proxy on another machine cannot be told apart from the server. A header the server sent several times (CDP joins the values with newlines) is listed one value per line, and a value repeated verbatim once, with how often it was sent: `Strict-Transport-Security: max-age=63072000 (sent 2 times)`. `Set-Cookie` lines are all listed, repeated ones too. `--json` keeps the header as CDP reported it.

## DOM Commands

### Pages that replace built-ins

Some pages replace JavaScript built-ins, e.g. polyfills, old frameworks (Prototype.js, MooTools), analytics wrappers or anti-bot scripts: `Element.prototype.querySelectorAll`, `JSON.stringify`, `Array.prototype.map`. bdg's own page scripts therefore run in an isolated world of their own (`bdg` in DevTools' context menu). It shares the page's DOM but keeps the browser's built-ins.
- `dom query`, `get`, `inspect`, `layout`, `audit`, `wait`, `form`, `a11y`, `screenshot` and the element lookup of actions find and describe the same elements as on any page. Same-origin iframes are searched from that world too.
- Actions (`click`, `fill`, `hover`, `pressKey`, `scroll`, `submit`) still act in the page's world, so the page's event handlers see them. When the page replaced the selector search (`querySelectorAll`, `matches`, the NodeList or Array iterator, `Array.prototype.map`, …), the element is found in bdg's world and handed over. The result then warns: `the page replaced built-ins bdg's scripts use (…); bdg found the element in its own world, but the action runs in the page's and may misbehave`. The warning names four; `--json` lists all in `replacedBuiltins`.
- Action scripts avoid the built-ins pages most often replace: the disabled check reads the element's own attributes (not `matches(':disabled')`), events come from `document.createEvent` (MooTools 1.2 replaces `Event`), and option lists and the click probe use no `Array.from` or `forEach`.
- Anti-bot scripts make DOM APIs throw (`getBoundingClientRect`, `getComputedStyle`, `scrollIntoView`, `focus`, `dispatchEvent`, the `value` setter). When an action's script throws on a page that replaced built-ins it uses, the error names all of them and what was thrown, exit 90: `The page replaced built-ins bdg's click script uses (Element.prototype.getBoundingClientRect), and the script failed: Error: anti-bot: gBCR`. A failed fill may already have written the value without the page seeing input or change events. Other failures on such a page add the replaced built-ins to the suggestion and point to `bdg dom eval`.
- Whether a built-in was replaced comes from CDP's description of the function, so a page that also replaces `Function.prototype.toString` or `.call` cannot hide it or make every built-in look replaced. A getter or setter the page defined (`window.getComputedStyle`, `HTMLInputElement.prototype.value`) counts as replaced.
- `dom eval`, `dom listeners` (which reads React and jQuery handlers) and `bdg cdp` run in the page's world, as before. `dom eval` copies an object result with the page's built-ins (`Object.keys`, `Function.prototype.call`, …) only when the page left them alone. Otherwise the browser copies it: JSON-like values exactly, `undefined`, NaN, functions, DOM nodes, dates, maps and sets as null or `{}`, with a warning naming the replaced built-ins (stderr; JSON `warning`). A result the browser cannot copy either (a cycle, a BigInt) is shown as its preview string, with a warning.

### Selectors

DOM commands (`query`, `get`, `click`, `fill`, `hover`, `pressKey`, `scroll`, `submit`, `layout`, `wait`, `listeners`, `screenshot --selector/--scroll`, `a11y describe`) take CSS selectors and search the page like a user sees it: the document, open shadow roots and same-origin iframes (nested ones included). Closed shadow roots and cross-origin iframes cannot be searched: use `bdg dom eval --frame <frame>` for a cross-origin iframe (see `bdg dom frames`). A selector cannot cross into a shadow root (`my-modal form` matches nothing even when the form is in `my-modal`'s open shadow root), but none needs to: `form` finds it. A selector that finds nothing because of that says so (`my-modal hosts a shadow root, which a selector cannot cross into; bdg searches open shadow roots itself: use "form"`).

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

**Fields a user cannot change** exit 81 with the reason: `The element is disabled (disabled attribute)` (or `inside a disabled <fieldset>`, `aria-disabled="true"`), `The element is read-only (readonly attribute)` (or `contenteditable="false"`, also on the editor around the element, e.g. TinyMCE in read-only mode, and `aria-readonly="true"`), `The element is inert (inside an inert element)`; any other element says it is not an input, textarea, select or contenteditable element.

```bash
bdg dom fill 'label:has-text("Customer name")' "Ada"   # Fills the field the label names
bdg dom fill "sl-input" "Ada"                          # A web component: fills the one field in its shadow root
bdg dom click 'label:text-is("Remember me")'            # Checks the checkbox
```

### Accessibility Tree Inspection

Inspect the accessibility tree exposed by Chrome DevTools Protocol.

```bash
# View full accessibility tree
bdg dom a11y tree               # The first 50 nodes, depth-first, indented
bdg dom a11y tree --json        # The same 50 nodes as JSON, with count and omitted
bdg dom a11y tree --depth 3     # Only the top levels (0 = root only)
bdg dom a11y tree --limit 0     # Every listed node (megabytes of JSON on a long page)

# Query nodes by role, name, or description
bdg dom a11y query role=button                    # Find all buttons
bdg dom a11y query name=Submit                    # Find by accessible name (substring, case-insensitive)
bdg dom a11y query 'name=E-mail address:'         # A name with spaces or colons: quote the whole field
bdg dom a11y query 'role=textbox name=E-mail address:'  # Combine criteria (AND logic)
bdg dom a11y query 'description=Click to submit'  # Find by description
bdg dom a11y query role=button --json             # JSON output
bdg dom a11y query role=link --limit 0            # List all matches (default: the first 50; --json: 100)
bdg dom click 0                                   # Act on a match by its index

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
- Text boxes, blank text, text repeating its parent's name and nameless layout wrappers (`generic`, `none`, `presentation`, layout tables) are left out; their children move up a level
- `a11y tree` lists the first 50 nodes depth-first, in human and JSON output (`--limit <n>`, `0` for all; `--depth <n>` lists only the top levels, `0` the root). A cut tree ends with `Showing the first 50 nodes` and `20067 more: --limit 0 lists all, --depth <n> limits the levels, or search with bdg dom a11y query "role:<role>"`. JSON has `count` (every node of the tree), `nodes` (each with its `depth`, 0 = the root, instead of `childIds`), `omitted` (nodes cut by `--limit` or `--depth`) and `skipped` (text boxes, blank or repeated text, nameless wrappers: never listed, also not with `--limit 0`), so `count` = listed + `omitted` + `skipped`. For the raw tree with every node: `bdg cdp Accessibility.getFullAXTree --json`. On Wikipedia "United States" the default JSON is 7 KB; `--limit 0` is 2.6 MB
- `a11y query` lists each element once (an element the page and its frame's tree both report is not repeated) and the first 50 matches in human output, 100 with `--json` (`--limit <n>`, `0` for all; `... and 213 more` says how many it left out; `count` is the total and `omitted` the rest). All matches are indexed: `bdg dom click 55`, `fill`, `hover`, `pressKey`, `scroll`, `submit`, `layout`, `get` and `listeners` take them, also for an element of a cross-origin iframe of the same site, such as a consent dialog served from a subdomain (its scripts then run in that iframe, mouse events land on it through the iframe's position and scale, including its border, padding, `transform: scale()` and `zoom`, and `layout` places it in the top-level page; a rotated or skewed iframe, or one that cannot be measured, exits 83 rather than clicking somewhere else)

**JSON Output (jq-friendly):**

The `--json` output returns nodes as an array for natural jq filtering. To search the whole tree, `bdg dom a11y query` is cheaper; `--limit 0` filters every node:

```bash
# Get first node
bdg dom a11y tree --json | jq '.data.nodes[0]'

# Find all checkboxes (or: bdg dom a11y query role=checkbox)
bdg dom a11y tree --json --limit 0 | jq '[.data.nodes[] | select(.role == "checkbox")]'

# Find by name pattern
bdg dom a11y tree --json --limit 0 | jq '[.data.nodes[] | select(.name | test("submit"; "i"))]'

# Outline: roles and names of the top levels
bdg dom a11y tree --json --depth 2 --limit 0 | jq '.data.nodes[] | {depth, role, name}'
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
bdg dom get ".nav-link" --index 2             # Third match (0-based; --nth is an alias)
bdg dom get                                   # The body (default selector)
bdg dom get "#content"                        # [Generic] <div> + a Text: line (up to 500 characters)
bdg dom get "#content" --full                 # All of its text
bdg dom get "#tinymce"                        # [Generic] "Rich Text Area…" + Text: Your content… (name differs from the text)

# Raw HTML output
bdg dom get "h1" --raw                        # Get full HTML with attributes
bdg dom get "button" --raw --all             # Get all matching elements
bdg dom get "button" --raw --index 2         # Get 3rd matching element (0-based)
bdg dom get --node-id 123                    # Get by node id (from query/get --raw or a11y describe)
bdg dom get body --raw --full                # All of the HTML (default: the first 20000 characters)

# JSON output
bdg dom get "h1" --json                       # A11y node structure as JSON
bdg dom get "h1" --raw --json                # HTML as JSON
```

`--raw` prints the first 20000 characters of each element's HTML followed by `… N more chars (use --full)`; in `--json` an `outerHTML` over 20000 characters is cut with `truncatedFrom` (its original length). `--full` prints it whole.

**Semantic vs Raw HTML:**

| Feature | Semantic (Default) | Raw HTML (`--raw`) |
|---------|-------------------|-------------------|
| **Token Efficiency** | 70-99% reduction | Full HTML |
| **Use Case** | AI agents, automation | Debugging, inspection |
| **Format** | `[Role] "Name" (properties)` | Complete HTML with attributes |
| **Filtering** | First match, or `--index` | `--all`, `--index`, `--node-id` |

**Semantic Output Examples:**
```text
[Heading L1] "Welcome"
[Button] "Submit Form" (focusable)
[Link] "Learn more" (focusable)
[Searchbox] "Search" (focusable, required)
[Navigation] "Main menu"
[Paragraph]
[Generic] <div#content>
Text: Welcome to the docs. This guide covers ... (cut at 500 characters; --full shows all of it)
```

An element whose text is longer than the one-line preview gets a `Text:` line with up to 500 characters of it (whitespace collapsed); `--json` has it as `domContext.text`. An element without text or name says what it holds instead: `No text; holds 1 element: iframe (see its HTML with --raw)` (`domContext.children`, `childCount`), e.g. a body that only holds an error page's iframe. A web component says what its shadow root holds, with aria-labels: `No text; its shadow root holds 1 element: button.icon-button "Close" (see it with bdg dom inspect)` (`domContext.shadowChildren: true`). Scripts, styles and templates are not listed.

**When to use `--raw`:**
- Need exact HTML structure with classes and attributes
- Multiple elements required (`--all`)
- Specific element selection by node id (`--node-id`)
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
bdg dom query "button" --json                 # JSON output
bdg dom query "div" --limit 0                 # Every match (slower on a large page)
```

**Output:**
- Shows the count of all matches and a preview of the first 50 (`--json`: 100), with `... and 49953 more (--limit 0 lists all; indices 0-999 work with other commands)`; `--limit <n>` lists that many (0 = all). JSON has `count` (all matches), `nodes` (the listed ones), `omitted` and, when not every match can be used by index, `indexed`
- The first 1000 matches (or `--limit` of them, if more) are described and cached, so indices past the listed ones work with other commands; an index past them says so and how to index more. A page with 50000 matches answers in about half a second instead of 20 s
- Lists nodeId, tag, classes, and text preview (the text as rendered: hidden parts left out)
- Each match shows the attributes that identify it by its type, in its tag: id, name and type, then for `img` the file name of `src` and `alt`, for `a` its `href`, for `input` its placeholder and current value (checkboxes and radios their `value` attribute and `checked`), for `textarea` its name, placeholder and value, for `button` its type (in a form also without a type attribute: `submit`), for `select` its name and the selected option (`selected="Price (low to high)"`), for `iframe` the host of `src`, and for `form` its `action` and `method`, e.g. `[0] <img src="…/sl-404-Cq1a9k9X.jpg" alt="Sauce Labs Backpack" class="inventory_item_img">`. Absolute URLs keep `//` before the host (`href="//saucelabs.com"`) so they do not read as relative paths; values over 40 characters are cut in the middle. `--json` has the full values in `attributes` on each node (an object; keys by element type as above, all strings except `checked`, a boolean; absent for other elements), e.g. `{ "src": "/assets/sl-404-Cq1a9k9X.jpg", "alt": "…" }`; `dom get` shows the same attributes after the role (`[Image] "Sauce Labs Backpack" src="…/sl-404-Cq1a9k9X.jpg"`, `domContext.attributes` in JSON, also in `dom a11y describe`), leaving out values equal to the accessible name
- Secret values never leave the page, in human output or JSON: a hidden input's value is not read, and the value (or a select's selected option) of a sensitive field is replaced by `••••` whatever its length. Sensitive means a password field (live type or type attribute), a field masked by CSS (`-webkit-text-security`), `autocomplete` `cc-*`, `one-time-code`, `current-password` or `new-password`, or a field whose name, id or autocomplete looks like a password, one-time code, PIN, social security number or card data (`password`, `passwd`, `pwd`, `passcode`, `passphrase`, `otp`, `pin`, `ssn`, `cvv`, `cvc`, `card_number`/`cardNo`; this covers a password field switched to text by a "show password" button). `dom get` and `a11y describe` mask the accessibility value of such a field too (`domContext.sensitive: true`). `dom get --raw` and `dom eval` still show the page's HTML and values as they are
- Selectors search open shadow roots and same-origin iframes, not closed shadow roots or cross-origin iframes (see [Selectors](#selectors))
- No match exits 83, like `dom get` and `dom a11y`
- Matches outside the viewport or hidden get a hint: `(below fold)`, `(above viewport)`, `(left of viewport)`, `(right of viewport)`, `(hidden)`, or `(out of view in ul#list)` for one scrolled out of a container; `--json` has `inViewport` (and `clippedBy`) for the first 100 matches (see `dom layout`). When more are listed, a note says so (`Visibility is checked for the first 100 matches only`, JSON `viewportChecked: 100`)
- `<option>` elements show their `value` attribute and label: `[2] <option value="ca"> Canada (hidden)`
- Text previews (here, in `dom get`, `dom layout` and action output) leave out close buttons (`.close`, `aria-label="Close"`/`"Dismiss"`, a button or link showing just `×`) and `aria-hidden` icons, so a flash message does not end in `×`
- Text previews (here, in `dom get`, `dom layout`, `dom inspect` and action output) read web components as they render: the text a component draws from its shadow root (its labels, a dialog title, fallback content of an empty slot), the light-DOM content it shows through a `<slot>` in place of that slot (`<p><slot></slot></p>` reads as the slotted text, not empty), and nothing of light-DOM content no slot shows. Blocks are set apart, so a card reads `Blue Widget $19.99`, not `Blue Widget$19.99`
- A match in a shadow root names its host by the host's visible text, cut at 30 characters with `…`: `(in shadow root of <x-card#c3 "Visible Title Three Body three…">)`
- No match exits 83. For a selector that is a single id or class, the error suggests up to 3 similar ones on the page (`Did you mean #remove-sauce-labs-backpack? (similar id on the page)`; near-typos first, then names sharing their end, then their start); it names cross-origin iframes and `<object>`/`<embed>` documents only when the page has them (selectors do not search them). The same applies to `dom click`, `fill` and the other actions
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
Event listeners for button#save (93: 3 on the element, 74 on ancestors, 16 on document and window)

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
- React: the `on…` handler props React runs for the element's events are listed with their name, source and location, marked `[React onClick]` (`framework: "React"`, `reactProp` in JSON): the element's own, and those of its React parents, found by walking React's fiber tree (so a portal's React parents count, shown by their description, and DOM parents outside the React tree don't; without a fiber, the DOM ancestors). Props are read from `__reactProps$…` (React 17-19), `__reactEventHandlers$…` (React 16) or the fiber's `memoizedProps`, without running getters. The event type comes from the prop (`onClick` → `click`, `onClickCapture` → `click` with `useCapture`, `onDoubleClick` → `dblclick`, `onFocus`/`onBlur` → `focusin`/`focusout` as React listens for them, `onGotPointerCapture` → `gotpointercapture`). Parents' bubble-phase props for events React does not bubble (`onMouseEnter`/`Leave`, `onPointerEnter`/`Leave`, `onScroll`, `onLoad`, `onError`, media events, …) are left out. At most 50 props are listed per call, after `--type` filtering (`reactHandlersSkipped` counts the rest). Nested React roots (a root mounted inside an element of another root) are followed into the outer root from the inner root's container, as React dispatches them, so the outer root's props are listed too
- Preact: Preact runs its handlers from a proxy listener on the element itself; the proxy is replaced by the handler Preact runs, with its name, source and location, marked `[Preact]` (`framework: "Preact"`). The handler is read from the object Preact keeps on the element (`l` in Preact 10, `__e` in 11, `_listeners` unmangled, keyed by event type and capture flag), the key taken from the proxy's own source, without running getters. A listener counts as Preact's proxy when it is named `eventProxy`/`eventProxyCapture` (unminified builds; Preact 8 keys by type alone), or when it is a short function that reads exactly the type plus its capture flag and calls that handler with the event; other dispatchers (`this.handlers[e.type](e)`) are listed as they are
- jQuery: when the page has jQuery (`jQuery._data`), its dispatcher is replaced by the jQuery handlers it runs for the element, with their real name, source and location, marked `[jQuery]`; delegated ones (`$(document).on('click', '.row', fn)`) show `delegate .row` and only when the element matches the selector. A jQuery dispatcher none of whose handlers run for the element (its delegates match other elements) is left out. At most 50 jQuery handlers are resolved per call; beyond that the dispatcher is listed as is and a note (`jqueryHandlersSkipped` in JSON) says how many were not resolved. A page whose `jQuery`/`$` globals throw only loses the jQuery details
- When an interaction event (click, input, keydown, …) has no listener of its own on the element (`[no-op]` aside), a note says how it reaches its handlers: React's `[no-op]` placeholder next to resolved React handlers, a React root container without an `on…` prop for it, jQuery delegation, or plain listeners on ancestors, document or window
- The heading names the cached index and the iframe holding the element and says where the counted listeners are (`Event listeners for p [2] in iframe#sd (3: 1 on the element, 2 on ancestors)`; framework roots count all their listeners)
- No listeners at all is not an error (exit 0); a selector without match exits 83, an `--index` out of range 81. A `--type` that matches nothing but is close to a listened type (`Click`, `onclick`) suggests it (`typeSuggestions` in JSON)
- Elements in open shadow roots and same-origin iframes are found like with the other DOM commands
- Uses `DOMDebugger.getEventListeners`; the Debugger domain is not enabled, so `debugger;` statements do not pause the page

**JSON (`data`):** `{ selector, index?, element, frame?, matchCount?, warning?, typeSuggestions?, jqueryHandlersSkipped?, reactHandlersSkipped?, listeners: [{ type, on: "target"|"ancestor"|"document"|"window", node, useCapture, passive, once, noop?, framework?: "jQuery"|"Preact"|"React", reactProp?, delegateSelector?, handler: { name, preview, scriptId, lineNumber, columnNumber } }], collapsed?: [{ on, node, framework?, types, count, capture, bubble, handlers: [{ name, preview, scriptId, lineNumber, columnNumber }] }] }`

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
- `inViewport`: `visible`, `partly` (with `percentVisible`), `above`, `below`, `left`, `right` or `hidden` (with `hiddenReason`: `display: none`, `visibility: hidden`, zero size, `display: contents (no box of its own)` when none of its children shows (an open `display: contents` dialog component is measured by the box around what it shows, in its shadow root too), `inside a closed <details>`, `content-visibility: hidden on div#…`, `clipped by div#acc: zero height` for content of a collapsed `height: 0; overflow: hidden` accordion, inside a hidden iframe). Human output shows no coordinates for hidden elements
- Same-origin iframes and overflow containers (scroll lists, `overflow: hidden`) clip what counts as visible, following containing blocks (an absolutely positioned dropdown escapes a static `overflow: hidden` parent; fixed elements are not clipped). CSS `zoom` and `transform: scale()` on or around a container are taken into account. A `<body>` that scrolls on its own (the root element has `overflow` other than `visible`) clips like any container. When one cuts the element off, `clippedBy` names it (`out of view in ul#list (below)`, `out of view in body (below)`) and there is no `scrollBy`
- `scrollBy`: the page scroll (`bdg dom scroll --down/--up/--right/--left`) that brings an element fully into view; limited to how far the page can actually scroll. An element out of view is centred (the top of one taller than the viewport is aligned), like `bdg dom scroll <selector>`, so sticky headers and fixed footers at the edges do not cover it: `(scroll down 500px to centre it)`, or `to bring it into view` for an element larger than the viewport. For a partly visible element it is the smallest scroll that shows all of it, the part cut off at the top or bottom: `partly visible (87%); scroll up 5px to see all of it` (`to show it from its start`, aligning its top, when it is larger than the viewport). An element a page script moves when the page scrolls (a floating menu) may move again after that scroll
- `offScreenReason` replaces `scrollBy` when no page scroll can bring the element fully into view: `fixed position, page scroll does not move it` (the element or a container is `position: fixed` relative to the viewport, e.g. an off-canvas menu; a fixed element inside a transformed container scrolls with the page and gets `scrollBy`), `sticky position, page scroll moves it only until it sticks` (it or an ancestor is `position: sticky`, so the scroll needed cannot be told) or `beyond the page's scroll range` (e.g. a `left: -9999px` skip link). The position (`left`, `above`, `partly`, …) is kept; human output shows `left of viewport (off-screen: …)`, or `partly visible (40%); fixed position, …`
- Scroll-locked pages: when the page cannot scroll (the document is no taller than the viewport) because `body` or `html` is `position: fixed` or `overflow: hidden`, as a consent or modal dialog does, content below the fold gets `page scrolling is locked (position: fixed, overflow: hidden on body)` instead (in-flow content of a fixed `body` is not called fixed). When a visible dialog is on the page (`dialog[open]`, `[aria-modal=true]`, `[role=dialog]`, `[role=alertdialog]`), it is named as the likely cause: `…, likely by dialog div#sp_message_container_1482251`. Human output: `below fold; page scrolling is locked (…)`. Close the dialog first
- The page line names the `prefers-color-scheme` the page sees (`…, prefers-color-scheme: dark`; `page.colorScheme` in JSON), the media preference, not the theme the page renders. `page.viewport` is the layout viewport without scrollbars, the same size `dom scroll` reports
- `coveredBy`: the topmost element at the center of the largest visible box (a wrapped link has one per line), when it is another element (not one inside it), e.g. a modal backdrop or sticky header; overlays over an iframe count too. Elements of the same click target do not count, since a click there does the same: an overlay inside the link, button or label the element is in, a link to the same URL, or the overlay link of a news card over its plain headline (a "faux block link": an absolutely positioned link without text of its own spanning the card). Links with text, `[role=button]` overlays and dismiss buttons still count as covers. An ancestor counts only when it is painted above the element, e.g. a card's `::after` overlay (`dom click` reports the same element). Where the viewport or a scroll container has overlay scrollbars (macOS, mobile; they take no space), the 16 px strip along its right and bottom edges is avoided when the element shows outside it, because those scrollbars catch hit tests for about a second after a scroll. Not reported for elements hit-testing skips (`pointer-events: none`)
- `inert: true` for elements inside an `inert` element (through shadow roots): shown, but not interactive; human output adds `inert`
- `masked`: a `mask-image` on the element or an ancestor (`mask-image on div.hero`; human output `masked by …`, `dom inspect` `[masked by …]`). How much the mask hides is not evaluated, so part or all of the element may not show
- `invisible`: why an element that is rendered still cannot be seen: `opacity: 0` on it or an ancestor, including a slot or shadow wrapper around slotted content (`opacity: 0 on div#menu`), or a `clip-path: inset()` / `clip: rect()` that cuts it away entirely (the "visually hidden" pattern). These elements keep their `inViewport` and count as visible for `:visible` (like Playwright); human output adds the reason
- Elements in open shadow roots and same-origin iframes are found like with the other DOM commands; one page-side pass measures them all
- Known limit: CSS transforms on iframes (and zoom) are not applied to the offsets of elements inside them; a rotated or skewed container (or one inside a rotated or skewed ancestor) clips at its unscaled size from its bounding box's corner

**JSON (`data`):** `{ selector, count, omitted?, page: { viewport: { width, height }, scroll: { x, y }, document: { width, height }, colorScheme? }, elements: [{ index, tag, element, text?, context?, bounds: { x, y, width, height }, viewport: { x, y }, inViewport, percentVisible?, hiddenReason?, scrollBy?: { x, y }, clippedBy?, offScreenReason?, coveredBy?, invisible?, inert?, computed: { display, visibility, position, opacity, zIndex } }] }`

### Element Styles

What one element looks like, without a screenshot: the facts Figma's Dev Mode or the DevTools Computed pane show, grouped and with values that change nothing left out. Takes a selector (the first rendered match, or one with `--index`) or a cached index (`dom query`, `dom form`, `dom a11y query`).

```bash
bdg dom inspect "#login-button"              # Styles and child tree
bdg dom inspect ".card" --tree 3             # Deeper child tree (--tree 0 for none, --tree-limit n rows)
bdg dom inspect 0                            # Cached index
bdg dom inspect "h1" --props font-size,color,--brand   # Only these properties
bdg dom inspect "h1" --all                   # Every property that differs from the element's default
bdg dom inspect "#save" --json               # Figma-aligned JSON
bdg dom inspect ".btn-primary" --rules       # Which CSS rule sets each shown property
bdg dom inspect "h1" --why font-size         # Every declaration of one property, the winner first
bdg dom inspect ".btn" --props color --rules # Only these properties, with the rules that set them
bdg dom inspect "#hero" --no-hints           # Skip the "has no effect" hints
```

**Output** (saucedemo's username field and Bootstrap's card example):
```text
input#user-name.input_error.form_input placeholder "Username" 292x39 @814,154
box    p 10 0 · b 0 0 1 · sizing content-box · overflow clip
layout inline-block
parent div.form_group block · in-parent l0 t0 r0 b0
text   DM Sans (webfont loaded) 400 14/normal · color #484c55 · contrast 8.6 AAA · align start
fill   bg #fff
border bottom 1 solid #ededed
state  cursor text · appearance none
pseudo ::placeholder color #6d7584 · contrast 4.63 AA

div.card 288x372 @582,679 [flex] [dark theme from system; --color-scheme light for light]
box    b 1
layout flex column · position relative
parent div.bd-example.m-0 block · in-parent l0 t0 r466.8 b0
fill   bg #212529
border 1 solid #ffffff26 · radius 6
tree
  svg.bd-placeholder-img 286x180
    rect 286x180
    text 83x21 "Image cap"
  div.card-body 286x190
    h5.card-title 254x24 "Card title"
    p.card-text 254x72 "Some quick example text to bui…"
    a.btn 135x38 "Go somewhere"
```

- **Header**: element (`tag#id.c1.c2(+N)`), its text or placeholder, size and page position (`WxH @x,y`), `[flex]`/`[grid]`, then why a user might not see it (`[not rendered: display: none]`, `[hidden: …]`, `[offscreen: below]`, `[covered by div#modal]`, as `dom layout` decides; `[under transparent ul.filters (clicks land on it)]` when nothing on top paints there, so the element still shows but a click hits the other one; the cover named is the first element above that paints — a sticky header's background, not the transparent logo on it — and inside a shadow host what its shadow root paints, while an element's own shadow host never covers it). The position is the page position, or for a `position: fixed` element its viewport position (`@0,70 (fixed: viewport position)`), which scrolling does not change. An inline element with zero size around visible floated children is not reported hidden. `[animating: background-color; values are mid-way, inspect again]` marks running CSS transitions and time-based animations (not scroll-driven ones, which do not change on their own) (JSON `animating`), whose values are read mid-way (`--why` adds `(mid-transition: …)` to such a value). `[dark theme from system; --color-scheme light for light]` marks a page rendered in its dark theme because the session follows the system's dark preference: its colors are not what a light-mode visitor sees (start the session with `--color-scheme light` to inspect the light theme). When several elements match and no `--index` is given, the first visible one (not `visibility: hidden` or `opacity: 0`; else the first rendered one) is inspected and a note says so
- **box**: margin `m`, padding `p`, border widths `b` (1–4 values like CSS shorthands), `sizing` when not the default, min/max sizes, `overflow`, and `scroll WxH` when the content is larger than the box
- **layout**: `display` (always), `position` and insets, `z`; flex/grid container settings (direction, wrap, columns/rows, justify, align, gap) and item settings when the parent is flex or grid (flex, self, order, area)
- **parent**: the element that lays it out, its display and layout, `in-parent` distances to its content edges (left, top, right, bottom) and `sib` gaps to the neighbouring siblings: answers "why isn't it centered?" and "what's the spacing?"
- **text** (elements with text, text fields and selects; none for an element without text such as an icon button or a checkbox): `in abbr` first when a descendant draws most of the visible text (text inside an `opacity: 0` descendant, such as a measuring copy, does not count) (`<a><abbr>t</abbr></a>`, text slotted into a shadow root: `in slot.label`) — the line then describes that descendant's text (`holder` in JSON); then the first font family, then in parentheses the font Chrome actually rendered when it is a fallback (`Arial (rendered "Liberation Sans")`, which catches a font that failed to load; faces of the declared family such as `DM Sans 9pt`, unreadable internal names, and any name of a web font the page loaded for that family — font files name themselves `Copyright Klim Type Foundry` or point at a local font — are not shown), or the font a generic family became (`sans-serif (resolves to "Helvetica")`, JSON `resolved`) and `webfont loaded` when the text was drawn with a downloaded font; weight and size/line-height (`400 14/20`), color, the WCAG contrast ratio against the background behind the text (ancestors composited, rounded down, so 4.49 never shows as 4.5) with `AAA`/`AA`/`AA large`/`fail`, `on #fff` when that background comes from an ancestor (`inherited` in JSON), `(faded: opacity 0.4)` when it or an ancestor is translucent (each translucent element fades its own background along with the text, as the browser composites them: white text in an `opacity: .5` black box reads `on #808080`); `≈` and `(approximate: …)` without a pass/fail level (JSON `approximate`; `level` is still the estimate's) when the number cannot be exact: a background image or gradient behind the text, a `mix-blend-mode` or `filter` on the text or an ancestor, content painted behind the text that is not its ancestor (`img behind`, `canvas behind`, a positioned layer, unless one of the text's own opaque backgrounds hides it) or on top of it (`div.overlay on top`) — these two are found by hit-testing (also layers with `pointer-events: none`), so only for text in the viewport; alignment (always, `start` included), transform, letter spacing, decoration, white-space, text-overflow and line clamp, font features. No contrast for text no one can see (not rendered, `opacity: 0`, `visibility: hidden`). A container shows only what it sets differently from its parent, with the font its text was rendered in
- **fill**: background color, each image or gradient layer (file name) with its own size and position (`size 16 12 at calc(100% - 12px) 50%`), `clipped to the text` for gradient text (`background-clip: text`), opacity, blend mode; for an SVG element its `fill` and `stroke` (with width). **border**: one line when all sides match, else per side; radius; outline. **fx**: shadows (transparent layers dropped), transform, filter, backdrop, clip-path, mask, animation. **state**: cursor, `pointer-events: none`, visibility, `user-select: none`, `appearance: none`
- **pseudo**: `::before`/`::after` with content (position and `inset` offsets, size, background, shadow, transform); `bdg dom inspect "a::after"` inspects the link and says its pseudo-element is on this line and a field's `::placeholder` color, its style and weight when not the field's, and its own contrast (`::placeholder color #e6e6e6 italic · contrast 1.23 fail on #fefefe`); the text line's contrast is the typed text's
- **tree**: children to depth 2 (`--tree`), one line each with size, `[flex]`/`[grid]` and text; `(shadow root)` for rows in a shadow root, `via slot.label` / `via div.row (contents)` for rows reached through a slot or a `display: contents` wrapper, and a text-only slot as `slot.label (contents) "Text"`; identical siblings grouped (`li.item ×33 266x107`), children that are not rendered counted (`(+N not rendered)`), at most 20 rows (`--tree-limit`)
- Sizes are the rendered border box (`292x39`); `--props height` gives the CSS value, which for `box-sizing: content-box` excludes padding and border (`height: 18px`). With `--viewport 1280x800`, a page with a vertical scrollbar has 1265 px of room: the scrollbar takes the rest
- `--props` with a shorthand whose sides differ (`border` with only a bottom line) gives each side: `border: top 0px none … / bottom 1px solid …`
- Values: colors as hex (`#rrggbb`, `#rrggbbaa`; `lab()`/`oklch()`/`color()` from Tailwind v4 converted), lengths in px without the unit, rounded to 0.1. Values that change nothing (0, `none`, `transparent`, `normal`) are left out; custom properties, logical duplicates and `currentColor` echoes are never listed (`--props --brand` reads one; `(not set)` when no rule sets it; `--props '--*'` lists every custom property the element has, its own and inherited, and `--props '--bs-btn-*'` those with a prefix)
- Secrets are never shown: hidden inputs and password, card and one-time-code fields have no value or placeholder text from their content
- Elements in open shadow roots, same-origin iframes and same-process cross-origin frames work like with the other DOM commands. `display: none` elements are still inspected (`[not rendered]`, no box). Not found exits 83; a stale cached index exits 87; an unknown `--props` name exits 81 with a suggestion
- **hints** (by default): declarations on the element that have no effect, why, the fix and where they are: `justify-content: center has no effect: display is block → use display: flex or grid on this element · in #hero (app.css:24)`. Checked: flex/grid container properties without flex or grid, item properties (`flex-grow`, `align-self`, `order`, grid placement) when the parent is not flex or grid, offsets and `z-index` on static elements, sizes and vertical margins on inline elements, `vertical-align` on blocks (`display is flex (inline-flex blockified: a flex item)` when a flex item turned the declared inline display into a block one), `text-overflow` without `overflow: hidden`, `float` in a flex or grid container, `object-fit` on non-replaced elements, `align-content` on single-line flex containers, and `var()` of a custom property that is not set (nor its fallback): when the page sets it elsewhere the hint says where (`--variant-textBg is set only by .btn:hover, which does not match now`, `only in @keyframes detect-scroll`, `set to inherit by :root, and nothing above gives it a value`), else it names a similar one that is set (`did you mean --brand? it is set`), and form controls drawn in the browser's font while the parent uses another (`font-family: Arial is the browser's: form controls do not inherit the font (the parent uses Inter) → add font: inherit`). `hints none` means the check ran and found nothing. Declarations that restate a default (`vertical-align: baseline`, `margin-top: 0` from a reset) are not flagged, nor sizes and margins in a vertical `writing-mode`. A shorthand is flagged when none of its parts has an effect, and `margin` also when only its vertical parts do nothing (`margin: 8px 12px has no effect on margin-top, margin-bottom: display is inline`; JSON `only`); `gap` on a multi-column block still spaces the columns. In `--why`, a winner that has no effect says so (`✓ -40px  .tip (…) (no effect: position is static)`), an invalid `var()` says what applies instead (`(falls back to the initial value)`), and `--rules` shows a blockified display (`display inline-flex = flex (blockified)`). Only the element's own author declarations count (not the browser's, not inherited ones). `--no-hints` skips them
- **rules** (`--rules`; with `--props`, for those properties only): for each shown property set by the page's CSS, the value as written (`= #0d6efd` adds the computed value when it uses `var()`), the selector and file position (`bootstrap.min.css:5:53709`: line, plus the column in minified one-line files; `<style> in page:12` for inline stylesheets, `style attribute`), the `@media`/`@container` condition, the cascade layer, `(inherited from the parent)` or `(inherited from N levels up)` and `over …` the rules it beats. Sides one declaration sets are one row (`padding 4px 8px`, `border-width 0px` from `* { border: 0 solid }`, `border 2px solid var(--line)`); browser defaults are not listed
- **why** (`--why <property>`; only the header, hints and the answer are shown): the computed value, then every declaration of that property on the element, highest precedence first: `✓` the one that wins (or the ancestor's it inherits), `✗` the ones it beats, browser defaults included. Each rule shows its selector's specificity (`[0,2,0]`: ids, classes, types), which with order and layers decides between rules. A declaration with `var()` shows its substituted value (`✓ var(--bs-btn-bg) = #0d6efd  .btn (bootstrap.min.css:5:53709)`), or `invalid: --x not set` when a custom property it needs is missing; the `in` line under the winner shows its rule as written (`in .card .btn { background: #9db8ff; }`, or `in style="…"`; for a long minified rule its selector and that declaration: `.btn { … background-color:var(--bs-btn-bg); … }`), and indented lines under it say where its custom properties are set, following ones set from others up to `:root` (`--bs-btn-bg: #0d6efd  .btn-primary (…)`). For an inherited value, the rules the ancestor's winner beat are listed too. Rules for the element that set the property under a `@media` or `@supports` condition that does not apply now are listed last (`- 40px  .resp @media (max-width: 600px) (does not apply now)`), for responsive checks. A shorthand (`--why padding`, `--why transition`, any shorthand the browser knows) gives one answer when one declaration sets all its longhands (`✓ padding: 6px 12px`; the computed value as the browser writes the shorthand), else one per longhand. A name that is not a CSS property exits 81 with the closest one (`--why colour` → `Did you mean: color?`). Inherited properties (`color`, `caret-color`, `overflow-wrap`, SVG `fill`, …) come from the nearest ancestor that sets them; a custom property registered with `inherits: false` does not. For a selector list (`h1, .title`) the matching selector with the highest specificity is named. The cascade is computed by bdg from Chrome's matched rules: origin, `!important`, the style attribute, layers (unlayered rules over layered ones, reversed for `!important`), then specificity and order; shorthands and logical properties count for their longhands
- The matched rules are read within 1 s (5 s with `--rules`/`--why`); on pages with huge stylesheets that take longer, or when Chrome cannot report them, the output says the CSS rules were not read (`cascade: "timeout" | "failed"` in JSON) and the rest is shown. After one such timeout, later default inspects on the same page do not wait for the hints and say `hints skipped: this page's stylesheets are slow to read (--rules waits 5 s)` (`cascade: "skipped"`) until a read is fast again, a stylesheet changes or the page navigates. Rules that took over 300 ms to read are reused for up to 5 s; any bdg command that may change the page (click, fill, key, scroll, eval, navigation, emulation, `bdg cdp`) or a stylesheet or DOM change clears them. Changes made outside bdg within those 5 s (typing or clicking in a headed window) can still show the previous rules; `--no-hints` does not read them, and an inspect run again after 5 s reads fresh ones

**JSON (`data`):** `{ selector, count, index, picked?, element, content?, placeholder?, context?, rect: { x, y, w, h }, visibility, colorScheme?, box?, layout? (incl. sizing: { w, h: hug|fill|fixed }, parent), text?, fills?, opacity?, blend?, strokes?, radius?, outline?, effects?, fx?, state?, pseudo?, children?: [{ element, x, y, w, h, layout?, text?, count?, children?, childCount?, hiddenChildren? }], hiddenChildren?, moreRows?, all?, props?, hints?: [{ kind: inactive|unset-variable|not-inherited, property, value, reason, fix, source }], rules?: [{ property, value, computed?, source, rule?, overrides?, inherited?, important?, layer?, condition? }], why?: [{ property, computed, chain: [{ value, via?, resolved?, unset?, source, rule?, specificity?, status: applied|overridden|inherited, important?, layer?, condition? }], variables?: [{ name, value, source, inherited? }] }], cascade?: 'timeout' | 'failed' | 'skipped' }`. Names follow Figma (fills, strokes, effects, sizing), numbers are numbers, so the output can be compared field by field with a design from the Figma MCP server: see [Checking a page against a Figma design](FIGMA_DESIGN_QA.md). Tree rows have `x`/`y` relative to the parent's border box, like Figma's position in a frame.

### Page-Wide Audits

```bash
bdg dom audit                          # Every check below
bdg dom audit contrast                 # Text below WCAG AA, weakest first
bdg dom audit contrast --level AAA     # ... below AAA
bdg dom audit overflow                 # What scrolls sideways, cut-off text, scaled images
bdg dom audit layers animations        # Fixed/sticky elements, running animations
bdg dom audit --limit 50 --json        # More findings per check, as JSON
bdg css search "oklch("                # Rules that use a text, in every stylesheet
bdg css search -- --brand              # A text that starts with - goes after --
```

`dom audit` walks the rendered elements of the page once (open shadow roots included, at most 20000) and reports per check:
- **contrast**: every element that draws text of its own, below the level (`--level AA`, the default, or `AAA`; large text — 24px, or 18.66px bold — needs less), weakest first with the ratio, the text and background colors (composited like `dom inspect`: translucent ancestors, the page canvas), the size, `(faded: opacity 0.4)` and `(out of view)`. Text whose contrast cannot be measured exactly is not listed as failing but counted (`(+12 more may be below it but cannot be measured …)`, JSON `uncertain`): a background image or gradient behind it, blend modes and filters, content painted behind or on top of text in view (hit-tested like `dom inspect`, `pointer-events: none` layers included), and for text out of view an image or background-image element under its center, or ancestors that paint no background below `body`. Gradient text (`-webkit-text-fill-color: transparent`, also inherited) is skipped. The header says how many of how many fail.
- **overflow**: whether the page is wider than its viewport (it scrolls sideways) and the elements reaching past the right edge, farthest first (content inside a horizontal scroller is left out); text that is cut off (`ellipsis`, line `clamp`, `clip` by `overflow: hidden`; visually-hidden 1px text is left out); images drawn with fewer pixels than the screen needs (`upscaled 1.5x`, counting the pixel ratio) or with another aspect ratio (`distorted`, unless `object-fit` crops). Identical findings are grouped (`×5`).
- **layers**: `position: fixed` and `sticky` elements with their `z-index`, viewport position and size.
- **animations**: running CSS animations, transitions and Web Animations, with duration, iterations and whether scrolling drives them. Animations scripts draw on a `<canvas>` cannot be seen; visible canvas elements are counted (`(+ 1 canvas element: …)`, JSON `canvases`).

`--limit <n>` lists that many findings per check (default 20; the rest are counted). Follow up on a finding with `bdg dom inspect <element>` (`--why color`, `--rules`). JSON: `{ checks, walked, capped?, contrast?: { level, checked, failing, items: [{ element, text, ratio, color, background, size, weight, inView, approximate? }] }, overflow?: { pageWidth, viewportWidth, scrollsSideways, wide, truncated, images }, layers?, animations?, canvases? }`.

`css search <text>` finds a text (case-insensitive) in every stylesheet of the page, cross-origin ones included (Chrome reads their text, which page scripts cannot), and prints each match's place (`app.css:12`, `bootstrap.min.css:5:52628`, `<style> in index.html:40`) and the rule around it. Use it for "where is `--brand` set", "which rules use `oklch(`" or a class's rules across files.

### Waiting for Elements

`dom click` and the other actions wait for the requests they start, not for results a page shows later (timers, spinners, animations); `click` and `pressKey` say when the page was still changing as they returned (`⚠ Element Clicked (page still changing)`, see below). `bdg dom wait` waits for those instead of `sleep` loops:

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

Long values are cut: human output prints the first 20000 characters followed by `… N more chars (use --full)`. In `--json`:

- a string result over 20000 characters is cut with `truncatedFrom` (its original length)
- an array result lists its first 100 elements, with `count` (all of them) and `omitted`: `{ "result": ["0", "1", …, "99"], "count": 20000, "omitted": 19900, "type": "object", "subtype": "array" }`
- an object or array whose JSON is still over 20000 characters is given as the first 20000 characters of its JSON text (`result` is then a string; `type` stays `object`), with `truncatedFrom` (the length of the whole JSON text of the copied value, see below) and, for an array, `count`. A string `result` with `truncatedFrom` while `type` is `object` is such a JSON-text start, not a string the script returned: `{ "result": "[\"<html><head>…", "count": 20005, "truncatedFrom": 2045247, "type": "object", "subtype": "array" }` (`[...document.querySelectorAll('*')].map(e => e.outerHTML)` on a page with 20000 elements: 23 KB, 3 MB with `--full`)

`--full` prints the whole value (`bdg dom eval document.documentElement.outerHTML --full` is about 3.6 MB on Wikipedia) and copies objects and arrays with every entry. Without `--full`, objects and arrays are copied from the page with at most 1000 entries each (the rest as `"…"`) and 20 levels, so `truncatedFrom` of a longer array is the JSON length of that copy; `count` is still the length of the array in the page.

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
- A returned promise that rejects (`bdg dom eval 'Promise.reject(new Error("x"))'`) exits 91 with its error. Chrome logs it as "Uncaught (in promise)" before bdg attaches its handler, then revokes the report once it does; the console collector drops revoked reports as DevTools does, so the rejection bdg reported leaves no console error. Rejections nothing ever handles stay in `bdg console`; one the page itself handles late is dropped like in DevTools

**Iframes (`--frame`):**

`--frame <frame>` runs the script in one iframe's main world (its own `window`,
`document` and page globals), including cross-origin iframes that Chrome runs in
a separate process. List the frames first:

```bash
bdg dom frames                                    # [0] http://localhost:3000/widget  name=widget  same-origin
                                                  # [1] https://pay.example/  #checkout  cross-origin, out-of-process
                                                  #   [2] about:blank  same-origin  (nested in [1], same origin as it)
bdg dom frames --json                             # { frames: [{ index, url, name?, id?, origin, crossOrigin, outOfProcess, parentIndex? }], readyState? }

bdg dom eval --frame 1 'document.title'           # By index (0-based; the main page is not listed)
bdg dom eval --frame checkout 'location.href'     # By name or id attribute of the <iframe> (exact match first)
bdg dom eval --frame pay.example 'window.config'  # By part of the name, id or URL (case-insensitive)
```

- Human output prints `Frame: <url>` on stderr (hidden with `-q`), so stdout is only the value and pipes into `jq`; `--json` adds `"frame": "<url>"` to `data` (`"frame": ""` for a frame without URL; human output shows `Frame: (no URL)`)
- Everything else works as in the page: top-level `await`, awaited promises, JSON-safe values, 20 s limit, exit 91 when the script throws; a busy frame is reported as "The frame was busy…" (102)
- Several matching frames exit 81 and list them; no match exits 83 and lists all frames
- An index is checked against the last `bdg dom frames` listing: when the frame at that index is another one now (an iframe was added, removed or moved, or the page navigated), `--frame <n>` exits 87 with "Frame index n is stale…" instead of running in the wrong frame; re-run `bdg dom frames`, or pick the frame by name, id or URL. Without a previous listing, an index is used as it is
- Frames are listed in the document order of their `<iframe>` elements (open shadow roots included, a shadow root's content before its host's children), nested ones depth-first (indented below their parent; `parentIndex` in JSON), out-of-process frames at their element's place. Indices stay the same as long as the page's iframes do. Human output shortens URLs over 100 characters and shows `(no URL)` for frames without one; JSON has the full URL
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

Forms shown in an open dialog (`dialog[open]`, `aria-modal`, a dialog role, or a modal without them: a fixed or absolute overlay with a z-index above 0 or a backdrop whose class names a modal or dialog, or a fixed overlay over half the viewport that has a z-index above 0 or lies over other page content at the viewport centre; static wrappers and fixed app shells holding the whole page are not dialogs) are listed first, marked `(in dialog)`, then other visible forms, then hidden ones, marked `(hidden)` (JSON: `hidden`, `inDialog` on forms and in `otherForms`). Indices follow this order, so `bdg dom fill 0` fills the first field listed. Hidden fields (not rendered or visibility-hidden, also through an ancestor) are now listed, flagged with the status `hidden` (`hidden: true` in JSON; they used to be left out), and a form counts as shown when any of its fields or buttons is; filling one by index works but warns (`The field is hidden; a user could not fill it`), and so does filling a field behind an open modal dialog.

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

A download an action starts (a click on an attachment link, a `download` link, a form that answers with a file) is reported after the requests, one line each: `Download: report.txt → /Users/me/.bdg/downloads/report.txt (completed, 15 B)` (`downloads: [{ url, suggestedFilename, path, state, bytes }]` in JSON, absent when none began). In a Chrome bdg launched (headless or not) downloads are saved into `downloads/` of the session directory (created `0700`), never your `~/Downloads`, under the name the page suggested, with ` (1)`, ` (2)`… before the extension when that name is taken, so earlier files are kept. `state` is `completed`, `canceled` (no `path`), or `inProgress` when it was still running as the action returned (no extra waiting: `bytes` is what arrived so far, `… so far` in text); the file appears at the reported `path` once it completes (until then Chrome writes it under its download id in the same directory). Downloads of tabs the page opens (`target="_blank"` links, `window.open()`) are named, reported and listed the same way (bdg receives download events on a browser-level connection). Chrome keeps a download behavior only while the connection that set it is open: if that browser-level connection drops while Chrome still runs, bdg sets it again on the page's connection (logged in `daemon.log`; downloads of new tabs are then still saved in `downloads/`, but under Chrome's download id as the file name (not renamed) and not reported), and if Chrome refuses the behavior, `bdg status` warns `Downloads: ⚠ downloads are not redirected to the session directory (…)` and reports stop naming session-directory paths. When the downloads directory cannot be created (e.g. a file named `downloads` is in its place), the session still starts but refuses downloads rather than letting Chrome save them to `~/Downloads`: each is reported `canceled` with a `reason` (`Download: report.txt (canceled, 0 B: bdg's downloads directory could not be created (…), so downloads are refused)`). Downloads that begin after the action returned are not in its result: `bdg status` (`Downloads: 2 (last: report.txt → …, completed)`, JSON `activity.downloads`) and `bdg peek` (same line, JSON `data.downloads`) list every download of the session. With `--chrome-ws-url` the browser is yours, so it is the exception: downloads go where that Chrome saves them (its download folder, usually `~/Downloads`), not to the session directory. bdg sets the download behavior `default` with events enabled on the page's connection only, so `path` is set only when Chrome reports where it saved the file, and downloads of tabs or popups the page opens are not tracked (no browser-level connection: it would count your other tabs' downloads as the session's, and a Chrome that allows one connection would ask again). Setting `default` replaces a download behavior another CDP client (e.g. Puppeteer or Playwright) set on that browser; Chrome drops bdg's when the session's connection closes. Downloads stay after `bdg stop` and `bdg cleanup` (which says `Downloads kept: N files in <dir>`, JSON `downloadsKept`); `bdg cleanup --purge` deletes a named session's directory, downloads included.

`click` and `hover` scroll the element into view first; when that moved the page, a `Scrolled` row says how far (`page down 1240px to reach it`, JSON `scrolledBy: { x, y }`).

`Element` (`data.element` in JSON) names the element the action hit, by its tag, id, classes and text (a shadow button's slotted label: `button.root "Ok, got it"`), or for an element without text its aria-label, label (`input#user "User"`, `aria-labelledby` too), placeholder, title or image alt (`a#logo "Company logo"`), or the text of a nearby ancestor (`input.toggle in div.view "Write report"`), so a click by index or on one of several matches says which one it was. A numeric index refers to the last `dom query`, `dom form` or `dom a11y query` results (one cache holds the last of them), and the output says which: `Element: h3 "Welcome" (index 0 of the last dom query "h3")` (`data.indexSource: { index, command, query? }`; for an a11y query the `Selector` row is left out, as its pattern is not a selector). Errors name it too: a stale index says `The element at index 0 of the last dom a11y query "name:Accept all" is no longer in the page` and how to refresh it (87), and `fill`/`submit` on an element of a query or a11y query they cannot act on add `index 0 refers to the last dom query results ("h3": h3 "Welcome"); run bdg dom form to target form fields by index`. The status line has a check mark only for a clean success: an action with warnings (covered element clicked with DOM events, click not received, value mismatch, several matches) prints `⚠ Element Clicked (with warnings)` with the warning right below it, before the details and requests.

Actions also say what changed on the page, after the details and before the requests. A navigation is shown as `Page: navigated to https://…/secure (200)` (a new document, also at the same URL, as after a form POST that redirects back) or `Page: URL changed to …/#/active (same document)` (history API, hash), `navigation: { url, sameDocument, status }` in JSON; it comes from CDP events, so it is reported even when the page could not be read. Messages that appeared or changed in alert/status/`aria-live` elements, `<output>` or elements whose class or id has a word like flash, alert, error, toast, notice, message, invalid or feedback are listed as `New text: "Your password is invalid!" (div#flash.flash.error)` (`messages: [{ text, element }]`, at most 3 (then `(+N more)`, JSON `moreMessages`), 120 characters each, without close controls such as the "×" or aria-hidden parts; after a navigation every message of the new page counts). Texts of only digits and time units (clocks, counters) are left out; other text that changes on its own (a rotating banner) can show up. Both are left out when nothing changed. A `click` or `submit` that changed nothing at all (no DOM change, request, navigation, dialog, new window or console message, checked again 300 ms later) prints `⚠ Element Clicked (no visible effect observed: no DOM change, requests or navigation within 300 ms)` and has `effect: "none"`, still exiting 0. It is not claimed with `--no-wait`, for `hover` and `--right`, after a copy or cut, when the click hit a form control, label, media, iframe, popover button, a mailto:/tel:/javascript: or other non-http link, a link to another window or a custom element with a closed shadow root, or when focus moved to an element that is not a button or link; focus/hover class changes on the clicked element don't count as changes, shadow roots attached meanwhile do. Effects outside the DOM (CSS `:hover`/`:focus-within` styles, canvas) are not seen. This costs one page script sent before the action (without waiting for it) and one read after it (about 1 ms on small pages, under 10 ms on large ones); when the page does not answer (a pending navigation), bdg waits at most 200 ms for the snapshot and 250 ms per read.

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

`hover` and `pressKey` also list the elements they showed, after `New text`: `Shown: div.figcaption "name: user2 View profile"` (`shown: [{ text, element }]` in JSON, at most 3, outermost first, 120 characters each; texts already listed as new messages are left out). These are elements with visible text added near the target, such as the item Enter added to a to-do list (`Shown: li "Buy milk"`), and popups and messages added anywhere, such as a tooltip appended to the body. Near means inside the target's form, search box (`role="search"`), dialog or combobox, or, without one, inside its grandparent (its parent when the grandparent is the body); popups and messages are elements with a tooltip, menu, listbox, dialog, alert or status role, `popover`, `aria-live`, or a message-like class or id (flash, alert, error, toast, …). A widget elsewhere on the page that changes meanwhile (a ticker, a chat badge) is left out, and an element re-rendered with the text it had before does not count. For a hover, bdg also notes which elements were hidden right before the mouse moved, among the target's parent and everything in it and the tooltips, menus, listboxes, dialogs and popovers anywhere (up to 1500 elements, within 8 ms), and reports those shown afterwards, so a caption that only a CSS `:hover` rule shows counts too; elements are kept by identity, so content moving in the page does not pass for revealed. Neither claims "no visible effect" (a key press often only changes a field's value, and a hover only styles).

```text
✓ Element Hovered

Selector:      .figure
Element:       div.figure (2nd of 3)
Method:        mouse events
Shown:         div.figcaption "name: user2 View profile"
```

`click` (also `--double`/`--right`) and `pressKey` say when the page was still changing as they returned, so an agent waits for the result instead of reading a half-rendered page: the status line ends `(page still changing)` and a note below it says what was pending, e.g. `⚠ The page was still changing when the click returned (page busy running a script); wait for the result with bdg dom wait <selector>`. JSON has `settled: false` and `pending` with what was seen (absent when the page looked settled; the exit code stays 0):

- `requests`: document, fetch/XHR and script requests the action started that were still running (images, stylesheets, fonts and streams do not count)
- `navigation`: a new page was still loading
- `loading`: a loading indicator that appeared during the action and was still shown (`aria-busy="true"`, `role="progressbar"`, or a class or id word `loading`, `loader` or `spinner`), e.g. `"div#loading"`
- `domChanging`: elements kept being added, removed or changed in bursts: at least 2 within 500 ms with the last one under 150 ms of quiet time ago (or a single one more than 150 ms old, when the page could not run for most of the time since: at most 75 ms of quiet time; this only costs the 250 ms second look, since `domChanging` still needs a fresh change at it), then a second look 250 ms later sees at least one more, with no quiet gap over 150 ms up to that look (text-only changes such as clocks and style animations do not count). Time during which the page's main thread could not run its tasks is not quiet time: while the action is watched, a timer in bdg's own world (not visible to the page, except in the main-world fallback for frame-scoped connections) notes when it runs over 10 ms late, as during a long task or when a starved renderer runs the page's timers late, and that time is left out of each gap. So a page whose changes come 250 ms apart around a 200 ms long task, or whose 50 ms steps come 200 ms apart because its timers run late, is still changing. A render that ends more than 150 ms of quiet time before the second look is settled; one whose last commit comes within 150 ms of it is reported changing. Changes more than about 150 ms apart while the page could run are reported as settled: the first look comes about 150 ms after the action and sees only one of them
- `busy`: the page did not answer within 250 ms, as when a long script runs right after the action (saucedemo's `performance_glitch_user` login). bdg then asks whether the page ran a long task (over 50 ms) since the action began; a page that answers within 250 ms more without one only ran its tasks late (a starved renderer on a loaded machine) and its answer is waited for instead of calling it busy

```text
⚠ Element Clicked (page still changing)
⚠ The page was still changing when the click returned (page busy running a script); wait for the result with bdg dom wait <selector>

Selector:      #login-button
Element:       input#login-button.submit-button.btn_action "Login"
Method:        mouse events
Page:          URL changed to https://www.saucedemo.com/inventory.html (same document)
```

This adds nothing to an action's time except when the DOM looked busy (250 ms plus one read). Not checked with `--no-wait` or for `hover`, `fill`, `scroll` and `submit` (`submit` has its own waits). Work the page starts later on its own (a poller, an animation) is not attributed to the action; a request a poller started during it can be counted. A result that a timer renders later with nothing before it (no DOM change, request or loading indicator, such as `setTimeout(render, 2000)`) is not detected, and such a click can even be reported as having no visible effect: wait for the expected element with `bdg dom wait`. bdg does not wrap the page's timer functions to find out.

`click` and `hover` fall back to DOM events when a real mouse cannot reach the element (covered, hidden, zero-size, `pointer-events: none`) and warn. With `--strict` they refuse instead and exit 90 (`RESOURCE_CONFLICT`: the element exists, but the page's state blocks the request), dispatching nothing, so the page is unchanged; the message names what covers the element and suggests `bdg dom layout`:

```text
Error: Did not click button#covered "Covered": it is covered by another element (div#cover), so a user could not click it (--strict)
See what is in the way with bdg dom layout '#covered', then close the overlay or scroll; without --strict bdg uses DOM events instead
```

`--strict` also fails a click whose mouse press was sent but did not reach the element (the "click may not have reached the element" warning otherwise), saying where it landed when the page saw it: `Did not click button#save "Save": the press did not reach the element (it was sent, but landed on div#overlay) (--strict)`, or `(it was sent, but the page saw no press: the browser may be showing a dialog or bubble that captures input)`. The press is released, and `--double` presses no more.

After `dom fill` the field's value is read back. When it is not the value given (the page rejected, reformatted or moved the input, e.g. a handler that writes it into another field) the command still succeeds (exit 0) but warns first, `The field's value is "" after filling (expected "Lovelace"); the page may have rejected or moved the input`, and JSON has `valueMismatch: { "expected": "Lovelace", "actual": "" }`. When another text field of the form changed to the value given during the fill (values of at least 2 characters), the warning ends `the value appeared in input#first-name instead` (`movedTo`). Values are compared as the browser normalises them (colors case-insensitively, numbers and ranges as numbers, email trimmed, textarea line endings, times without zero seconds); a value the page cut to the field's maxlength is reported as `The value was cut to 10 characters by maxlength` (`truncatedTo`), and a password mismatch only by length (`The password field's value differs from the one filled (length 8, expected 12)`, masked values plus `expectedLength`/`actualLength`). The value is read back separately, a moment after the fill returned and for at most 1 s; when the change navigated the page (a `<select onchange="form.submit()">`) the fill reports success without it. A warning rather than an error, because pages legitimately reformat values (phone masks, trimming, upper-casing).

Failed requests have `failed: true` and `errorText` (no `status`).

A file input takes local file paths (relative to the current directory) and uploads those files to the page: only pass files the task needs.

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
bdg dom hover "nav .menu"                         # Hover (opens hover menus; lists what it showed)
bdg dom hover --off                               # Move the mouse off the page (closes them again)
bdg dom click "#save" --strict                    # Exit 90 instead of DOM events when covered or unreachable
bdg dom fill "#tags" "a,c"                        # <select multiple>: several options

# Navigate the session page
bdg page info                                     # URL and title of the session page
bdg page navigate https://example.com/next        # Load a URL and wait for it
bdg page back                                     # History back / forward
bdg page reload
bdg page emulate --viewport 900x700               # Change the viewport mid-session (responsive checks)
bdg page emulate --color-scheme light             # ...or prefers-color-scheme; --reset clears both

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

A submit whose wait runs out (`--timeout`, exit 102) names what it was waiting on: its page request and how far it got (`timed out after 10000ms waiting for navigation: POST …/authenticate pending for 10s`, `… returned 503 Service Unavailable`, `… failed (net::ERR_…)`), or else the requests still running (`waiting on GET …/app.js (pending 9s) and 2 more`).

Scroll output reports the viewport without scrollbars (`Viewport: 1905×993`) and the page size of the scrolling element, the same numbers as `dom layout`. A page scroll that moved nothing says why, as a warning (still exit 0): `Nothing to scroll: the document is no taller than the viewport (993px)`, `Nothing scrolled: the page is already at the bottom`, or that scrolling may be locked; while the page is still loading it adds `The page is still loading (document.readyState: loading); wait for it with: bdg dom wait --load`.

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
bdg dom screenshot item.png --selector ".item" --index 2   # The third match
bdg dom screenshot btn.png "#submit" --padding 16         # 16px of page around it

# Custom quality
bdg dom screenshot high-res.jpg --quality 100
```

**Element screenshots:** the capture covers the element's border box plus what it paints beyond it: content that overflows (uncleared floats, absolutely positioned or transformed children, text such as descenders past a tight line height) and its own box shadows and outline, so a focus ring is not cropped; `--padding <px>` adds page around it. A container whose floated content hangs out of it is not cropped to its heading; content an `overflow: hidden` ancestor cuts off and fixed descendants are left out. Human output then says `(grown from 940×37 to 940×285 to include what it paints outside its box (…))`, and with `--padding` how much page it added (`with 10px of page around it (--padding)`); JSON keeps the border box in `element.bounds` (page coordinates, like `dom layout`) and adds `element.captured` and `element.padding`; its `captureMode` is `"element"` (`"full_page"` or `"viewport"` for page captures). Elements of a scrolled page are captured where they are (the page scroll is taken into account); an element scrolled into view for the capture is scrolled back afterwards. An element larger than the viewport is captured with the page laid out at its current width without scrollbars, so centered content does not shift by half a scrollbar. An element given both as an argument and with `--selector`/`--index` must be the same one (exit 81 otherwise); `--selector` with `--index` picks that match of the selector.

**Auto-resize behavior:**
- Images exceeding 1568px on longest edge are scaled down
- Tall pages (aspect ratio > 3:1) automatically capture viewport only
- Use `--no-resize` for full resolution when needed; human output says when an image was scaled (`scaled from 1280×2777 to 723×1568; --no-resize for full size`)
- Token estimates account for device pixel ratio (Retina displays)

**Emulation during a capture:** a capture may change the page's emulation (a pixel ratio of 1 on a high-DPI or `--mobile` page, which also turns touch off; the viewport and scrollbars for an area beyond the viewport) and puts it back before it ends, however it ends. Other page commands (`dom`, `page`, `cdp`, from any terminal) wait until it is back (at most 15 s; another screenshot waits until it is done), so none sees the capture's emulation; the wait counts toward the command's 30 s timeout. `status`, `peek` and the telemetry lists do not wait. Ctrl-C on a single capture (not `--follow`, which stops after the current frame) exits 130 at once (SIGTERM 143), also while the element is looked up, with the error envelope under `--json`; the daemon then skips the capture if it has not started and only puts the emulation back.

## Network Commands

### List Network Requests

List and filter captured network requests using Chrome DevTools-compatible filter syntax.

```bash
# List recent requests (default: last 100); long URLs are cut in the middle,
# keeping the host, the start of the path and its end with the query
# (api.example.com/v1/users/…/orders?page=2); --verbose shows them whole
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

**Columns:** `START` is when the request started, counted from the start of the current page (its document request, the latest main-frame navigation): `+0.0s` for the document, `+1.2s` for a request 1.2 s later, whole seconds from 100 s (`+250s`) and minutes from 1000 s (`+17m`); requests of earlier pages are negative (`-35.2s`). It uses Chrome's own timestamps, so it is exact to the millisecond. `TIME` is how long the request took (`-` while pending). The method column widens for `OPTIONS`. JSON fields behind the column (`bdg network list --json`):

- `data.requests[].timestamp` - absolute start, epoch ms (when bdg saw the request start)
- `data.requests[].sentTime` - start in Chrome's monotonic clock, seconds (precise; only differences are meaningful)
- `data.requests[].navigationId` - the main-frame navigation (page load) the request belongs to; the highest one is the current page
- `data.pageStart` - `{ timestamp, sentTime? }` of the current page's document request, which `START` counts from (absent when nothing was captured)

So a request's START in ms is `(sentTime - pageStart.sentTime) * 1000`, or `timestamp - pageStart.timestamp` without `sentTime`.

```text
[ID]         START STS METH    TYP     SIZE   TIME  URL
[17380.1]    +0.0s 200 GET     DOC   1.4 KB  345ms  www.saucedemo.com
[17380.20]   +0.4s 204 OPTIONS OTH        -   95ms  events.backtrace.io/api/uniqu…UNIVERSE&token=TOKEN
[17380.27]   +2.2s 200 GET     IMG    392 B  144ms  www.saucedemo.com/assets/sl-404-Cq1a9k9X.jpg
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
bdg network har --json                    # Returns metadata about exported file (with sanitized: true/false)

# Keep credentials (redacted by default)
bdg network har --include-sensitive full.har
```

**Output:**
- Valid HAR 1.2 format compatible with Chrome DevTools and HAR Viewer
- Includes all request/response data (URLs, methods, headers, bodies)
- **Sanitized by default**, like Chrome DevTools' export since Chrome 130. Values become `[redacted]` for:
  - `Authorization`, `Proxy-Authorization`, `Authentication`, `Cookie`, `Set-Cookie`, `X-*-Key`/`X-*-Token`/`X-*-Secret`/`X-*-Auth*` headers and headers with an `api-key`, `apikey`, `token`, `secret`, `jwt`, `subscription-key` or `session(-id)` segment (`WWW-Authenticate` is kept)
  - every cookie value
  - credential query and fragment parameters (`access_token`, `id_token`, `code`, `sig`, `key`, password/token/secret-like names) in the request URL, `queryString`, `redirectURL` and `Location`/`Referer` headers (`%5Bredacted%5D` in URLs)
  - credential fields of JSON (every primitive under such a name, at any depth), form-urlencoded (also when sent as `text/plain`, Rails-style `user[password]` names included) and multipart request bodies
  - the same fields of response bodies (`{"access_token":"[redacted]","expires_in":3600}`) and of WebSocket messages (`_webSocketMessages`); also truncated JSON, JSON encoded in a string value (`{"variables":"{\"password\":\"[redacted]\"}"}`, up to 3 levels), socket.io (`42["auth",{"token":"[redacted]"}]`, `42/chat,[…]`, `451-[…]`, Engine.io v3 `45:42[…]`) and SockJS (`a["…"]`) packets, server-sent events and NDJSON; base64 bodies with no, a generic (`application/octet-stream`), JSON, form or `text/event-stream` type and binary WebSocket messages are decoded when they are UTF-8 text, redacted and encoded again
  - any whole JWT (`eyJ….….…`) under any name: in a JSON string value (`"Bearer [redacted]"`, `"https://a/cb#id_token=[redacted]&state=1"`, only the JWT is replaced), a form or URL parameter value, a multipart part or a text body

  Credential field names (case-insensitive, anywhere in the name unless marked whole word; camelCase counts as words, so `userPin` and `ssnNumber` match): `passw`, `pwd`, `passcode`, `passphrase`, `otp`/`pin`/`ssn` (whole word), `cvv`, `cvc`, `card_number`/`cardNo` (whole word), `token`, `secret`, `api_key`, `authoriz`, `credential`, `jwt`, `private_key`, `access_key`, `session`, `signature`, `bearer`, `cookie`, `csrf`, `xsrf`, `refresh`, `oauth`, `auth`/`sid` (whole word, so `X-Auth` and `auth_code` match, `author` does not), `auth_code`/`authCode`, `code_verifier`. Bare `code` and `key` count only in URLs.

  | Over-redacted (harmless, replaced) | Kept |
  |---|---|
  | `tokenCount`, `sessionLength`, `refreshInterval`, `cookieConsent`, `csrfEnabled`, `pin_color`, `pinColor`, `isAuth` | `author`, `spinner`, `opinion`, `cardholder`, `cardNotes`, `code`, `key`, a credential under another name (`{"hash":"…"}`) |

  Unlike Chrome, which drops these headers and cookies, bdg keeps their names (and cookie attributes, header sizes). `log.comment` says the file was sanitized. JSON is not re-serialized: only the credential values are replaced, so 64-bit numbers, formatting, duplicate keys and a BOM or `)]}'` prefix stay byte for byte. A stray `"` in text ends at its line, so it hides nothing on the next lines. Kept as captured: other binary (base64) bodies, binary WebSocket messages that are not UTF-8, and text that is not JSON or a form (apart from JWTs). **Only JSON syntax is understood:** single-quoted strings, unquoted keys, JSONP (`callback({...})` as `text/javascript`) and `name:value` header lines such as STOMP `passcode:` are not redacted (a value right after a quoted credential key is, up to the next delimiter or space, so `{"token":abc def}` keeps `def`, and a token after `Bearer` in text is kept unless it is a JWT). A body or message the sanitizer fails on is replaced whole by `[redacted]`. `content.size` stays as captured; a WebSocket message bdg cut at 100 KB has `_truncatedFrom` (its original length). `--include-sensitive` writes every captured value.
- Written readable by its owner only (mode 0600)
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
  - Status line: method, HTTP status and status text (`Status: GET 404 Not Found`), `FAILED (<reason>)` or `pending`
  - Response headers (alphabetically sorted)
  - Request headers (alphabetically sorted)
  - Request ID for correlation with `bdg peek` output
- **JSON format** (`--json` flag):
  - Structured data with `url`, `requestId`, `method`, `status?`, `statusText?`, `errorText?`, `requestHeaders`, `responseHeaders`
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

# List the last N messages (also without --list)
bdg console --last 50

# Stream console messages in real-time
bdg console --follow
bdg console -f

# JSON output with summary statistics
bdg console --json

# Message texts whole
bdg console --list --full
```

**Default behavior:**
- `--last <n>` lists the last N messages (like `--list`; without it the summary is shown)
- `[n]` in a list is the message's position in the session (what `bdg details console <n>` takes); when the page or level filter left messages out between listed ones, a note under the list says how many and why (`not listed in between: 1 message from another page load (-H lists all)`)
- Shows messages from **current page load only** (most recent navigation)
- Errors deduplicated with occurrence count and source location; the newest 50 distinct errors and warnings are listed, with a note for the earlier ones (`(+70 earlier distinct errors; bdg console --level error --last 0 lists every one)`). JSON has the same 50 and `moreErrors`/`moreWarnings`; `--last <n>` sets how many (0 = all)
- Warnings listed with source location
- The session keeps the newest 10000 messages: past that the oldest are dropped, and `console`, `peek` and their JSON (`dropped`, `totals.consoleDropped`) say how many (`⚠ 2001 older console messages were dropped: bdg keeps the newest 10000`). `console` without `--history` warns only while the oldest kept message is the current page's: otherwise the dropped ones came from earlier pages. Indices stay the same: `bdg details console <n>` with a dropped index says so
- Summary count of info/debug messages
- Message texts are cut at 200 characters followed by `… N more chars (use --full)`, in the summary, `--list` and `--follow`; in `--json` a text over 10000 characters is cut with `truncatedFrom` (its original length). `--full` prints them whole; `bdg details console <n>` shows one message whole
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

# List methods in a domain (a domain name alone does the same)
bdg cdp Network --list
bdg cdp Network

# Search for methods by keyword (names, descriptions and common words:
# "viewport" finds Emulation.setDeviceMetricsOverride first; name matches come first)
bdg cdp --search cookie
bdg cdp --search viewport

# Describe a specific method (parameters and return types)
bdg cdp Network.getCookies --describe

# Describe a protocol type (enum values or object properties)
bdg cdp Network.CookieSameSite --describe

# Execute a method
bdg cdp Network.getCookies
bdg cdp Page.navigate --params '{"url": "https://example.com"}'
```

Without `--json`, discovery prints text (one line per domain or method, with the first sentence of its description; `--describe` lists parameters with `?` for optional ones) and a method call prints its result as indented JSON, or `<Method>: done (no result data)`. `--json` prints the response envelope (`data.methods`, `data.domains`, `data.result`, ...). A search with no match exits 0 (`count: 0`); an empty query exits 81, and `--search`, `--list`, `--describe` and `--params` cannot be combined (exit 81).

`--describe` expands a parameter whose type refers to an enum inline (`sameSite?: CookieSameSite (Strict|Lax|None)`, JSON `enum` and `ref: "Network.CookieSameSite"`) and shows the base type of other non-object types (`expires?: TimeSinceEpoch (number)`, JSON `refType`); object types are described with `bdg cdp <Domain.Type> --describe` (the output names the first one). Experimental parameters are tagged `(experimental)`. A method the protocol redirects to another domain shows the method that implements it and that method's parameters, which are the ones Chrome checks: `DOM.highlightNode` says `Implemented by Overlay.highlightNode (redirect), with these parameters:` and lists `highlightConfig` (JSON `redirect: { method, resolved: true, parameters }`). A redirect to a method the protocol lacks is shown as unresolved: `Page.deleteCookie` says `Redirect target Network.deleteCookie is not in the protocol (unresolved redirect)` (JSON `resolved: false`; the real method is `Network.deleteCookies`). The example fills required parameters with values that work as typed: realistic ones for common names (`width` 1280, `height` 800, `x`/`y` 100, `deviceScaleFactor`/`scale` 1, `timeout` 5000, `responseCode` 200, `url` `https://example.com`), else 1 for numbers (never 0, which often means "off"), `"example"` for strings.

bdg's protocol schema comes from the bundled devtools-protocol package, which follows Chromium's tip of tree, so it can lack methods your Chrome has and list methods it doesn't. A well-formed `Domain.method` that is not in the schema is sent to Chrome anyway, with a warning on stderr (`Warning: Storage.getRelatedWebsiteSets is not in the bundled protocol (devtools-protocol 0.0.1710668); sending it to Chrome as is`; JSON: top-level `warning` in the envelope, on success and on failure alike). A name 1 edit away from a bundled method or domain (2 for names over 5 letters, case ignored) is taken for a typo instead and exits 81 with `Did you mean:` (e.g. `Network.getCookes`); `--send-anyway` sends it as typed, with the same warning, for a method newer than the schema next to a bundled sibling (`getWindowBounds`/`setWindowBounds`). A name that is not `Domain.method`, names a type (`Network.CookieSameSite` without `--describe`) or is a blocked method exits 81 with or without the flag. Names are matched case-insensitively only for methods in the bundled schema (`network.getcookies` runs `Network.getCookies`); any other method is sent with its domain recased and its method name as typed, and CDP method names are case-sensitive. When Chrome has no such method (-32601) it exits 83, saying why as far as the schema tells: a method in the bundled schema gets `This Chrome doesn't implement <method> (…)` with a suggestion that this Chrome is older than the schema; a method of a bundled domain the schema lacks gets the same message, and when its name is all one case (`storage.getrelatedwebsitesets`) a reminder that names of methods bdg doesn't know are case-sensitive and lowerCamelCase; a domain the schema lacks too gets `Unknown CDP domain Foo: it is not in bdg's bundled protocol, and this Chrome doesn't implement Foo.bar (…)` with `Did you mean:` for a domain up to half its length off (`Ntwrk` → `Network`) and `bdg cdp --list`; a method redirected to one the protocol lacks (`Page.deleteCookie`) says `the protocol redirects it to Network.deleteCookie, which does not exist` and suggests `Network.deleteCookies` instead of blaming an older Chrome. A domain 1–2 edits from a bundled one is still taken for a typo before anything is sent (exit 81, see above); one further off is sent, since Chrome can have domains the schema lacks.

When Chrome rejects a call, the exit code says whose mistake it was: a node, target or frame that does not exist exits 83 (`DOM.getBoxModel: Could not find node with given id`, with a reminder that node ids come from `DOM.getDocument` or `DOM.querySelector` and are replaced by a new `DOM.getDocument` or a navigation); wrong or missing parameters exit 81 and point to `--describe`. A script that throws in the page (`Runtime.evaluate`, `Runtime.callFunctionOn`, ... answer with `exceptionDetails`) exits 91 with the exception, as `bdg dom eval` does. To change the viewport or color scheme, use `bdg page emulate` rather than `Emulation.*` calls (screenshots and `bdg status` follow it).

**Event-Based Domains:**

Some CDP domains use event-based reporting rather than synchronous responses. When methods return empty results, bdg provides contextual hints:

```bash
bdg cdp Audits.enable
# Audits.enable: done (no result data)
# (stderr) Enables the Audits domain. Issues will arrive via Audits.issueAdded events.
```

The `--describe` output includes domain notes for event-based APIs:

```bash
bdg cdp Audits --describe
# Audits: 4 methods, 1 event (experimental)
# Audits domain allows investigation of page violations and possible improvements.
# Event-based domain. Results arrive via events (e.g., Audits.issueAdded), not method responses. ...
# Use: bdg cdp Audits --list (to see all methods)
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

Once no daemon of the session runs, cleanup, and `bdg <url>` before it launches Chrome, kill every Chrome launched for its session directory (found by the `--bdg-session-dir` marker on its command line), also ones that `chrome.pid` no longer records. A daemon that still runs but lost its socket (`daemon.sock` deleted) is stopped by the next `bdg <url>` before it starts a new one, so the session never ends up with two daemons and two Chromes. A daemon removes only its own `chrome.pid` and metadata.

### Install the agent skill
```bash
bdg install-skill               # Copy SKILL.md to ~/.claude/skills/bdg and ~/.agents/skills/bdg
bdg install-skill --claude      # Only ~/.claude/skills (Claude Code)
bdg install-skill --agents      # Only ~/.agents/skills (Codex, Gemini CLI and other agents)
bdg install-skill --json        # JSON: data.skills[] with target, path, status (installed | updated | unchanged), backup
```
A copy that differs (an older version, or one you edited) is kept as `SKILL.md.bak` next to it before it is overwritten (replacing an earlier backup): the output says `previous copy kept in ~/.claude/skills/bdg/SKILL.md.bak`, JSON has its path in `backup`. Re-run after upgrading bdg. Exit 82 when a skill directory cannot be written; the other agent's skill is still installed, and the error lists it (JSON `skills`). A failed write leaves the copy and its backup as they were.

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

Without `--headless`/`--no-headless`, Chrome gets a window when there is a display: on macOS unless the shell came in over SSH (`SSH_CONNECTION`, `SSH_TTY`) or `CI` is set (to anything but `false` or `0`); on Linux when `DISPLAY` or `WAYLAND_DISPLAY` is set (desktops, WSLg). Servers, containers and CI run headless. An agent running bdg unattended on a Mac should pass `--headless`.

Profiles bdg manages (`~/.bdg/chrome-profile`, a named session's profile) have the password manager and its leak check turned off, because their bubbles capture clicks in headless Chrome. A profile given with `-u`/`--user-data-dir` (or in `--chrome-flags`) is checked before Chrome starts: a path through a file or under `/proc`/`/sys` exits 81, an unwritable parent 82. bdg leaves such a profile as it is; turn them off there yourself (Settings > Passwords) if clicks stop reaching the page after a login.

### Advanced Options
```bash
# Chrome Options
bdg localhost:3000 --headless                   # Launch Chrome in headless mode
bdg localhost:3000 --no-headless                # Launch Chrome with a window
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
- **The newest 10000 requests and 100 MB of request and response bodies are kept**: past 10000 finished requests the oldest are dropped (requests still in flight never are), and past 100 MB of stored bodies (request post data and response bodies together) the oldest bodies are replaced by a placeholder while their requests stay (`bdg details network <id>` then has `bodyNotCaptured: "evicted: total body budget (…)"` for a response body, `requestBodyNotCaptured` for a request body; the HAR gives the reason as the `comment` of `content` or `postData`). `network list` (`--follow` once, when it first happens), `peek` and `status` say so (`⚠ 2000 older network requests were dropped: bdg keeps the newest 10000`); JSON has the counts: `dropped` and `bodiesEvicted` (`network list`), `totals.networkDropped` and `totals.networkBodiesEvicted` (`peek`), `activity.networkRequestsDropped` and `activity.networkBodiesEvicted` (`status`); the body counts include request and response bodies
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
- **downloads/** - Files a launched Chrome downloaded during sessions in this directory (kept after `bdg stop` and `bdg cleanup`; `--purge` deletes them with the named session's directory)

**Key Behaviors:**
- **One daemon = one session**: only `bdg <url>` starts the daemon; it exits when the session ends (stop, Chrome disconnect, or `--timeout`)
- **One session per directory**: the daemon claims its socket atomically; a second `bdg <url>` for the same session reports the running one. Use `--session <name>` to run more (see [Multiple sessions](#multiple-sessions))
- **Commands without a session**: exit 83 ("No active session") without starting anything; `bdg status` reports `active: false` (exit 0)
- **Crash recovery**: files left by a killed daemon are cleaned up by `bdg status`, `bdg cleanup` or the next `bdg <url>`; an orphaned Chrome is killed only if its command line carries the `--bdg-session-dir=<dir>` marker bdg adds at launch

## Output Format

Every command that accepts `--json` (`-j`) prints exactly one response envelope to stdout.
It is indented when stdout is a terminal and on one line when it is piped or captured (agents, `| jq`), which saves the whitespace.
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
Usage errors such as unknown options or missing arguments are reported the same way, with exit code 81
and a `suggestion`: the closest option of the command for a mistyped one (`--sesion` → `Did you mean: --session?`),
otherwise `Run "bdg <command> --help" for usage`. Without `--json` the same two lines go to stderr.

In follow mode (`-f --json`), every refresh prints one complete envelope on one line (NDJSON).
When the session ends, it prints one error envelope and stops with exit 83; other failures (a busy
page, a timeout) print an error envelope per refresh and are retried.

Put `--json` after the command (`bdg peek --json`); `bdg --json peek` also works.

### Machine-readable help

```bash
bdg --help --json                # Compact: every command with its one-line description, arguments and flags, plus exit codes (~29 KB)
bdg dom query --help --json      # One command in full: option behaviors, defaults, choices, help text (examples), exit codes
bdg dom --help --json            # A group: its own options in full, its subcommands compact
bdg --help --json --full         # Every command in full at once (~120 KB)
```

The compact form has the same top-level fields as the full one (`command`, `exitCodes`, `taskMappings`,
`runtimeState`, `decisionTrees`, `capabilities`) plus `details`; its `command` tree has `name`,
`description` (first line), `arguments` (`"<selector> [index]"`), `options` (flags → description) and
`subcommands`, leaving out empty fields and the hidden global options (`--debug`, `-q`, `--session`, valid on
every command). Per-command help has `name`, `version`, `description`, `path` (`"bdg dom query"`),
`command` and `exitCodes`. Help JSON is printed without indentation.

See [`src/types.ts`](../src/types.ts) for complete type definitions.

## Related Documentation

- **Architecture**: [`docs/architecture/BIDIRECTIONAL_IPC.md`](architecture/BIDIRECTIONAL_IPC.md) - Daemon/worker architecture
- **Testing**: [`docs/quality/TESTING_PHILOSOPHY.md`](quality/TESTING_PHILOSOPHY.md) - Testing strategy
- **Release Process**: [`docs/RELEASE_PROCESS.md`](RELEASE_PROCESS.md) - How to release new versions
- **Docker**: [`docs/DOCKER.md`](DOCKER.md) - Running bdg in Docker containers
