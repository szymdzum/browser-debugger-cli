# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Why cookies were blocked** (#493): `details network` listed the raw `Set-Cookie` headers with no sign Chrome had rejected them, and a cross-site request simply had no `Cookie` header, the usual cause of "logged out after this request". bdg now keeps the cookies Chrome blocked on each request, from the ExtraInfo events (`responseReceivedExtraInfo.blockedCookies`, `requestWillBeSentExtraInfo.associatedCookies`), whichever order they arrive in. `details network <id>` has a `Blocked Cookies` block after the response headers (`nosecure  set rejected: SameSiteNoneInsecure`, `tp_lax  not sent: SchemefulSameSiteLax`), JSON `blockedCookies: [{ name, kind: "set-rejected" | "not-sent", reasons }]`. `network list` ends such rows with `⚠ cookie blocked` and has a filter `has-blocked-cookies:<pattern>` (name, reason or kind; `*` for any), and `network list --json` and `peek --json` include `blockedCookies`. Cookies that do not apply to the URL (`DomainMismatch`, `PathMismatch`, `NotOnPath`) are left out. Only names and reasons are kept, never values, and the HAR export is unchanged. A request keeps at most 50 (the rest counted in `blockedCookiesOmitted`). Cookies `document.cookie` could not set stay in `bdg console`'s Issues (#492).
- **Actions report the errors they caused** (#449): `dom click`, `fill`, `pressKey`, `submit`, `hover` and `scroll` list the console errors and uncaught exceptions logged while they ran: a handler's throw, a throw in a timer it set, an unhandled rejection, `console.error`, and the errors of a page the action navigated to. Human output has `Errors: Uncaught Error: handler exploded (app.js:3:142)` (`[2x]` for repeats, then `+N more (bdg console --level error)`), JSON `errors: [{ text, source, count }]` (at most 3 distinct ones, grouped like `bdg console`) and `moreErrors`. Errors logged before the action and warnings are left out. They come from the session's console telemetry, so actions without errors take no longer.
- **Tabs and popups an action opens** (#453): a click that opened a popup or a `target=_blank` tab looked like it did nothing, and bdg could not reach the new page. Actions now list what they opened: `Opened: popup http://localhost:3000/authorize (bdg page switch 1)`, JSON `opened: [{ url, targetId, kind, index }]` (`kind` `popup` for a page that can reach `window.opener`, `tab` for one that cannot). `bdg page tabs` lists the tabs (index, title, URL, `(opened by N)`, `*` for the session tab; JSON `tabs: [{ index, targetId, url, title, kind, current, openedBy }]`). `bdg page switch <index|url-part>` makes another tab the session tab: `page info`, `dom` commands, actions, `dom eval`, screenshots and `bdg cdp` (with `--listen` buffers) act on it, network, console and dialog telemetry record it from then on, and the session's viewport and color scheme emulation is applied to it; requests the old tab had in flight are no longer tracked, also when a switch fails and the session stays on the old tab. When the session tab closes, e.g. an OAuth popup calling `window.close()`, the session returns to its opener (else the tab used before it) and the action says so: `Tab closed: …/authorize; now on tab 0: http://localhost:3000/`, JSON `tabClosed` and `switchedTo`; a closed tab with neither an open opener nor a tab used before it still ends the session. `bdg page close [index|url-part]` closes a tab (the session tab by default, moving to its opener first; the only tab exits 81). A target of only digits is an index; `url:8080` matches a URL part instead. An unknown URL part exits 83 with the open tabs and the closest one (`Did you mean: bdg page switch popup?`), an index out of range or a part several tabs match exits 81. With `--chrome-ws-url`, switching needs the endpoint to serve page WebSockets for the other tabs, and a tab another bdg session drives is refused (exit 90).
- **`bdg cdp` collects CDP events** (#452): `bdg cdp <Method>` returned only the method's response, so event-based domains could be started but never read (`Tracing.end` returned `{}` and pointed at `Tracing.dataCollected` events bdg could not show), and `Fetch.enable` left requests paused with no way to learn their `requestId`. `bdg cdp <Method> --collect <Event>[,…] [--until <Event>] [--timeout <s>] [--out <file>]` subscribes before sending the method and collects until the `--until` event or the timeout (default 10 s, max 120; the daemon extends its 30 s command timeout to match); a timeout returns the events so far with `complete: false` (exit 0), not an error. `--out` writes NDJSON (`bdg cdp Tracing.end --collect Tracing.dataCollected --until Tracing.tracingComplete --out trace.ndjson`, and `jq -s '{traceEvents: [.[] | select(.method == "Tracing.dataCollected") | .params.value[]]}' trace.ndjson > trace.json` loads in the DevTools Performance panel); the file is written under a temp name and renamed over the target only on success, so a failed method never truncates or deletes a file already there (which keeps its mode). A symlink at the `--out` path is replaced by a regular file, and the file it pointed to is left untouched; without it the output is kept to about 20000 characters (`omitted`, `truncatedFrom`). `bdg cdp [<Method>] --listen <Event>[,…]` buffers events between commands (1000 events, 10 MB, oldest dropped and counted in `dropped`, gone with the session), `bdg cdp --events [<Event>] [--wait <s>] [--clear] [--out <file>]` reads and removes them (events over the output budget stay buffered as `remaining`), and `--unlisten` stops. Only events of the session page's own target are kept, not those of attached iframe or worker sessions. Event names are checked against the bundled protocol: `Tracing.dataColected` exits 81 with `Did you mean: Tracing.dataCollected`. `docs/CLI_REFERENCE.md` and the skill have recipes for a mocked 500 (`Fetch.enable --listen Fetch.requestPaused`, `--events`, `Fetch.fulfillRequest`), next to blocking and throttling. `Fetch.enable` now notes that matching requests pause until continued and how to read and release them, and a command that times out after `Fetch.enable` without `Fetch.disable` says so (`Command timeout (30s): Fetch interception may be enabled …`, suggesting `bdg cdp Fetch.disable`, exit 102) instead of only `Command timeout (30s)`. `Tracing.start`, `Tracing` and `HeapProfiler` notes show the `--collect` command.
- **Choose how JavaScript dialogs are answered** (#450): every `alert`, `confirm`, `prompt` and `beforeunload` dialog was accepted and `prompt()` always got `""`, so an agent could not test the Cancel path of a confirm or type into a prompt. DOM actions (`dom click`, `fill`, `hover`, `submit`, `pressKey`, `scroll`) now take `--dialog accept|dismiss` and `--prompt-text <text>` for the dialogs they open (while they run, their network wait included; the choice resets when they return), and `bdg <url> --dialog dismiss` sets the session default, which also answers dialogs during page loads and navigations (built-in default: `accept`). `beforeunload` stays accepted unless the action itself has `--dialog dismiss`, which cancels the navigation. Results say how each dialog was answered: `Dialog: confirm() dismissed: "Sure?"`, `Dialog: prompt() accepted: "Name?" (answered "Ada")`, JSON `dialogs: [{ type, message, answer: "accepted" | "dismissed", promptText? }]` (`type` and `message` as before), and `bdg console` says `confirm() dialog dismissed: "Sure?"`. An unknown value exits 81 with `Did you mean: dismiss?`, and `--prompt-text` with `--dialog dismiss` exits 81. A dialog a page timer opens after the action returned gets the session default; a `dom eval` or `cdp` call running during an action shares its choice. With `--chrome-ws-url` the dialogs of the attached session page are answered the same way.
- **`bdg console` lists Chrome Issues that never reach the console** (#492): quirks mode (no doctype), form markup errors (a label whose `for` matches no id, duplicate field ids, fields without a label or without id and name), stylesheets that failed to load (with the `@import`/`<link>` position), `eval` and Trusted Types blocked by CSP, interactive content inside `<summary>`/`<option>`/`<legend>`/`<select>`, and cookies `document.cookie` could not set. They come from DevTools' Issues panel (`Audits.enable`), which also reports hundreds of performance hints, lazy-load images and third-party cookie warnings on a news site; those, request-bound cookie problems, deprecations and what Chrome already logs to the console are dropped, so bbc.com/news shows none. An `Issues` block after the errors and warnings lists up to 8, one line each with the elements at fault (`input#email, input#email`) or the file:line, and a note for the rest; `--json` has `issues` (`code`, `type`, `text`, `nodes`, `count`, `source`) and `issuesDropped`. Issues belong to the page currently loaded: a navigation clears them. Chrome's repeats (form issues come twice) are dropped and each kind is one issue with its elements; a page keeps at most 100 issues and 20 elements each, with texts cut at 300 characters. Cross-origin iframes add none. `bdg peek` counts them (`ISSUES: 2`, JSON `totals.issues`), and `bdg dom form` shows form errors under the field at fault (JSON `issues` on the field) and the others, such as a label that labels nothing or a field of a form not shown, after the forms (JSON `formIssues`); elements a single-page app removed since are left out there. Enabling the Issues domain adds a few milliseconds to the session start.

### Changed

- **`bdg peek` marks entries of earlier page loads** (#554): `peek` keeps the session's latest requests and console messages across navigations, while `console`, the Issues count and action errors are for the current page, so an old page's 404 read as current. Entries of an earlier page load (or of another tab, after `bdg page switch`) now say so: `ERROR (previous page) Failed to load resource: …`, `… GET …/old.css (previous page)`; JSON adds `previousPage: true` to them and `currentNavigationId` to `data`. They are marked rather than left out because `peek` is the session overview (`bdg console` already scopes to the current page).
- **The `bdg cdp` hint for `Runtime.evaluate` suggests `bdg dom eval`** (#554): any second `Runtime.evaluate` got `Hint: Consider using 'bdg dom query <selector>'`. The hint now picks the most specific pattern: `dom query` for an expression that queries elements (`querySelector`, `getElementById`, `getElementsBy…`), `dom eval` for any other. The `dom eval` hint now comes on the 2nd plain `Runtime.evaluate` call instead of the 4th.
- **Clearer form label issues** (#554): the Chrome Issue for a label whose `for` matches no id read "it labels nothing" next to a `dom form` field named from that label's text by a wrapping or nearby label. It now reads `<label for> points at no element: no element has the id its for attribute names`; a label with neither `for` nor a field inside reads `… no field is linked to it`.
- **Action results name a dialog's answer without the word "dialog"** (#450): the line an action prints for a dialog it opened is now `Dialog: alert() accepted: "Saved"` (was `Dialog: alert() dialog accepted: "Saved"`), and `Dialog: confirm() dismissed: "Sure?"` for a dismissed one. `bdg console` lines (`alert() dialog accepted: "Saved"`) and the JSON `type` and `message` are unchanged. A dialog Chrome did not take the answer for (closed meanwhile) is no longer listed as answered; the daemon log says `Could not answer …`.
- **An accepted `prompt()` gets its default value** (#554): with no `--prompt-text`, an accepted prompt got `""`, unlike pressing OK in a browser. It now gets the default value the page passed (`prompt('City?', 'Paris')` gets `Paris`; `""` when there is none), shown as `Dialog: prompt() accepted: "City?" (answered "Paris")` and in JSON `dialogs[].promptText`. `--prompt-text` still wins, and a dismissed prompt still returns `null`.

### Fixed

- **A full-page screenshot no longer removes the page's scrollbar for the rest of the session** (#514): Chrome lays the page out at the captured size for a capture beyond the viewport and, putting the size back, left it laid out without its vertical scrollbar, so `innerWidth` and `clientWidth` were both 1920 instead of 1920 and 1905 afterwards. `dom layout`, `dom inspect` widths, element positions and later screenshots (`originalWidth`) then ran on a layout 15 px wider than the user's, also with `page emulate --viewport`. After a full-page capture, or an element capture beyond the viewport, the restore now overrides the viewport one CSS px taller than the session's size (its `--viewport`/`--mobile`/`page emulate` viewport, else the window's), which lays the page out again, and then puts the session's emulation back (or clears the override). This holds on success, error and Ctrl-C. The page therefore sees two more real resizes after such a capture (1 px taller, then back), so its `resize` handlers and height-based media queries run; in a `--mobile` session the taller viewport is still the phone's (pixel ratio 3), and touch, which the capture turns off, comes back with the session's emulation. An element capture beyond the viewport in a `--mobile` session no longer fails with `Invalid parameters: Failed to deserialize params.width` (exit 81): the phone's fractional visible width is rounded.
- **Pending requests paused by Fetch interception are named** (#554): with `bdg cdp Fetch.enable` on, a click that left a paused request said only "page still changing (1 request pending)"; only a timed-out command mentioned Fetch. Actions now say `1 request pending, possibly paused by Fetch interception: bdg cdp --events Fetch.requestPaused` (or the same under their request list), and `peek` notes it under its network list; JSON `fetchInterception: true` on the action result and in `peek`.
- **A stylesheet that returned 404 shows `404`, not `net::ERR_ABORTED`** (#554): the Chrome Issue of a failed `@import` or `<link>` now gives the HTTP status from bdg's network telemetry when the request is known (`Stylesheet failed to load: …/missing.css (404 Not Found)`); Chrome's reason stays when it is not.
- **`dom form` no longer calls a form without visible fields READY** (#554): a form whose only field is hidden printed `0/0 fields filled | READY to submit` (bbc.com's search). It now prints `Summary: no visible fields to fill (1 hidden)`. JSON `readyToSubmit` stays `true` for such a form; check `summary.totalFields` (0).
- **Tabs follow-ups** (#557, to #453):
  - **A tab that closed on its own no longer moves the session silently.** When the session tab closed without an action reporting it (a popup's timer calling `window.close()`), the next command acted on the opener without a word: `dom query` exited 83 with only `No nodes found`, `dom get` read the opener, and `dom click` clicked the opener and reported the close as if the click had caused it. Now the next command of any kind says `Tab closed: …; now on tab 0: …` once (stderr; top-level `tabClosed` and `switchedTo` in the `--json` envelope, on success and on errors). Read-only commands (`dom query`, `page info`, `dom eval`, …) still run. The first action (`dom click`, `fill`, `submit`, `pressKey`, `hover`, `scroll`, `page navigate`/`reload`/`back`/`forward`) is not run and exits 90 (`RESOURCE_CONFLICT`) naming the move, because it was meant for the tab that closed; running it again acts on the current tab. A successful `page switch` or `page close` counts as choosing the tab, so no action is refused after it; it does not count as reporting the move, and its own output carries the notice if no command reported it yet. `bdg status` leaves the notice for the next command. `--help --json` now lists the envelope fields (`envelope`), `tabClosed` and `switchedTo` included.
  - **Console errors a tab logged before the first switch to it are listed.** Chrome's replay of a tab's earlier console messages was dropped on every switch, so a popup's load errors never showed. It is now kept on the first switch to a tab and dropped only on a return to a tab the session was on before. Requests a tab made before the switch are still not recorded: `network list`, `peek` and (when messages are missing) `console` now end with `Switched to tab 1 at 18:02:11 (…); its earlier requests are not recorded`, JSON `tabSwitch: { at, tab, consoleReplayed }`.
  - **Messages.** `page close` errors suggest `bdg page close …` instead of `bdg page switch …`. `page close --help` mentions `url:<part>`. `console --list --history --level error` no longer says messages were left out as "from another page load (-H lists all)" when `--level` left them out.
  - **Ctrl-C during `page switch`** printed no envelope under `--json`, and exit 130 did not mean the switch had not happened. The command now waits for the switch to finish and exits 130 (143 for SIGTERM) with the error envelope, saying whether the session moved (`Interrupted (Ctrl-C), but the switch completed: now on tab 1: …`, or `the session did not switch`). When no answer comes (an IPC timeout or a lost connection), it still exits 130 and says the outcome is not known, pointing to `bdg page tabs`. A second Ctrl-C exits at once.
  - **`page tabs --json` has `kind`** (`popup` or `tab`), like `opened[]`. `(opened by N)` (JSON `openedBy`) is now given only for popups. Chrome reports an opener for `noopener` and `target=_blank` tabs too, but those pages cannot reach it. Such a tab still returns the session to its opener when it closes.
- **`dom fill` fires the `InputEvent`s Chrome does** (#552): text fields got a plain `Event('input')` without `inputType` or `data` and no `beforeinput`, so a page reading `e.inputType` threw (MDN's search: `Errors: Uncaught TypeError: Cannot read properties of undefined (reading 'startsWith')`). Text-like inputs (text, email, search, url, tel, password, number), textareas and contenteditable elements now get `beforeinput` (cancelable) and `input` as `InputEvent`s from the field's own frame, with `inputType: "insertText"` and the text as `data`, as for a select-all and type (`deleteContentBackward` without data when filling `""`). Selects, checkboxes, radios, ranges, dates and colors keep their events. A page that cancels `beforeinput` still gets the value and the `input` event, and the result warns `The page cancelled beforeinput …`. A value the browser rejects (text in a number field) fails before any event reaches the page, and filling `""` into an empty field fires none.
- **`dom form` finds forms in shadow roots** (#456): it searched only the light DOM, so a form rendered by a web component (Lit, Shoelace, LWC, MDN's search modal) gave `No forms discovered on the page` while `dom query` and `dom a11y` saw its fields. Forms and form-less fields in open shadow roots, nested ones included, are now listed and marked `(in shadow root of <x-login>)` (JSON `shadowHost`). Labels (`for`, `aria-labelledby`), required stars and error texts are read in the field's own root, and secret fields there are masked as elsewhere. A field in a component inside a light DOM form (an `sl-input`) belongs to that form. Indices work with `dom fill`, `dom click` and `dom submit`: the daemon now binds each listed field and button to its node during discovery instead of re-running its selector, which in a shadow root may not be unique. Closed shadow roots cannot be read by page scripts, but CDP sees them: a defined custom element whose closed shadow root holds a field is named as not inspectable (`Note: <x-vault> has a closed shadow root with form fields; …`, JSON `closedShadowHosts`; the first 50 custom elements without an open root are checked, and closed roots attached to built-in elements such as `div` are not). A page whose only fields outside iframes are in shadow roots now lists them instead of exiting 89 with the iframe hint; the hint is kept as a note whenever same-origin iframes hold form fields, also next to other forms (`Note: an iframe holds form fields dom form does not list: <url>; …`, JSON `formsInFrames`), so a login form in an iframe is not lost behind a header search component.
- **`bdg console` names the source of an inline script and of a URL with a query**: a message from a page at `https://app.test/` showed `→ :3:142`, and one from `/a?next=/x/y` showed `→ y:1:1`. It now shows the file name of the URL path without query or hash (`a:1:1`), or the host when the path has none (`app.test:3:142`).
- **Dialogs answered during a page load are reported** (#553): `bdg <url>`, `page navigate`, `page reload` and `page back`/`forward` printed nothing for a dialog the page opened while loading (only `bdg console` had it), so an agent could not tell that a confirm was answered, or how. They now list it like action results do: `Dialog: confirm() dismissed: "Continue loading?"`, JSON `dialogs: [{ type, message, answer, promptText? }]` (start: `data.dialogs`). `bdg status` shows a `--dialog dismiss` session default as `Dialogs: dismiss (session default)` and JSON `dialog: "dismiss"`, next to the other start options (left out for the built-in `accept`).
- **`--dialog` suggests the answer a button word means** (#554): `--dialog cancel` or `no` listed only the choices; it now exits 81 with `Did you mean: dismiss?`, and `ok` or `yes` with `Did you mean: accept?`. The help and docs now say the value is read in any case (`Dismiss` works).

## [0.16.0] - 2026-10-09

### Changed

- **The npm description and keywords say what bdg is for** (#367): coding agents driving and debugging Chrome from the shell, so it shows up in npm search for `claude-code`, `coding-agent`, `browser-automation` and similar.
- **A page whose JavaScript is blocked or starved is no longer reported settled** (#531, #528): `dom click` and `pressKey` treated any gap over 150 ms between bursts of DOM changes as quiet, also when the page could not run at all during it. A page that started a 200 ms long task right after the click's first read, then kept changing, was reported settled (6 of 6 locally), and on the macOS CI runner, which runs the page's timers up to about 150 ms late after a click, 50 ms steps came up to 200 ms apart and were reported settled too. Time the page's main thread could not run its tasks no longer counts as quiet: while an action is watched, a 20 ms timer in bdg's own world (not visible to the page, except in the main-world fallback for frame-scoped connections, where `globalThis.__bdgStalls` is; a page that replaced `setTimeout` does not affect it) notes when it runs over 10 ms late, and that time is left out of the quiet gaps of the first and second look, so such a page is reported `pending.domChanging`. A single burst of changes more than 150 ms old also gets the second look when the page stalled for most of the time since (quiet for at most 75 ms); that only costs the 250 ms second look, since `domChanging` still needs a fresh change at it. It is for when a starved page's second step has not come yet by the first look; a single render with a short task after it does not. The timer runs only while the action is watched. A static page costs no extra read and is reported settled as fast as before; a page with recent bursts gets one more small read in bdg's world (given up after 100 ms). A page busy forever is still reported `busy` within the same limits.

### Fixed

- **`bdg cdp` says why Chrome has no method** (#521): every -32601 answer said `This Chrome doesn't implement <method>`, and for a bundled method that `this Chrome is older`. `bdg cdp Foo.bar` now says `Unknown CDP domain Foo: it is not in bdg's bundled protocol, and this Chrome doesn't implement Foo.bar` and suggests `bdg cdp --list` (with `Did you mean: Network?` for `Ntwrk.getCookies`; a domain 1–2 edits from a bundled one still exits 81 before sending, and other domains are still sent, as Chrome can have domains the schema lacks). `Page.deleteCookie`, which the protocol redirects to the non-existent `Network.deleteCookie`, says so and suggests `Network.deleteCookies` instead of blaming an older Chrome, and its `--describe` shows `Redirect target Network.deleteCookie is not in the protocol (unresolved redirect)` (JSON `redirect.resolved: false`, `true` for working redirects) instead of `Implemented by …`. A method missing from the schema typed in one case (`storage.getrelatedwebsitesets`) gets a reminder that such names are case-sensitive and lowerCamelCase, and `bdg cdp --help` no longer claims execution is case-insensitive: only bundled methods are.
- **`bdg cdp --describe` examples work as typed** (#521): numbers were `0`, which for `Emulation.setDeviceMetricsOverride` (`width:0,height:0,deviceScaleFactor:0`) means "disable the override", and URLs were `"example"`. Common names now get realistic values (`width` 1280, `height` 800, `x`/`y` 100, `deviceScaleFactor`/`scale` 1, `timeout` 5000, `responseCode` 200, `url` `https://example.com`), other numbers 1.
- **Element screenshots have `captureMode` in JSON** (#521): `dom screenshot --selector … --json` now has `captureMode: "element"`, like `"full_page"` and `"viewport"` for page captures.
- **A static page on a loaded machine is no longer reported busy** (#533): `dom click` and `pressKey` called the page `busy` ("page busy running a script") whenever one of their reads got no answer within 250 ms. A renderer the machine did not run for that long gave the same result: a click on a button with no effect, on a page without scripts, was reported `(page still changing)` once in 60 Linux CI runs. Pausing the renderer for 300 ms during the click reproduces it (main: 3 of 12 clicks busy; 400 ms: 5 of 6). While an action is watched, bdg's world now also counts the page's long tasks (over 50 ms). When a read gets no answer in time, bdg asks for that count, again within 250 ms. A page that answers without a long task only ran its tasks late. CDP runs the page's scripts in order, so the read has run by then, and bdg waits for its answer (not sending it again) instead of calling the page busy (0 of 24 clicks busy with 300 and 400 ms pauses). A page that ran a long task, or still does not answer, is busy as before. A renderer the machine stopped in the middle of a task can still record a long task, and is then reported busy. bdg asks at most once per action, so an action takes at most 250 ms longer than before: a page running an endless script is reported busy about 500 ms after the action instead of 250 ms (450 ms instead of 200 ms when the script was already running before the action).
- **A command right after Ctrl-C on `dom screenshot` sees the session's emulation** (#519): Ctrl-C exited at once while the daemon was still finishing the capture, and the emulation came back only after it (about 1 s on a 3000-line `--mobile` page, 6 s on a very tall one), so a command run right after read the capture's: `[innerWidth, innerHeight, devicePixelRatio, maxTouchPoints]` was `[980, 2121, 1, 0]` instead of `[980, 2121, 3, 5]`. The daemon now runs page commands (`dom`, `page`, `cdp`, from any client) only once a screenshot before them has put the emulation back (waiting at most 15 s, counted in the command's 30 s timeout; another screenshot waits until it is done, since run during it, it would put back the first capture's emulation), which also covers a screenshot that timed out or whose client was killed; `status`, `peek` and the telemetry lists do not wait. A screenshot whose client left skips the capture if it has not started, so only the restore remains. Ctrl-C on a single `dom screenshot` ends it at once, also while its element is looked up; with `--json` it now prints the error envelope (`Screenshot cancelled (interrupted)`, `exitCode: 130`; 143 for SIGTERM) instead of nothing (#521 item 1); a second Ctrl-C exits at once.
- **A slow Chrome start is no longer reported as a port conflict** (#523): when Chrome was running but did not open its debugging port within chrome-launcher's 25 s readiness budget (e.g. a first start on a cold machine), bdg said `Failed to launch Chrome: connect ECONNREFUSED 127.0.0.1:<port>` and listed a port conflict, a missing binary, permissions or a crash as possible causes. It now says `Chrome started (pid N) but did not open its debugging port <port> within 25 s` and suggests retrying, then `bdg cleanup`. The exit code stays 100 and the Chrome is still killed.
- **Ctrl-C at any moment of `bdg <url>` leaves no session behind** (#522): Ctrl-C while the daemon was being spawned left it idle and answering for up to 3 s; it is now told to shut down and waited for. Ctrl-C during the wait after a failed start now exits 130 (143 for SIGTERM), keeping the failure's message. A success that arrived just before the Ctrl-C was handled exited 0 with the session running; an interrupt before the success is printed now stops the session and exits 130. A start whose client disconnected (also when killed) is reported as ending, not starting: a new `bdg <url>` waits for it instead of failing, and other commands get "no active session".
- **Ctrl-C on a starting session exits once the session is gone**: `bdg <url>` exited with 130 at once, while its daemon was still tearing down Chrome; a `bdg status` or a new `bdg <url>` run right after still saw the session starting (the start then failed with "Session startup already in progress"). The start now closes its connection, waits (up to 3 s, like a failed start) for the daemon it spawned to exit, then exits with 130 (143 for SIGTERM); a second Ctrl-C exits at once.
- **Downloads go to the session directory and are reported** (#444): a click on an attachment link saved the file into your real `~/Downloads` (also headless), and the action only listed the GET request. A Chrome bdg launches now saves downloads into `<session dir>/downloads/` (`~/.bdg/downloads/`, created `0700`), under the suggested name with ` (1)`, ` (2)`… when it is taken, and the action reports each download that began meanwhile: `Download: report.txt → /Users/me/.bdg/downloads/report.txt (completed, 15 B)`, JSON `downloads: [{ url, suggestedFilename, path, state, bytes }]`; one still running as the action returns is `inProgress` and appears at its `path` once complete. Downloads of tabs the page opens (`target="_blank"`, `window.open()`) are named and reported too. If the downloads directory cannot be created, downloads are refused (`canceled` with a `reason`) rather than saved to `~/Downloads`. `bdg status` and `bdg peek` list the session's downloads (`Downloads: N (last: …)`, JSON `activity.downloads` / `data.downloads`), so ones that begin after an action are visible too; `bdg cleanup` keeps them and says so (`downloadsKept`). If the browser-level connection drops while Chrome runs, the behavior is set again on the page's connection; downloads of new tabs then still land in `downloads/`, but under Chrome's download id as the name and unreported. If Chrome refuses the download behavior, `bdg status` warns that downloads are not redirected. With `--chrome-ws-url` (the browser is yours) downloads still go to that Chrome's own download folder, usually `~/Downloads`: bdg sets behavior `default` with events on the page's connection only (replacing one another CDP client set; Chrome drops it when the session ends), so downloads of tabs or popups the page opens are not tracked there. A collector failing to start no longer leaves the ones started before it running.
- **Actions see a page still changing on a busy or slow machine** (#507): when the page's main thread was busy (or its process descheduled) as bdg read the page after an action, the read ran before the timer that had fallen due meanwhile, so a page adding content every 100 ms looked like a single render and the action reported it settled instead of `pending.domChanging`. The read now first lets a timer that fell due meanwhile run (a 0 ms timer set in bdg's own world, so a page that replaced or fakes `setTimeout` is still read, waited for at most 100 ms). The docs now say that DOM changes more than about 150 ms apart are reported as settled.
- **A page changing every 100–150 ms is reported changing** (#507): the second look 250 ms after the first needed 2 new bursts of DOM changes, so a page changing every 140 ms was reported settled in 2 of 3 clicks (and every 100 ms page whose timers ran 50–75 ms late, as on the macOS CI runner). The page is now still changing when the second look sees at least one new burst and no quiet gap over 150 ms up to it. Changes more than about 150 ms apart are reported as settled, and a render whose last commit came within 150 ms of the second look is reported changing.
- **`bdg stop` or Ctrl-C during a slow Chrome start ends it at once** (#474): bdg kept waiting up to 10 s for a launched Chrome to announce its debugging port and answer `/json/version`, whatever the session's state, so a stop during a slow start took ~10 s. Stopping the session now ends these waits and aborts the pending request: a stop while Chrome does not answer yet takes about 0.4 s instead of 9.6 s, and the start reports it was cancelled (exit 90, or 130 for Ctrl-C) as for a stop at any other point. bdg also stops waiting for chrome-launcher to see the port open (its poller is not cancelled; bdg waits only until Chrome is spawned, then kills it, so no Chrome outlives a stop).
- **A page busy right after an action is no longer reported `busy` because bdg was still setting up** (#507): bdg created its isolated world at the first read, which had to wait for the busy page; once it took 420 ms, past the read's 250 ms. The world is now created when the action starts, while the page is idle.
- **`bdg cdp` sends methods missing from the bundled protocol** (#488): the bundled devtools-protocol schema follows Chromium's tip of tree, and bdg refused any method it lacked with exit 81, e.g. `Storage.getRelatedWebsiteSets`, which Chrome 154 still has. A well-formed `Domain.method` the schema lacks is now sent to Chrome as typed, with a warning (`Warning: … is not in the bundled protocol (devtools-protocol 0.0.1710668); sending it to Chrome as is` on stderr, top-level `warning` in the `--json` envelope, also when the call fails); a name 1–2 edits from a bundled method or domain still exits 81 with `Did you mean:`, and `--send-anyway` sends it as typed. When Chrome has no such method (-32601) the error says `This Chrome doesn't implement <method>` (exit 83) instead of pointing to `--describe`.
- **`bdg cdp --describe` shows redirects, `$ref` enums and types** (#488): a redirected method such as `DOM.highlightNode` listed no parameters while Chrome required `highlightConfig`; it now shows `Implemented by Overlay.highlightNode (redirect)` with that method's parameters (JSON `redirect`), and its example uses them. Parameters referring to an enum type show its values (`sameSite?: CookieSameSite (Strict|Lax|None)`, JSON `enum`, `ref`, `refType`), experimental parameters are tagged, and `bdg cdp Network.CookieSameSite --describe` describes a type (enum values or object properties) instead of exiting 81.
- **Ctrl-C during `dom screenshot` no longer leaves the viewport changed** (#445): a capture changes the page's emulation (scrollbars hidden and the viewport overridden for an element beyond the viewport, a pixel ratio of 1 on a high-DPI or `--mobile` page) and the CLI put it back only if it ran to the end, so Ctrl-C mid-capture left e.g. `[innerWidth, clientWidth]` at `[1905, 1905]` instead of `[1920, 1905]` (or a phone page at pixel ratio 1), and every later `dom layout`, `dom inspect` and screenshot measured the wrong layout. Screenshots now run in the daemon in one request (instead of about 29 IPC round trips), which puts back whatever the capture changed, also when it fails or the CLI is interrupted, from the session's own record of its emulation at the end of the capture (not `session.meta.json`; a `page emulate` during the capture is kept). Each restore step runs even when another fails, and a failed restore never hides the capture's own error. On a page whose scripts keep it busy, the capture's `102` error comes once the emulation is back, so the next command does not race the restore. The CLI only writes the image; the output has the same fields and dimensions.
- **A failed screenshot reports why** (#445): an error from Chrome during the capture, or the session ending, was reported as `No screenshot data returned` (exit 101); the real error is now reported (e.g. `The session ended while the command was running`, exit 83).
- **A response body Chrome refused to return says why** (#520): when `Network.getResponseBody` failed the failure was only logged, so `details network <id> --json` had neither `responseBody` nor `bodyNotCaptured`, and the HAR entry looked like an empty response (`content.size: 0`, no comment). This happens when Chrome's network buffer has evicted the body (e.g. after several 30 MB uploads) or the request was cancelled. Chrome's "No resource with given identifier found" and "No data found for resource with given identifier" errors now give `bodyNotCaptured: "Chrome no longer had the body (its network buffer evicted it, or the request was cancelled)"`; any other error (a CDP timeout, the connection closing mid-fetch) gives `Chrome did not return the body: <error>`. The HAR has the reason as `content.comment`, and its `content.size` comes from `Content-Length` or, without one, the bytes transferred (`encodedDataLength`), as for other bodies bdg did not capture. Responses without a body by definition (HEAD, 1xx, 204, 205, 304) get no reason, a body already stored is kept, and a fetch that fails after the collector stopped or the request was dropped stores nothing.
- **Request (POST) bodies count toward the network body budget** (#479): since #437 stored response bodies total at most 100 MB, but request bodies (post data, up to 1 MB each as Chrome sends them) were kept without limit, so a long session of large uploads could hold about 10 GB across 10,000 requests. Request and response bodies now share the 100 MB budget, oldest evicted first, and the request stays. `details network <id>` shows an evicted request body as `requestBodyNotCaptured: "evicted: total body budget (…)"` (human output: `Request Body: (not captured: …)`), the HAR exports it without `postData.text`, with the reason as `postData.comment` and `bodySize: -1`. The eviction counts (`bodiesEvicted`, `totals.networkBodiesEvicted`, `activity.networkBodiesEvicted`) include request bodies, and the note says `⚠ 3 older request/response bodies were evicted`.

### Security

- **The default HAR redacts response bodies and WebSocket messages** (#502): a sanitized `network har` export still held the tokens of a login response (`access_token`, `refresh_token`, `id_token`) and of WebSocket auth messages. The credential fields that are redacted in request bodies are now `[redacted]` in JSON and form-urlencoded response bodies too (`{"access_token":"[redacted]","expires_in":3600}`), and in WebSocket messages, including truncated JSON, JSON encoded in a string value (GraphQL `variables`, up to 3 levels), socket.io (`42["auth",{"token":"[redacted]"}]`, namespaced `42/chat,`, binary `451-` and Engine.io v3 `45:42[…]` packets) and SockJS packets, server-sent events, NDJSON, and base64 bodies with no, a generic (`application/octet-stream`), JSON, form or event-stream type and binary WebSocket messages that are UTF-8 text (decoded, redacted and encoded again). A whole JWT (`eyJ….….…`) is redacted under any name, also inside a longer string or form value (`"Bearer [redacted]"`, only the JWT is replaced) and in text bodies. A body or message the sanitizer fails on is replaced whole by `[redacted]` instead of failing the export. Other binary data, text that is not JSON or a form, and non-JSON syntax (single quotes, unquoted keys, JSONP, STOMP `passcode:` lines, bare values with spaces) are kept as captured, and `log.comment` says what was and wasn't sanitized. A WebSocket message bdg cut at 100 KB now has `_truncatedFrom` in the HAR. `content.size` stays as captured; `--include-sensitive` output is unchanged.
- **More credential names are redacted, and masked in forms**: `passphrase`, `bearer`, `cookie`, `csrf`/`xsrf`, `refresh`, `oauth`, whole-word `auth`, `sid`, `pin` and `ssn` (camelCase too: `userPin`, `ssnNumber`), whole-word `card_number`/`cardNo`, `auth_code` and `code_verifier` fields of HAR bodies (and URL parameters); Rails-style form names such as `user[password]` are now recognized without a form Content-Type. `dom form`, `dom get`, `dom inspect` and `a11y` also mask the values of fields named `passphrase`, `pin`, `ssn` or `card_number`. More harmless values are over-redacted too (`refreshInterval`, `cookieConsent`).
- **Sanitized JSON bodies keep their exact bytes**: request bodies (#448) were parsed and re-serialized, which rounded 64-bit numbers (`12345678901234567890` became `12345678901234567000`), dropped formatting and collapsed duplicate keys, and a body nested too deep to walk was replaced whole. Only the credential values are now replaced, in one linear pass, so the rest of a request or response body stays byte for byte (a BOM and an XSSI `)]}'` prefix included).

### Internal

- **Smoke tests wait for events instead of sleeping** (#529, step 1, all files but `interactions`): timing assertions were audited and either made deterministic or given a note on their margin. `dom eval` busy-page tests hold the page with a synchronous beacon before the loop (the next command could reach the page before the timer fired); the eval navigation tests await a promise that never settles instead of a 3 s timer; the silent-Chrome interruption tests interrupt once bdg's `/json/version` request has reached the stand-in (new optional `requestFile` of `writeSilentChrome`) instead of 500 ms after it listens; `peek -f --json` is stopped with Ctrl-C after two envelopes instead of being killed at 2.5 s (new `onStdout` option of `runCommand`); the follow-mode session-end test stops the session once the follower printed, not after 1.5 s; the timer-based `dom wait` test starts the wait together with the click, so the click's settle time no longer eats into its 1 s margin; and fixed sleeps before checking a page reload, a `pushState` URL, console errors from timers, download states, and the Chrome cleanup are replaced by polling for the awaited state. Waits for Chrome and the daemon after an interrupted start allow 15 s (Chrome alone may take 5 s), the HAR `--all` body wait 20 s instead of 5 s, and the 500 ms wait before checking the daemon is gone after `bdg stop` is removed (the daemon removes its socket before answering).
- **Interactions smoke test: timing margins documented, `#block` held by the page** (#529): the `/effects` fixture and `interactions.smoke.test.ts` now state the margin of each timing assertion. `#block` starts its 1.5 s long task in a posted message right after the click instead of a 60 ms timer. The steps and busy-steps `domChanging` checks are unchanged: page-side timelines on the macOS runner showed the page's own tasks (timers and posted messages, with or without DOM changes) running up to about 150 ms late after a click while bdg's reads ran on time, so 50 ms steps came up to 200 ms apart and the 60 ms busy timer could fire after the first read. That is tracked in #528 and #531.
- **The screenshot Ctrl-C smoke test no longer races the capture**: the phone-page test (`--no-full-page` at pixel ratio 3) failed on the Linux runner with exit 0 instead of 130 since the job tests the runner's Chrome 154 (#523; before, Chrome for Testing 155). The page's trap started its 3 s busy loop from a 100 ms timer after the emulation changed, but a viewport capture at a changed pixel ratio ends about 30 ms after the change, so the screenshot could finish before the Ctrl-C. `Page.captureScreenshot` waits for the frame of the rendering update that applies the new emulation, so the trap now reports the change with a synchronous request and keeps the page busy right in the change handler: the capture is held until the test interrupts it. On a manual run (`workflow_dispatch`) the Linux smoke jobs now run the selected files `repeat` times like the macOS job (`scripts/smoke-selected.sh`), and the warm-up step prints the runner's Chrome version.
- **The Linux smoke job no longer installs a second Chrome** (#523): its `browser-actions/setup-chrome` step installed a Chrome nothing used (no `CHROME_PATH` was set, so bdg and the warm-up launched the runner's preinstalled `/usr/bin/google-chrome-stable`). The step is removed; the job tests the runner's Chrome, as the macOS job does.
- New `dom_screenshot` daemon command (#445); the screenshot code moved from `src/commands/dom/helpers/screenshot.ts` to `src/runtime/page/` (`screenshot.ts`, `captureEmulation.ts`, `captureScroll.ts`, `screenshotResize.ts`) and `src/runtime/dom/captureArea.ts`, over typed CDP. `TypedCDPConnection.send` now accepts the parameters of methods whose parameters are all optional (such as `Page.captureScreenshot`, `DOM.getBoxModel`).
- **macOS smoke runs on pull requests that touch timing-sensitive paths** (#529): `src/runtime`, `src/connection`, `src/daemon`, `src/ipc`, `src/session`, `src/telemetry`, the smoke tests and `src/__testutils__`, workflows, the smoke scripts and `package.json`/`package-lock.json` (a second `paths-filter` output, `timing`). It stays out of `CI OK`, so a macOS failure is reported but does not block the merge. The smoke steps now run `scripts/smoke-selected.sh` (all smoke tests by default) with the spec reporter plus `scripts/failed-tests-reporter.mjs`, and a failed run lists its failed tests in the job summary, with the run number when the selection is repeated. `docs/quality/TEST_GUIDE.md` has the rule that a new or changed timing smoke test passes a `repeat=10` dispatch on Linux and macOS before merge, and the dispatch input quirks.

## [0.15.0] - 2026-10-08

### Breaking

- **`network har` writes a sanitized HAR by default** (#448), like Chrome DevTools since Chrome 130: values of auth, cookie, API key, token and session headers, cookie values, credential query parameters in URLs (`?code=`, `?access_token=`) and password/token fields of JSON, form and multipart request bodies become `[redacted]` (names and sizes stay; `log.comment` and `--json` `sanitized: true` say so; response bodies and WebSocket messages are not sanitized). `--include-sensitive` writes the HAR as before; HAR files are now written with mode 0600.

### Fixed

- **Help and usage hints** (#490): an unknown subcommand close to several commands suggests "Did you mean: form or frames?" instead of "one of form, frames"; `cdp` is on one aligned line in `bdg --help`.
- **No Chrome found** (#496): the launch error suggests `CHROME_PATH` for another Chromium-based browser (with an Edge example) and drops the port-conflict hints that don't apply.
- **Headless sessions keep their client hints** (#497): replacing the `HeadlessChrome` user agent sent no client-hint metadata (it was read from `about:blank`, which has no `navigator.userAgentData`), so Chrome emptied them: `navigator.userAgentData.brands` was `[]`, `platformVersion` `""` and the `Sec-CH-UA` header empty, which gave the session away. The hints are now built the way Chrome builds them, from `Browser.getVersion` and the host (OS version, architecture), and match a regular tab's: `"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"`, platform version `15.7.9`. Edge is named Microsoft Edge; Chromium and Chrome for Testing report as Google Chrome (CDP does not tell them apart). With `--chrome-ws-url` to a Chrome on another platform than bdg's machine, the OS version, architecture and bitness are left empty.
- **chrome-launcher's disabled features apply again** (#486). Chrome reads only the last `--disable-features` flag, and bdg's own (`Translate,SessionCrashedBubble`) came after chrome-launcher's, so 9 of its 10 features (`OptimizationHints`, `MediaRouter`, `PrivacySandboxSettings4`, `RenderDocument`, ...) were back on. Every new profile downloaded on-device ML models: after 75 s idle a fresh profile held 54 MB, 45 MB of it in `optimization_guide_model_store`; now 8.8 MB and no model store. All `--disable-features` (and `--enable-features`) values, including the user's from `--chrome-flags`/`BDG_CHROME_FLAGS`, are merged into one flag, so a user list no longer drops bdg's either. A feature named in `--enable-features` is taken out of the merged `--disable-features` (Chrome lets disabling win), so `--chrome-flags=--enable-features=MediaRouter` still re-enables a default. `--no-first-run` and `--no-default-browser-check` are passed once.
- **`HEADLESS` in the environment no longer forces headless Chrome** (#486). chrome-launcher adds `--headless` whenever the launching process has a non-empty `HEADLESS` (even `0`), so `HEADLESS=1 bdg <url> --no-headless` started headless; the daemon now removes the variable before launching Chrome.
- **`dom eval --json` bounds object and array results** (#478): only string results were cut, so one eval could still print megabytes (`[...document.querySelectorAll('*')].map(e => e.outerHTML)` on a page with 20,000 elements: 2.0 MB). An array result now lists its first 100 elements with `count` (all of them) and `omitted`, like the bounded lists of #436; an object or array whose JSON is still over 20,000 characters is given as the start of its JSON text (a string, so the output stays valid JSON) with `truncatedFrom` (the length of the whole JSON text) and, for an array, `count` (a string `result` with `truncatedFrom` while `type` is `object` is such a JSON-text start). The example above is now 23 KB. `--full` now returns the whole value: objects and arrays were copied from the page with at most 1000 entries (the rest as `"…"`) and 20 levels even with `--full`; they are now copied with every entry (and up to 100 levels).

### Security

- **Session directories are private and checked before use** (#438). `~/.bdg`, `$BDG_SESSION_DIR`, `sessions/` and named session directories are created `0700`, `daemon.log` `0600`. `bdg <url>` and every command that talks to the daemon refuse a session directory (or one above it, up to the base) that is a symlink, owned by another user or writable by others (exit 103, e.g. `Session directory /tmp/shared is not safe to use: writable by others (mode 777)`; `BDG_SESSION_DIR=/tmp` itself is refused as a shared sticky directory, with a subdirectory suggested): another user could replace `daemon.sock` and receive every command, including `dom fill` values. `bdg sessions` lists such a session as `untrusted` with the reason instead of asking it.
- **Upgrade:** an existing `~/.bdg` created `0755` (or `0775` under umask 002) by earlier versions is accepted and tightened to `0700` automatically, as are `sessions/` and named session directories; group write on your own directory is accepted. A base directory you chose with `BDG_SESSION_DIR` is checked but never `chmod`-ed. The base (`~/.bdg` or `BDG_SESSION_DIR`) may be a symlink, e.g. to dotfiles or another disk, when its target passes the same check; `sessions/` and named session directories may not. A directory owned by another uid (a bind mount, `sudo -E` keeping your `HOME`) is refused.
- **A symlinked `daemon.log` is refused, not followed** (it appended the daemon log to the file it pointed to), and error suggestions name a per-user directory (`$XDG_RUNTIME_DIR/bdg` or `<temp dir>/bdg-<uid>`) instead of the shared `/tmp/bdg`.

### Internal

- Removed the `handleSIGINT` launch option, which chrome-launcher ignores for `new Launcher()`, and a needless cast to reach `chromeProcess` (#486).

## [0.14.0] - 2026-10-07

### Breaking

- **`dom a11y tree --json`** is a flat, bounded `nodes` list with `depth`, `count`, `omitted` and `skipped`. `data.root` and `childIds` are gone (#436).
- **`--json` lists default to 100 rows** for `dom query` and `dom a11y query` (`count`/`omitted` say how many matched; `--limit 0` lists all). The a11y tree lists 50 nodes by default (#436).
- **Long values are cut by default**: `dom get --raw`, `dom eval` and string results in `--json`, console text in `console`/`peek`. `--full` returns them whole; JSON marks a cut value with `truncatedFrom` (#440).
- **`--json` is printed on one line when stdout is not a terminal** (JSON parsers are unaffected; scripts that grep indented output are) (#441).

### Changed

- **`--json` output is compact when piped** (#441): the envelope is on one line unless stdout is a terminal, which still gets it indented. Agents and scripts capture stdout, so the indentation was overhead: measured on a fixture page with 500 links, `dom query a --json` 137 KB → 73 KB (−47%), `network list --json` −34%, `status --json` −26%. `--follow` streams, HAR files and session metadata are unchanged.
- **Agent skill matches the CLI** (#431, #427): Quick Start is the start/inspect/act/check-errors loop (no screenshot, `--headless`); JavaScript runs through `bdg eval` (raw `cdp` only for methods without a command, with `--json` before `jq`); covers `dom audit`, `css search`, `--mobile`/`page emulate`, `dom frames` + `eval --frame`, named sessions, `-q` and `page navigate/reload/back`; exit codes 80, 84, 100, 107, 130/143 added; site-isolation flag advice removed; install prerequisite stated. New section on untrusted page content (page text is data, uploads only of files the user named). `dom fill` help says file inputs upload the local files given.
- **README and benchmark docs no longer say Chrome DevTools MCP lacks JavaScript evaluation or memory profiling** (#430): the README no longer claims batch JS or memory profiling have no MCP equivalent, the article's tables no longer mark performance tracing as missing, and the November 2025 benchmark is presented as one run of five tasks against bdg 0.6.x, with score and tokens shown separately instead of a "33% token efficiency" headline; capability tables are corrected against the current chrome-devtools-mcp tool reference (it still has no HAR export).

- **`--json` lists are bounded** (#436). One routine `--json` call could fill an agent's context; now JSON lists about as much as the default human output, and `--limit 0` still lists everything listable. On Wikipedia "United States" (piped, so compact JSON, #441, on both sides):

  | Command | Before | After |
  |---|---|---|
  | `dom a11y tree --json` | 5.82 MB (51,441 nodes) | 7 KB (50 nodes, `omitted: 20067`, `skipped: 31324`) |
  | `dom a11y query role:link --json` | 1.33 MB (5,606 matches) | 23 KB (100, `omitted: 5506`) |
  | `dom query a --json` | 163 KB (1,000 matches) | 16 KB (100, `omitted: 6518`) |

  - **Breaking:** `dom a11y tree --json` is a flat, bounded list. `data.root` and each node's `childIds` are gone; `nodes` lists the same nodes as the human output, depth-first, each with its `depth` (0 = the root, `nodes[0]`), plus `count` (the whole tree), `omitted` (nodes cut by `--limit` or `--depth`) and `skipped` (text boxes, blank or repeated text, nameless layout wrappers: never listed), so `count` = listed + `omitted` + `skipped`. The raw tree is `bdg cdp Accessibility.getFullAXTree --json`.
  - `dom a11y tree` takes `--limit <n>` (default 50, also with `--json`; 0 = all listed nodes) and `--depth <n>` (0 = root only). `--limit 0 --json` is 2.6 MB. A cut tree no longer ends with `Use --json flag for complete output` but with `20067 more: --limit 0 lists all, --depth <n> limits the levels, or search with bdg dom a11y query "role:<role>"`.
  - `dom a11y query --json` (and `dom a11y <search> --json`) lists the first 100 matches instead of all of them, `dom query --json` 100 instead of 1000, with `count` and `omitted`. Indexing is unchanged: every a11y match and the first 1000 `dom query` matches still work as indices (`bdg dom click 250`).
  - `dom layout` and action request lists no longer say `use --json for all` under a shortened list; JSON is capped there too: `... and 5 more (--json lists up to 100)` (layout) and `(--json lists up to 50)` (triggered requests).

### Fixed

- **Network capture keeps the newest requests at its cap and bounds stored bodies** (#437). At 10,000 requests bdg dropped every new one, silently: after a flood, later page loads recorded nothing, including the request being debugged. Now the oldest finished requests are dropped instead (requests in flight never are), like console messages. Response bodies had only a per-body limit (5 MB): 60 polls of a 4 MB endpoint grew the daemon to 427 MB. Stored bodies now total at most 100 MB; past that the oldest bodies are replaced by a placeholder (`details network <id>` says `evicted: total body budget`) while their requests stay. `network list` (also `--follow`, once), `peek` and `status` say how many were dropped or evicted (`⚠ 2000 older network requests were dropped: bdg keeps the newest 10000`); JSON has the counts (`dropped`/`bodiesEvicted` in `network list`, `totals.networkDropped`/`totals.networkBodiesEvicted` in `peek`, `activity.networkRequestsDropped`/`activity.networkBodiesEvicted` in `status`).

- **`dom inspect` no longer waits 1 s for the hints on every call on CSS-heavy pages** (#443). On github.com/microsoft/vscode, `CSS.getMatchedStylesForNode` takes 1.7–5 s, so each default inspect waited the full hint budget and printed "CSS rules not read". Now, once a hint read outlasts its budget, later default inspects on that page skip the wait and say `hints skipped: this page's stylesheets are slow to read (--rules waits 5 s)` (`cascade: "skipped"` in JSON) until a read is fast again, a stylesheet changes or the page navigates. A matched-styles request still running is shared, and an answer that took over 300 ms is reused for up to 5 s, dropped by any command that may change the page (click, fill, key, scroll, eval, navigation, emulation, `bdg cdp`, …) and by stylesheet or DOM changes, since states like `:checked` or `:hover` change without any event. Only one matched-styles request runs at a time, so abandoned requests no longer pile up in Chrome, and the rules are asked for after the element's other reads, which no longer queue behind them. `--rules` and `--why` still wait up to 5 s. Measured there, 5 default inspects of `.markdown-body` in a row: 0.72 / 0.49 / 0.56 / 0.63 / 0.51 s → 0.55 / 0.13 / 0.11 / 0.11 / 0.11 s (`--no-hints`: 0.11–0.12 s); with 8× CPU throttling (the rules then take ~4 s) 5.7 / 4.3 / 4.1 / 3.6 / 3.3 s → 1.7 / 1.9 / 0.21 / 0.20 / 0.23 s.

- **A slow Chrome start is no longer reported as "Port N is already in use"** (#435). When Chrome announced its port but `/json/version` did not answer within 5 s (a cold or busy machine), bdg took it for another process on the port. It now asks again until the launch deadline and reports a slow start (CHROME_LAUNCH_FAILED) if Chrome never answers. A real port conflict says what was found on the port.

- **Long values are cut, with `--full` to get them whole** (#440). `dom get --raw` and `dom eval` printed a value whatever its length, and `peek` and the `console` summary printed console messages that `console --list` cuts. Now:
  - `dom get --raw` (each element's HTML) and `dom eval` print the first 20000 characters followed by `… N more chars (use --full)`; in `--json` an `outerHTML` or a string eval result over 20000 characters is cut with `truncatedFrom` (its original length).
  - `peek` and `console` (summary, `--list`, `--follow`) cut console message texts at 200 characters like `console --list` did, with the same pointer; in `--json` a text over 10000 characters is cut with `truncatedFrom`.
  - `--full` on `dom get` (with `--raw` or `--node-id`; no longer rejected), `dom eval` (and `bdg eval`), `console` and `peek` prints the values whole, byte for byte.

  On Wikipedia "United States": `dom get body --raw` 3.39 MB → 20 KB (`--json` 3.52 MB → 23 KB), `dom eval document.documentElement.outerHTML` 3.56 MB → 20 KB (`--json` 3.69 MB → 21 KB). On a page that logs a 500 KB string and throws a 100 KB Error: `peek` 600 KB → 0.8 KB (`--json` 601 KB → 21 KB), `console` 101 KB → 0.8 KB, `console --list --json` 701 KB → 31 KB.

- **Web components: text filters, `dom layout` and `dom click` read the flat tree like `dom query`** (#433). A component whose shadow root renders `<button>Save draft</button>` showed as "Save draft" in `dom query`, but `x-btn:has-text("Save")`, `:text-is("Save draft")` and `dom wait x-btn --text "Save draft"` found nothing: text filters read `innerText`, which does not enter shadow roots. They now read a visible component, slot or element holding either the way display does (its shadow root's text, slotted content in place), still including the selects and contenteditable regions `innerText` reads; a hidden component (in a hidden tab panel) is read through its shadow root too. Other elements still use `innerText`: `*:has-text("x")` costs 228 → 229–238 ms page-side on Wikipedia "United States" (21,918 elements, no components) and 15–16 → 28 ms on a Shoelace docs page (4,229 elements, 164 components), same matches. An element slotted into a collapsed `height: 0; overflow: hidden` container inside a shadow root was reported `visible` by `dom layout` (the clip walk skipped the slot); it is now `hidden (clipped by div: zero height)` like the same markup without shadow DOM, and fixed positioning is also resolved through slots. `dom click` on an element clipped away like this (with or without shadow DOM) says `Element is hidden (clipped by div#acc: zero height)` instead of "covered by another element (html)".

- **`bdg --help --json --full` documents `--headless`, `--no-headless` and `-a, --all`** (#442). Their behaviors were registered under a `start` command that does not exist; option behaviors are now looked up by the long flag (five dead duplicates removed), and a test fails when a behavior names no real option.

### Internal

- **CI merge gate** (#434): one required check, `CI OK`, aggregates build, quality, contract and smoke jobs; docs-only PRs skip them and still pass. PR smoke runs on Node 22 only (22/24/26 on `main`); macOS smoke runs on `main` and nightly. The Release workflow refuses a tag whose commit has no green CI run on `main`.

## [0.13.0] - 2026-10-07

### Changed

- **Follow modes end with their session, and print NDJSON** (#389). `peek --follow`, `console --follow` and `network list --follow`:
  - stop with exit 83 when the session they follow ends, instead of retrying silently forever;
  - exit 130 on Ctrl-C and 143 on SIGTERM (it was 0);
  - with `--json`, print one compact object per line, and one error line per failed refresh.
- **Chrome gets a window on macOS by default** (#382). Display detection only looked at the X11/Wayland variables, which macOS never sets, so every Mac started headless and it looked like nothing happened. A Mac now counts as having a display unless the shell came in over SSH or `CI` is set. Agents running unattended should pass `--headless`. `--headless` and `--no-headless` override either way.
- **`dom query` on large pages** (#385): it describes only the first 1000 matches, in one page-side pass, and lists 50 of them (`--json`: 1000) with the total count. `--limit <n>` lists more (0 = all). On a page with 50 000 elements, `dom query "*"` took 23 s and printed 7 MB of JSON; it now takes about half a second, and the JSON is 190 KB. Indices past the indexed matches say so and how to index more. `--json` has `count` (all matches), `nodes`, `omitted` and `indexed`.
- **`bdg --help --json` is compact** (#390): 29 KB instead of 173 KB (about 7k tokens instead of 40k). Its `command` tree has each command's name, first description line, arguments and flags with their descriptions; the top-level fields stay. `bdg <command> --help --json` describes one command in full (option behaviors, defaults, choices and, new, its help text with examples), with a group's subcommands compact and without the root-only fields (`taskMappings`, `runtimeState`, `decisionTrees`, `capabilities`): `dom query` 18 KB → 5 KB, `dom` 74 KB → 12 KB. `bdg --help --json --full` prints the previous full tree. Help JSON is no longer indented.
- **`bdg cdp` prints text without `--json`** (#390): domain and method lists and search results one line each, `--describe` with parameters, return values and the example, a method's result as indented JSON (`<Method>: done (no result data)` for an empty one), errors on stderr. It printed the JSON envelope even without `--json`; scripts that parse its output need `--json` now.

### Fixed

- **Leftovers of the 0.13 retest** (#420):
  - `bdg <url>` after a daemon crash that also lost `chrome.pid` failed with exit 100 (`profile in use`): the start now kills the session's leftover Chrome by its `--bdg-session-dir` marker, as `bdg cleanup` does, unless another daemon of the session still runs.
  - `bdg cleanup` said `already clean` after it removed the record of a session that ended without `bdg stop`; that now counts as cleaned (JSON `cleaned.session`).
  - `bdg install-skill`: when one target cannot be written, the other is still installed and the error lists it with its backup (JSON `skills`); a failed write no longer replaces `SKILL.md.bak` first; a backup of a read-only copy gets the normal file mode; a file in the path is reported as such, not as a permission problem.
  - `CI=false` and `CI=0` no longer count as CI (Chrome kept its window).
  - `console --follow` and `network list --follow` report a page crash once (JSON: a line with `pageCrashedAt`); `bdg console` and `bdg network list` start with the crash warning, like `status` and `peek`.
  - A click that only logged console messages is no longer reported as having no visible effect.
  - `details network` leaves out an empty header section; it printed a bare `Request Headers:`.
  - Element labels leave out class fragments like `brush:` (from `class="brush: html"`); a shadow host read `<mdn-code-example.brush:>`.
  - `bdg console` warns about dropped messages only when they could be of the page shown (always with `--history`).
  - The peek tip reads `bdg peek --last 50 or bdg peek --verbose` (it read like a pipe); follow modes print their banner once (on stderr).
  - `bdg netwrk list` suggests `bdg network` (it said `too many arguments`); `-josn` suggests `--json` (it said `unknown option '-osn'`).
  - `dom get` on a long heading with inline children printed its text twice (name and `Text:`).
  - `bdg cdp Network` lists the domain's methods, as `--list` does; a method whose result reports a page exception (`exceptionDetails`, e.g. `Runtime.evaluate` of a throwing script) exits 91 with the exception, as `dom eval` does.
  - Conflicting options (`dom get --raw --full`, `dom click --double --right`, `dom get --all` without `--raw`) have a `suggestion`.
  - `dom get --help --json` said a cached index past the end exits 81; it exits 87.
  - `dom query` says when it lists more matches than it checked visibility for (the first 100; JSON `viewportChecked`), and an index past the last match names the total (`1144 results`), not the 1000 indexed.

- **Web components read as they render** (#418). `dom get`, `dom query` and `dom layout` showed only light-DOM text, so a component often read `No text and no child elements` where a user sees text. Now:
  - previews, `dom get` text, `dom inspect` text and the `(in shadow root of <host "…">)` label read a component through its shadow root: its own labels (a field label, a dialog title), the fallback content of an empty slot, slotted content in place of its slot. Light-DOM text that no slot shows is left out.
  - block-level parts are set apart: `Named Title One Default body one` and `Blue Widget $19.99` were glued as `Named Title OneDefault body one` and `Blue Widget$19.99`.
  - the host label leaves out hidden text and ends a cut with `…`; it used the raw `textContent`.
  - a component without text lists what its shadow root holds, with aria-labels: `No text; its shadow root holds 1 element: button.icon-button "Close"`.
  - `dom layout` measures an open `display: contents` dialog component by what it shows. It called the dialog hidden.
  - action results name a shadow button by its slotted label (`button.root "Ok, got it"`, not `button.root`), an image link by its image's alt text, and a field by its `<label>` or `aria-labelledby`. A click on a shadow button whose label is slotted uses mouse events; it was reported as covered by its own host and fell back to DOM events.
- **Contrast over images is no longer a definite fail** (#417). White text over a dark photo read `#fff on #fff 1.00 fail` on stripe.com: the photo had `pointer-events: none`, which hit-testing skipped, and text over a background image still got a verdict.
  - Hit-testing now also sees `pointer-events: none` layers (hero images, blended duplicate headings).
  - Text over a background image or gradient is approximate (`contrast ≈1.16 on #fff (approximate: background image or gradient behind)`, without a pass/fail level).
  - `dom audit contrast` lists and counts in `failing` only text it can measure exactly, and counts the rest separately (`+14 more may be below it but cannot be measured`, JSON `uncertain`). For text out of view, it checks for an image under the text, unless the text sits on a solid ancestor background. The extra hit-testing costs nothing on dense pages: the audit adds its stylesheet once.
  - Audit rows show `(faded: opacity 0.4)`, and gradient text inherited from a parent is skipped as `dom inspect` does. On stripe.com, 123 failing rows that were mostly false became 0 failing and 14 uncertain.
- **`dom form --json` no longer contains passwords** (#416). It printed a password field's plaintext value in `fields[].value`, next to the masked one. Now the value of a sensitive field (password, card or one-time code, a field named like one) never leaves the page: it reads `••••` when filled, and a hidden input's value is left out, as everywhere else in bdg.
- **A cached index is never used on another page's element** (#416). After a query on one site and a navigation to another (a new renderer process), the new page reuses the old backend node ids, so `dom click 500` clicked an unrelated element on the new page with exit 0. Cached results now record the document they came from, and an index of an earlier document exits 87 (`no longer in the page`).
- **Session list and skill install leftovers** (#390):
  - `bdg install-skill` keeps a copy that differs from the one it installs as `SKILL.md.bak` and says so (JSON `backup`). An edited skill was overwritten without a trace.
  - `bdg stop` returns once the daemon has exited (up to 3 s, then a warning). A `bdg sessions` right after it listed the session as `starting`; a daemon still running without its socket is now `ending`.
  - `bdg sessions` lists a session that ended without `bdg stop` (Chrome killed or crashed, page closed, `--timeout`) as `ended`, with why and when (JSON `endReason`, `endedAt`), until it starts again or `bdg cleanup` runs. Before, it vanished from the list.
- **No Chrome left behind after a second start** (#388). With the daemon's socket deleted, a second `bdg <url>` started another daemon next to the first. The first one then removed the new daemon's `chrome.pid`, and `cleanup --force` reported a clean directory while a Chrome kept running. Now:
  - a start stops a daemon that lost its socket first;
  - a daemon removes only its own `chrome.pid` and metadata;
  - cleanup kills every Chrome launched for the session directory, found by its marker flag.
- **Pages that replace built-ins no longer give wrong answers** (#386). bdg's page scripts used the page's own built-ins: with `querySelectorAll` patched to return `body`, `dom query ".a"` printed `<body>` with exit 0. With `JSON.stringify`, `Array.prototype.map` or `Object.keys` replaced, commands failed with cryptic errors. Now:
  - `dom query`, `get`, `inspect`, `layout`, `audit`, `wait`, `form`, `a11y` and `screenshot` run in bdg's isolated world, which keeps the browser's built-ins.
  - When the page replaced the selector search, actions find their element in that world and say so. When an action fails on a page with replaced built-ins, the suggestion names them as a possible cause.
  - `dom eval`, `dom listeners` and `bdg cdp` stay in the page's world.
- **Actions and `dom eval` on pages that replace built-ins** (#419):
  - With `Element.prototype.matches` replaced, every `fill` and `click` said "Element is disabled". The disabled check now reads the element's own attributes.
  - With MooTools 1.2 (or a replaced `Event`), `fill` wrote the value without firing input or change events and said "The element is no longer in the page" (87). Events now come from `document.createEvent`, and a failing action script is no longer mistaken for a removed element.
  - When an action's script throws because the page made an API throw (`getBoundingClientRect`, `getComputedStyle`, `scrollIntoView`, `focus`, `dispatchEvent`, the `value` setter), the error names the replaced built-ins and what was thrown, exit 90. It said "Script execution failed: Uncaught at line 33, column 60", with bdg's own script source and generic troubleshooting. These DOM APIs are now in the replaced-built-ins check.
  - The check reads CDP's description of each function, so a replaced `Function.prototype.toString` no longer hides tampering, and a broken `Function.prototype.call` no longer makes every built-in look replaced. Failures name all replaced built-ins; the warning names four, and `--json` lists all in `replacedBuiltins`.
  - With the NodeList or Array iterator, `Array.prototype.push` or `Set` replaced, the selector search runs in bdg's world.
  - `dom eval "({a:1,b:2})"` with `Object.keys` replaced printed `{"bogus": null}`, and with `Function.prototype.call` replaced, a lossy preview string. When the page replaced built-ins bdg's copy uses, the browser copies the result now, with a warning (JSON `warning`).
  - With `Array.prototype.forEach` replaced, `click` warned that the page saw no mouse press; with `Array.from` replaced, select `fill` listed no options and the element description lost its classes.
- **A crashed page is detected** (#384):
  - After a renderer crash, `bdg status` and `bdg peek` say `⚠ The page crashed at … (renderer gone); bdg page reload brings it back` (JSON `pageState.crashedAt`, `pageCrashedAt`).
  - Page commands fail at once with the new exit code 107 (`PAGE_CRASHED`), as do commands that were waiting on the page when it crashed. Before, the session looked active and `dom query` failed after 29 s with "The page was busy for 20s".
  - `page reload` brings the page back.
- **Session directory and Chrome profile are checked before use** (#387). `BDG_SESSION_DIR=/proc/x` used to spin at full CPU until it was killed (Node's recursive `mkdir` loops on Linux pseudo-filesystems). `--user-data-dir /proc/nope/x` wedged the session until `bdg cleanup --force`. Now a directory that cannot be created or written is refused at once, before a daemon or Chrome starts: exit 103 for the session directory, 81 for the profile, 82 when permission is denied.
- **`console` on busy pages** (#383):
  - The session keeps the newest 10000 messages instead of the first 10000. A page that logged 10000 messages used to hide every later one: after navigating to a page that logs errors, `bdg console` said "No errors or warnings found".
  - `console`, `peek` and their JSON say how many were dropped (`dropped`, `totals.consoleDropped`), and message indices stay stable.
  - The summary and JSON list the newest 50 distinct errors and warnings, with a note for the rest. 10000 distinct errors printed 329 KB of text and 4.4 MB of JSON. `--last <n>` sets how many (0 = all).
- **`dom get` and `dom query` read the text a user sees** (#390):
  - `dom get` on an element whose accessible name differs from its visible text adds a `Text:` line. TinyMCE's body showed only `"Rich Text Area. Press ALT-0 for help."`, not "Your content goes here.". Buttons and links whose name is their text keep one line. JSON already has both (`node.name`, `domContext.preview`).
  - An element in a shadow root that shows its content through a `<slot>` is read with the slotted content. A shadow `<p><slot>` said `No text; holds 1 element: slot` in `dom get` and had an empty preview in `dom query`.
- **What `dom inspect`, `dom layout` and `dom audit` cannot see is said** (leftovers of the Stripe retest, #403):
  - the text line skips text inside an `opacity: 0` descendant (a measuring copy under a mask set the color and contrast);
  - an element under a `mask-image` (on it or an ancestor) is marked `[masked by mask-image on div.hero]` (`dom layout`: `masked by …`, JSON `masked`) instead of reading as fully visible;
  - `dom audit contrast` checks what is painted behind or on top of text in view, as `dom inspect` does (`approximate: img behind`), and marks text out of view whose ancestors paint nothing `approximate: only its ancestors were checked` (white text over an image read `1.00 #fff on #fff`);
  - `dom audit animations` counts visible canvas elements, whose script-drawn animations it cannot list;
  - `dom click` and `dom hover` say when they scrolled the page to reach the element (`Scrolled: page down 1240px to reach it`, JSON `scrolledBy`);
  - `dom inspect --all` lists `-webkit-text-fill-color: transparent`, and the fill line of gradient text says `clipped to the text`.
- **Argument parser errors suggest a fix** (#390). An unknown option, a missing argument or option value, an invalid choice or a conflicting option had no `suggestion` in the JSON envelope. Now a mistyped option gets the closest option of the command, the hidden `--session` and `--quiet` included (`--sesion` suggested `--json` before), and everything else `Run "bdg <command> --help" for usage`. Without `--json` the suggestion is printed under the error. Exit code stays 81.
- **`bdg cdp --search` with a blank query exits 81** (#390): `--search " "` listed all 675 methods as matches. `--search`, `--list`, `--describe` and `--params` together exit 81 instead of silently ignoring all but one.
- **`dom inspect` token estimate** (#390): a button takes about 80–130 tokens with the default hints (the browser-default form-control font hint alone is about 50), not 60–100; `--no-hints` drops the hints.

## [0.12.0] - 2026-10-06

### Added

- **`--mobile`** - `bdg <url> --mobile` and `bdg page emulate --mobile` emulate a phone: a mobile viewport (390x844 unless `--viewport`) at pixel ratio 3 with mobile layout and overlay scrollbars, touch (`pointer: coarse`) and an Android Chrome user agent with mobile client hints. A narrow desktop viewport kept classic scrollbars (375 laid out at 360), a desktop user agent and no touch (#376)
- **`dom audit`** - Page-wide checks without screenshots or `dom eval`: text below WCAG AA/AAA (weakest first, composited like `dom inspect`), what makes the page scroll sideways, cut-off text, upscaled or distorted images, fixed/sticky layers and running animations. The review's agents wrote the same `dom eval` scans again and again for these (#378)
- **`css search <text>`** - Finds a text in every stylesheet of the page, cross-origin ones included, with the rule and its `file:line` (#378)
- **`dom inspect` shows the rule itself** - `--why` prints the winning rule as written under it (`.card .btn { background: #9db8ff; }`), and `--rules`/`--why` JSON have it as `rule`. A long minified rule is cut to its selector and that declaration (`.btn { … background-color:var(--bs-btn-bg); … }`), so `bootstrap.min.css:5:53709` comes with what is there (#364)
- **`peek --follow --interval <ms>`** - Sets how often `--follow` refreshes (100-60000 ms, default 1000), as `tail --interval` did (#115)

### Fixed

- **Fixes from the retest round of the `dom inspect` review** (9 agents, same tasks as the first round). The issues fixed are below; the full list is in the PR.
  - Children of links were marked `(shadow root)`. That came from `<a>.host`, which is the URL's host.
  - `dom audit overflow` missed cut-off text in containers that hold elements, did not list sideways scrollers, and listed hidden layers. It also skipped text slotted into web components and counted gradient (`background-clip: text`) text as failing.
  - `--rules` showed the final color for a shorthand whose longhands another rule overrides. It now shows the declaration's own value, `(partly overridden)`.
  - The "set only by …" hint named another element's `:hover` rule, and did not see `:root` from inside a shadow root.
  - Screenshot notes now tell `--padding` apart from overflow.
  - "in viewport (out of view)" wording, approximate contrast now shows `≈` and contrast always names its background, links that wrap one block of text get a text line, `--why` showed browser defaults with an empty value, `dom wait` with no arguments now waits for the load, and `css search` drops duplicate rows and shows the selector of long rules.
  - "covered by" now names the overlay (`aside`, `header`), not a span inside it, and opaque images no longer read as "transparent".
- **`dom screenshot` element captures** - The capture includes what the element paints beyond its box: text past a tight line height (descenders were cut off), its box shadows and outline (a focus ring was cropped). `--padding <px>` adds page around it. An element taller than the viewport is no longer shifted by half a scrollbar, the page scroll is put back after an element is scrolled into view for the capture, `--selector ".item" --index 2` picks that match instead of exiting 81, and a scaled image says so (`scaled from 1280×2777 to 723×1568; --no-resize for full size`) (#375)
- **Action leftovers from the `dom inspect` review** - `New text:` says how many more messages there were (`(+4 more)`, JSON `moreMessages`; Bootstrap's form showed 3 of 7 with no hint). `dom fill sl-input …` fills the one field in a web component's shadow root instead of exiting 83. `dom hover --off` moves the mouse off the page, closing menus that open on hover. Matches in shadow roots name their host with its class and text (`in shadow root of <sl-button.primary "Save">`), `dom query` shows `part` names, and a `::part()`/`::slotted()` selector that matches nothing explains how to select the part instead (#377)
- **`dom inspect` describes the text a user sees** - Font, color and contrast come from the descendant that draws most of the text, named first (`text in abbr · … contrast 1.14 fail`), including text slotted into a shadow root (`in slot.label`). An element with its own text and an icon or block child keeps its text line, an element without text (icon button, checkbox) has none, and text that is not rendered gets no contrast. Before, a link's color hid its child's 1.15:1 contrast, and a caption with a block child lost its text line (#368)
- **`dom inspect --why` answers every shorthand and inherited property** - `--why transition`, `outline`, `background-position`, `text-decoration`, `font-variant` and other shorthands said "no author declaration" though the page set them; inherited longhands such as `caret-color` and `overflow-wrap` were not followed to the ancestor; a custom property registered with `inherits: false` showed as inherited; `h1, .title` was labelled `h1 [0,0,1]` instead of `.title [0,1,0]`; and `--why colour` printed an empty answer with exit 0 (now 81 with `Did you mean: color?`; `--why all` says to name one property). A shorthand's value is written as `--all` writes it (`outline 2 solid #f00`), and `background: var(…)` counts for every background longhand. `--all` lists running transitions (`transition color 1s ease-in`), `appearance: none` on form controls and a cleared tap highlight, and no longer pads SVG elements with defaults; `--rules` covers `background-size`/`background-position` (#369)
- **`dom inspect` no longer calls a loaded web font a fallback** - On stripe.com every element read `sohne-var (rendered "Copyright Klim Type Foundry")`: the name inside the font file. When the first family is a web font the page loaded, no `rendered` note is shown; a generic family says what it became (`monospace (resolves to "Menlo")`) instead of looking like a fallback (#370)
- **`dom inspect` contrast composites like the browser** - A translucent ancestor now fades its own background with the text: white text in an `opacity: .5` black box was `5.28 AA on #000`, it is `3.97 fail on #808080`. When the number cannot be exact, it says why: `(approximate: mix-blend-mode hard-light on h1)`, `filter on div.skin-invert`, `canvas behind`, `div.overlay on top` (#371)
- **`dom inspect`/`dom layout` cover and visibility badges** - A headline under a sticky header was `partly visible … under transparent svg.Icon (clicks land on it)`: the cover is now the first element above that paints (`covered by header`). Buttons inside a shadow root were `covered by` their own host (`sl-button`), and an open dialog whose host is `display: contents` read "transparent"; both are fixed. An inline list with zero size around visible floated buttons (GitHub's Star/Fork) was `[hidden: zero size]`. `dom inspect` picks the first visible match (Apple's first `h2` was `visibility: hidden`), and a `position: fixed` element shows its viewport position (`@0,70 in viewport`) instead of a page position that moves with the scroll (#372)
- **`dom inspect` hints: fewer false ones, clearer winners** - No hint for declarations that restate a default (`vertical-align: baseline` from resets flagged almost every element on BBC and the Guardian), for `<audio>` widths, `vertical-align` on inline tables, or margins in vertical writing modes. Vertical margins of an inline link are flagged even when the sides work (`margin: 8px 12px has no effect on margin-top, margin-bottom`). An unset variable the page sets elsewhere says where (`set only by .btn:hover, which does not match now`, `only in @keyframes`, `set to inherit by :root`) instead of suggesting a typo fix. A flex item's blockified display is explained (`display is flex (inline-flex blockified: a flex item)`, `--rules … = flex (blockified)`); `--why` marks a winner with no effect (`no effect: position is static`) and an invalid `var()` (`falls back to the initial value`); scroll-driven animations no longer show the `[animating …]` badge (#373)
- **`dom inspect` output is consistent** (#374):
  - values: `calc(100% - 9px)` and `url(hero-1920px.jpg)` keep their units, `scaleX(-1)` reads `scale(-1,1)`, each background layer has its own `size`/`at` position, SVG elements show `fill`/`stroke`, `--rules` gives `= value` for every `var()` (also shorthands and logical properties: `padding-block calc(var(--sp) * 2) = 8`), a wider shorthand is one row (`border none`, not three), a blockified display and rem custom properties are resolved (`--spacing: .25rem = 4`);
  - labels: `truncated` marks text that is really cut off (the header's "…" is only bdg shortening), a rotated element shows the box it covers on screen (`100x50 (107x67 on screen)`), `in-parent` is right under CSS `zoom`, `sib` skips zero-size siblings, `over` names the place when a rule beats one with the same selector (CSS-in-JS), `--props … --rules` shows browser defaults, `@supports`/`@scope` conditions are shown, a stylesheet a script built says so instead of `page:1`, the dark-theme badge says when `page emulate` set it, and the legend explains `(+N)` classes and `sizing`;
  - `--why` lists rules that set the property under a `@media`/`@supports` condition that does not apply now (`- 40px  .resp @media (max-width: 600px) (does not apply now)`);
  - tree: rows in a shadow root, reached through a slot or a `display: contents` wrapper are marked (`(shadow root)`, `via div.wrap (contents)`), and text-only slots are shown;
  - `dom inspect "a::after"` inspects the link and points at its `pseudo` line, which now has the offsets (`inset`).

### Deprecated

- **`bdg tail`** - Use `bdg peek --follow`, which has the same options plus `--type`. `tail` still works and prints a note; it will be removed in a later release (#115)

## [0.11.0] - 2026-10-06

### Added

- **`bdg install-skill`** - Installs the bdg agent skill for Claude Code (`~/.claude/skills/bdg`) and agents that read `~/.agents/skills` (Codex, Gemini CLI, ...); `--claude` / `--agents` pick one. The skill now ships in the npm package and covers action effects, `dom inspect`, `dom wait`, network and console, `--json` and the current exit codes.

## [0.10.0] - 2026-10-06

### Added

- **`bdg page emulate`** - Change the viewport (`--viewport 900x700`) or `prefers-color-scheme` (`--color-scheme light`) mid-session, or `--reset` both, to check responsive and themed styles without restarting or raw CDP calls (#353)
- **`bdg dom inspect <selector|index>`** - What one element looks like, without a screenshot, like Figma's Dev Mode: box (margin, padding, borders), layout (display, flex/grid, position, the parent's layout and the distances to its edges and siblings), text (the font family and the font Chrome actually rendered, size/line-height, color and WCAG contrast), fill, border, effects, interaction state, `::before`/`::after`/`::placeholder`, and a compact child tree. Values that change nothing are left out, colors are hex (Tailwind's `oklch()` converted), so a button takes about 60–100 tokens. The placeholder has its own contrast, a transparent box over an element is told apart from a real cover (`under transparent ul.filters (clicks land on it)`, also in `dom layout`), and pages shown in their dark theme because the system prefers dark are marked. `--json` uses Figma's names (fills, strokes, effects, sizing hug/fill/fixed) for comparing with a design; `--props` reads chosen properties (`'--*'` or `'--bs-btn-*'` lists custom properties), `--all` every non-default one. Declarations that have no effect get a hint with the reason, the fix and the rule's file:line (`justify-content: center has no effect: display is block → use display: flex or grid on this element`); `--rules` names the rule that sets each property (with its media condition, layer and the rules it beats) and `--why <property>` lists every declaration of one property, the winner first, with `var()` values substituted and where the custom properties come from. [docs/FIGMA_DESIGN_QA.md](docs/FIGMA_DESIGN_QA.md) shows how to check a page against a Figma frame with the Figma MCP server; tree rows have `x`/`y` in the parent for that (#333)
- **`dom listeners` resolves Preact handlers** - Preact's event proxy on an element is replaced by the handler Preact runs for it, with its name, source and location, marked `[Preact]` (`framework: "Preact"`; Preact 10 and 11 and unminified builds, the handler store's key read from the proxy's source; other dispatchers are left alone) (#346)
- **`dom query` shows the attributes that identify an element** - by type, in its tag: an image's `src` file name and `alt`, a link's `href`, a field's type, name, placeholder and current value (`checked` for checkboxes and radios), a button's type, a select's name and selected option, an iframe's host and a form's `action`/`method`; long values are cut in the middle. `--json` has the full values in `attributes`, and `dom get` shows the same after the role (`domContext.attributes`). Secrets never leave the page: hidden inputs' values are not read, and password, card (`cc-*`), one-time-code and password-like fields (also when switched to text, or masked by CSS) show `••••` whatever their length, in `dom get`'s accessibility value too (#346)
- **`network list` START column** - when each request started, from the start of the current page (`+1.2s`; earlier pages negative), from Chrome's timestamps. `--json` requests now carry `sentTime` and `navigationId`, and `data.pageStart` is the start the column counts from (#346)
- **`details network` shows the remote port** (`serverPort` in JSON) and labels a loopback address on another port than the URL's, for a host that is not this machine: `Remote Address: 127.0.0.1:9000 (loopback; likely a local proxy)` instead of `127.0.0.1` (#346)

### Fixed

- **`bdg cdp` errors from Chrome are user errors** - a missing node, target or frame exits 83 (with where node ids come from) and wrong parameters exit 81 (pointing to `--describe`), instead of 110 (#353)
- **Selectors that try to cross a shadow root say so** - `my-modal form` finds nothing even when the form is in the modal's open shadow root; the error now names the host and the selector that works (`use "form"`) (#353)
- **Element screenshots of centered content were shifted** - `dom screenshot <file> <selector>` captured with Chrome's "beyond viewport" mode, which lays the page out without its scrollbar and moved centered content by half its width (about 7 px: a card's left border cut off). An element that fits the viewport is scrolled into view and captured as the page shows it; only areas larger than the viewport still use that mode (#333)
- **Stable `dom frames` indices** - Frames are listed in the document order of their `<iframe>` elements (open shadow roots included, out-of-process frames at their element's place) instead of in-process frames first in the order Chrome attached them, and `eval --frame <n>` exits 87 ("Frame index n is stale…", re-run `bdg dom frames`) when the frame at that index changed since the last listing instead of running in another frame (#346)
- **No console error left by `dom eval` rejections** - `bdg dom eval 'Promise.reject(…)'` reports the rejection (exit 91) without leaving "Uncaught (in promise)" in `bdg console`: Chrome's report is revoked once bdg handles the promise, and revoked reports are dropped as in DevTools. Rejections nothing handles still show (#346)
- **`dom listeners` across nested React roots** - For an element in a React root mounted inside another root, the outer root's `on…` props are listed too, as React runs them (#346)
- **`dom hover` and `dom pressKey` say what they showed**: `Shown: div.figcaption "name: user2 View profile"` for a caption a hover revealed (also through CSS `:hover`), a tooltip or menu, or `Shown: li "Buy milk"` for the item Enter added near the target (`shown: [{ text, element }]` in JSON, at most 3; widgets elsewhere on the page are left out), besides the navigation and new messages they already reported (#346)
- **`dom click` and `dom pressKey` say when the page was still changing** as they returned: `⚠ Element Clicked (page still changing)` with a note naming what was pending (content requests, a new page loading, a loading indicator, a DOM still changing, a page busy running a script) and suggesting `bdg dom wait <selector>`; JSON has `settled: false` and `pending`. The saucedemo `performance_glitch_user` login, which returned at 0.5 s while the products appeared after 5 s, now says so (#346)
- **`--strict` for `dom click` (also `--double`/`--right`) and `dom hover`**: refuses with exit 90 instead of falling back to DOM events when a real mouse cannot reach the element, naming what covers it and suggesting `bdg dom layout`; also when the mouse press never reached it (#346)
- **A failed start returns after its daemon is gone** - when the daemon a start launched reports a failure (`--chrome-ws-url` attach refusal, Chrome launch failure), it exits; the CLI returned the error before it was gone, so a `bdg sessions` right after it could still list the session as `starting`. The CLI now waits up to 3 s for every daemon the start launched to exit and remove its files (not after a timeout, when the daemon may still be starting); a daemon still running then is reported (`daemonStillRunning: true`, `daemonPid` and a `suggestion` in JSON) (#346)
- **`details network` repeated headers** - a header the server sent several times (CDP joins them with newlines) printed its second value on an unindented line, read as `Strict-Transport-Security: max-age=63072000 / max-age=63072000`; each value now gets its own line and a value repeated verbatim is listed once with `(sent 2 times)` (`Set-Cookie` lines are all kept) (#346)
- **`network list` column alignment** - the method column widens for `OPTIONS`, which shifted the rest of its row (#346)
- **Help says where selectors search** - `dom query --help` says that open shadow roots and same-origin iframes are searched and closed shadow roots and cross-origin iframes are not (with `dom eval --frame` for the latter); `get`, `layout`, `listeners`, `click`, `fill`, `hover`, `submit` and `pressKey` name the scope in their argument help (#346)

## [0.9.0] - 2026-10-05

Thanks to the fresh-agent UX tests: four agents with no prior knowledge of bdg worked through real sites three times, and most entries below come from what slowed them down. Between the first and third round their workarounds dropped sharply (hand-written `dom eval` on the forms task 5 → 0, visual questions 7 → 1, screenshots 6 → 2 in total, blind `sleep` loops gone).

### Breaking changes

Output that scripts may parse changed; the JSON envelope (`version`, `success`, `data`, `error`, `exitCode`) did not.

- **Session start prints 4–7 lines** instead of the ~60-line command list (`-q` unchanged)
- **`dom eval` prints strings raw** in human output (JSON-like strings, `""` and `"undefined"` stay quoted; `--json` unchanged)
- **`dom form` JSON**: `readyToSubmit` is false for an untouched form, choice groups count once, hidden fields are listed with `hidden: true`, forms are ordered dialog-first and indices follow that order
- **`dom submit` JSON**: `networkRequests` counts the reportable requests (listed + omitted), no longer `data:` URLs and preflights; the human `Navigation: yes` row became a `Page:` line
- **`dom layout` JSON**: `scrollBy` is the minimal scroll for a partly visible element (centring only for elements out of view)
- **`dom get`**: `--index` replaces `--nth` (kept as an alias); without an argument it reads `body`
- **Session names** are lower-cased and must start with a letter or digit

### Added

- **`--chrome-ws-url <port>`** - Attach to a running Chrome by its DevTools port (`9222`, `host:port` or `http://host:port`); bdg looks up the browser WebSocket URL itself, so logging in by hand first and then attaching takes one command (#47)
- **Triggered requests after DOM actions** - `bdg dom click` (incl. `--double`/`--right`), `hover`, `fill`, `pressKey`, `submit` and `scroll` list the network requests the action started (method, URL, status, duration; pending when still running) under `Requests during the action:` (first 10) and in JSON as `data.triggeredRequests`, from the session's network telemetry and without waiting longer than before (#111)
- **Named sessions: `--session <name>` / `BDG_SESSION`** - Run several independent sessions on one machine (e.g. one per agent): each named session has its own daemon, Chrome, profile and files in `~/.bdg/sessions/<name>/` (`$BDG_SESSION_DIR/sessions/<name>/` with `BDG_SESSION_DIR`). The option is accepted by every command, before or after the subcommand; `stop`, `cleanup` and the other commands act on the selected session only. Without `--port`, a named session picks a free port above 9222 that no other running session claims, even when sessions start at the same time. `bdg status` shows the session name, and the new `bdg sessions` lists running sessions with their state, port, PID and URL. Without `--session`, everything behaves as before (#131)
- **`bdg dom layout <selector|index>`** - Where elements are and whether a user can see them, without a screenshot: page and viewport coordinates and size, viewport position (`visible`, `partly` with the visible share, `above`/`below`/`left`/`right` with the scroll that shows them, `hidden` with the reason), the element covering them (overlays, sticky headers) and their display/visibility/position/opacity/z-index, plus the viewport, scroll position and document size. Accounts for same-origin iframes and scroll containers (`clippedBy` names the container an element is scrolled out of), flags inert elements; every match (or one with `--index`, or a cached query index) in one page-side pass. `dom query` marks matches outside the viewport or hidden (`(below fold)`, `(hidden)`) and adds `inViewport` to its JSON for the first 100 matches (#117)
- **`dom listeners` shows React handlers** - The `on…` props React runs for the element (`onClick`, `onClickCapture`, `onChange`, `onKeyDown`, …), its own and those of its React parents (walked through React's fiber tree, so portals count; parents' props for events React does not bubble, such as `onMouseEnter` and `onScroll`, are left out), are listed with their name, source and location, marked `[React onClick]` (`framework: "React"`, `reactProp` in JSON; React 16-19 props keys or the fiber's `memoizedProps`, read without running getters; `onFocus`/`onBlur` as `focusin`/`focusout`; at most 50 of the requested types per call, `reactHandlersSkipped` counts the rest). The handlers that run for the element now come first (types handled on the element before delegated ones, no-ops last), and the note no longer says `click` has no listener on the element next to a `[no-op]` row: it calls that row React's placeholder and points to the React handler above, says when React's root handles a type without an `on…` prop, and words jQuery and plain delegation separately (#331)
- **`bdg dom wait [selector]`** - Wait until elements appear, become visible (`--visible`), contain a text (`--text`) or are gone (`--gone`), and/or the page has loaded (`--load`), instead of `sleep` loops in `dom eval`. The page watches itself (DOM mutations plus a short poll) and answers as soon as the matches change, the wait continues across navigations, selectors reach shadow DOM and same-origin iframes and take `:has-text`/`:visible`. Human output is one line (`✓ div#finish visible after 5.1s`); `--timeout` (default 10000 ms) exits 102 with what the page showed last (`last seen: 2 matches, none visible`) and a next step. `dom click`/`submit` help points to it for results shown later by timers (#329)
- **Start options `--viewport <WxH>` and `--color-scheme light|dark`** - `bdg <url> --viewport 1280x800` gives the page exactly that viewport for the whole session (through navigations; a launched Chrome also opens its window at that size), and `--color-scheme` emulates `prefers-color-scheme`; both work with `--chrome-ws-url` (Chrome drops them when the session ends) and invalid values exit 81. Without `--color-scheme` the page keeps following the system (headless Chrome renders dark on a dark OS), and `bdg status` now shows the viewport and color scheme the page renders with, `dom layout` the scheme in its page line. `bdg cdp --search viewport` lists `Emulation.setDeviceMetricsOverride` first (search also knows "window size", "color scheme", "dark mode", matches names written with spaces, and lists name matches before description matches). `bdg dom screenshot out.png "#sel"` takes the element (selector or query index) as a second argument; with a different `--selector`/`--index` it exits 81 (#332)
- **Action results say what changed** - `dom click`, `submit`, `fill`, `pressKey`, `hover` and `scroll` report a navigation (`Page: navigated to https://…/secure (200)`, or `Page: URL changed to …/#/active (same document)` for history and hash changes; JSON `navigation: { url, sameDocument, status }`, taken from CDP events, so it is reported even when the page could not be read) and messages that appeared or changed (`New text: "Your password is invalid!" (div#flash.flash.error)`; JSON `messages: [{ text, element }]`) from alert/status/`aria-live` elements, `<output>` and flash/alert/error/toast/notice/message/invalid/feedback classes or ids, at most 3, 120 characters each, without close controls such as the "×" or aria-hidden parts; after a navigation every message of the new page counts, and texts of only digits and time units (clocks, counters) are left out. Both are left out when nothing changed. A click or submit with no DOM change, no request and no navigation (checked again 300 ms later) says `⚠ Element Clicked (no visible effect observed: no DOM change, requests or navigation within 300 ms)` (`effect: "none"`), e.g. saucedemo problem_user's Remove button; it is not claimed for form controls, labels, media, iframes, popover buttons, mailto:/tel:/javascript: and other non-http links, links to other windows, closed shadow roots, after a copy, when focus moves to a non-button, with `--no-wait`, hover or right-click, and focus/hover class changes on the clicked element don't count as changes (new shadow roots do). The cost is one page script sent before the action without waiting for it and one read after it (about 1 ms on small pages, under 10 ms on a large Wikipedia article; 300 ms more only when nothing changed; when the page does not answer, at most 200 ms for the snapshot and 250 ms per read) (#339)

### Changed

- **Agent output polish from the retest** - `dom frames` on a page still loading says `No iframes yet; the page is still loading, so the list may be incomplete (bdg dom wait --load)` instead of "The page has no iframes", and adds that as a note under a list (JSON: `data.readyState` while the page is not complete, on every listing, not only an empty one). `dom fill` names why it cannot fill an element (exit 81): `The element is read-only (contenteditable="false")` (also on the editor around it, e.g. read-only TinyMCE), `(readonly attribute)`, `(aria-readonly="true")`, `The element is disabled (inside a disabled <fieldset>)`, `The element is inert`; it also warns when filling a field behind an open `aria-modal` dialog. `dom form` lists forms in an open dialog first (also role-less modals such as DocSearch on react.dev: a raised fixed or absolute overlay whose class names a modal, or a raised fixed overlay over half the viewport or more; static wrappers and fixed app shells are not dialogs), then visible ones, then hidden ones, marks them `(in dialog)` / `(hidden)` (`hidden`, `inDialog` in JSON), now lists hidden fields (they were left out) flagged with the status `hidden` (`hidden: true` in JSON), counts a form with a visible button as shown, and numbers fields in that order, so `fill 0` is the dialog's search box. Action output describes the element itself: `div.figure (2nd of 3)` instead of an ancestor's text, which is only used for an element without text that is the only one of its kind (`input.toggle in li "Buy milk"`). "Not found" errors for a single id or class suggest up to 3 similar ones (`Did you mean #remove-sauce-labs-backpack, …? (similar ids on the page)`), and mention cross-origin iframes and `<object>`/`<embed>` only when the page has them. The `dom listeners` heading says where the counted listeners are (`(157: 2 on the element, 139 on ancestors, 16 on document and window)`). `dom layout` says `partly visible (24%); scroll down 302px to see all of it` for an element partly in view, gives sticky elements `offScreenReason: sticky position, page scroll moves it only until it sticks` instead of a scroll to centre them, and no longer reports as `coveredBy` an element of the same click target (an overlay inside the element's link, a link to the same URL, or a news card's overlay link over its headline, e.g. theguardian.com). `bdg status` starts with `Session active: <url> — <title>`, and the new `bdg page info` prints just the URL and title. `network list` cuts long URLs in the middle (host, start of the path, end of path and query) so similar requests stay distinguishable, and `network headers` shows the status line (`Status: GET 404 Not Found`; `method`, `status`, `statusText`, `errorText` in JSON). `dom get --full` prints all of an element's text instead of the first 500 characters, and text previews leave out close buttons and `aria-hidden` icons, so flash messages no longer end in `×`. `bdg status` and `dom layout` label the color scheme as the media preference the page sees: `prefers-color-scheme: dark (from the system setting)` (#340)
- **Shorter output for agents** - Session start prints a few lines (target, notices, one line of next commands with `dom layout`/`query`/`form`/`peek` before `screenshot`, and `bdg --help`) instead of about 60. `dom query` ends with one `Next:` line of index-based commands (`bdg dom get 0`, `--raw`, `bdg dom layout 0`), which also work for shadow-DOM and iframe matches, instead of a `document.querySelectorAll` one-liner. `dom eval` prints string results as is in human output (`My Page`, not `"My Page"`), except strings that would read as another value (empty, `undefined`, valid JSON such as `"[1,2]"`); `--json` is unchanged. `dom get` (semantic) adds up to 500 characters of an element's text when it is longer than the one-line preview, and `dom layout` says that `scrollBy` centres the element (`scroll down 500px to centre it`) (#332)
- **Release workflow** - npm releases are published by GitHub Actions with npm Trusted Publishing (OIDC, with provenance) when a GitHub release is published, instead of bumping the version in the workflow with an npm token; no token or one-time password is needed. See `docs/RELEASE_PROCESS.md`

### Fixed

- **Round 3 bugs: a11y indices, scroll advice, loading pages, index sources** - Indices from `dom a11y query` work with `click`, `fill`, `hover`, `pressKey`, `scroll`, `submit`, `layout` and `get`, also for an element of a cross-origin iframe of the same site such as the Guardian's consent dialog (its scripts run in that iframe, mouse events land on it through the iframe's position and scale (border, padding, `transform`, `zoom`; a rotated iframe or one that cannot be measured exits 83 instead of clicking elsewhere), and `layout` places it in the top-level page), instead of failing with `Element not found: __bdg_bound_target__`; the internal name no longer shows in any error, an index whose element is gone exits 87 naming the index (no `querySelector("a11y …")` hint), a11y matches are listed once per element and the first 50 by default in human output (`--limit <n>`, `0` for all; `... and 213 more`; `--json` returns all unless `--limit` is given, then with `omitted`; all stay indexed). A numeric index names the list it refers to: `Element: h3 "Welcome" (index 0 of the last dom query "h3")` (`data.indexSource`), stale and out-of-range errors name it and the command that refreshes it, and `fill`/`submit` on an element from `dom query` or `dom a11y query` they cannot act on add `index 0 refers to the last dom query results ("h3": h3 "Welcome"); run bdg dom form to target form fields by index` (one cache still holds the last list: the output now always says which it is). `dom layout` advises the smallest scroll for a partly visible element (`partly visible (87%); scroll up 5px to see all of it` instead of the 481px that centred it; `scrollBy` in JSON is that scroll, and still centres an element out of view), and none for fixed ones. `dom form` on a page without a body yet (a script in its head still loading) says `No forms discovered on the page yet; it is still loading` with the `dom wait --load` hint (88) instead of exit 110 `Form discovery failed: Uncaught`, and a script error names the exception (83 with the hint while the page loads). A `dom scroll` that moved nothing warns why: `Nothing to scroll: the document is no taller than the viewport (993px)`, `the page is already at the bottom`, or locked scrolling, plus the still-loading hint. A `dom submit` timeout names its page request (`waiting for navigation: POST …/authenticate pending for 30s`, `returned 503 Service Unavailable`, `failed (…)`) or the requests still running. `dom get` takes `--index` like the other commands (`--nth` stays as an alias), also in semantic output, reads the body without a selector, and says what an element without text holds (`No text; holds 1 element: iframe (see its HTML with --raw)`) instead of a bare `[Generic] <body>`. `console --last 3` lists the last 3 messages instead of the summary, and a list whose indices skip messages says why (`not listed in between: 1 message from another page load (-H lists all)`) (#344)
- **Retest bugs: blank screenshot, wrong status, quote-damage false positive, select names** - `dom screenshot --no-full-page` (and the viewport capture of too-tall pages and of `--scroll`) captures the part of the page scrolled to instead of a blank image. `page navigate`/`reload`/`back`/`forward` report the status of the navigated document, not of one its script loaded next: a 404 page whose script loads the app (single-page apps on static hosts) now shows `Status: 404` with `The page responded with HTTP 404, then loaded …/?/checkout-step-two.html (HTTP 200)`. `dom eval`'s shell quote-damage hint only fires for `x is not defined` or `Unexpected identifier` about a bare argument of a DOM method taking a string (`querySelector(input)`), never for `Math.round(x)` or a redeclared name; `Identifier 'x' has already been declared` (a name the page itself declares at the top level) now suggests renaming or wrapping the script in a block. Action output names a `<select>` by its label, aria-label or name (else its selected option), and an ancestor's text leaves out the options of selects in it, instead of `"Name (A to Z)Name (A to Z)Name (Z to A)P…"` (#338)
- **`dom submit --wait-navigation` after a POST that redirects back** - A submit whose new page loaded but whose requests (a slow script, a tracker) were still running at `--timeout` succeeds with a warning (`The new page loaded, but 1 request still had not finished after 10000ms`) instead of exiting 102, and a navigation is any new main-frame document, also at the form's own URL (the-internet's login with a wrong password). Without a navigation it still exits 102, and the hint no longer blames fetch when a page request was sent (`The page request (POST https://…/authenticate) had not loaded a page yet; retry with a larger --timeout`). The `Navigation: yes` row gave way to the `Page:` row; `Navigation: no` stays. When `dom fill` finds a different value in the field and another field of the form changed to the given value during the fill (at least 2 characters), the warning says where it went: `the value appeared in input#first-name instead` (`valueMismatch.movedTo`; saucedemo problem_user's checkout puts the last name into the first name) (#339)
- **Pages still loading reported as ready** - `bdg <url>` and `bdg page navigate`/`reload`/`back`/`forward` warn when the document has not finished loading within their wait (`The page is still loading (document.readyState: loading); waiting on: GET …/jquery-ui.js (pending 30s)`, up to 3 requests, load-blocking ones first) and add `loading: { readyState, pending, pendingCount }` to their JSON, still exiting 0. "Not found" errors of `dom query`/`get`/`layout`/`click`/`fill` and the other actions, `eval --frame` and an empty `dom frames` say the page is still loading and suggest `bdg dom wait` (one `document.readyState` check, on the failure path only) (#329)
- **Agent hints and layout labels** - In-flow content of a scroll-locked page (a consent or modal dialog sets `position: fixed` / `overflow: hidden` on body or html) is no longer `off-screen: fixed position`: `dom layout` says `below fold; page scrolling is locked (position: fixed, overflow: hidden on body)`, naming a visible dialog as the likely cause when there is one (`likely by dialog div#sp_message_container_1482251`). `dom scroll` reports the viewport without scrollbars and the scrolling element's page size, the numbers `dom layout` shows (it reported `1920x993` where layout said `1905×993`). `eval --frame` matches part of a frame's name or id as the help says, not only the whole of it. "Not found" errors of `dom click`/`fill`/`query`/`get`/`layout` point to `bdg dom frames` and `bdg dom eval --frame <n> 'document.querySelector("…")'` for elements in cross-origin iframes. Element screenshots include content overflowing the element (uncleared floats, positioned children) instead of cropping a container to its heading, and say so (`element.captured` in JSON); on a scrolled page they no longer capture an area offset by the scroll (`element.bounds` is in page coordinates). `dom query` shows the value and label of `<option>` elements (#332)
- **Selectors for agents: controls by row or label text, labels as their control, a11y names with colons** - A text or visibility filter on an earlier element of a selector now scopes the rest to it, so `li:has-text("Write report") .toggle`, `label:has-text("Customer name") input` and `tr:text-is("Ada") > td button` reach the control in the row or label holding the text, also inside open shadow roots (descendant and child combinators; `+`/`~` exit 81; matches in document order), and filters work inside `:has()` (`li:has(label:text-is("x"))`) and anywhere in a compound (`a:visible.active`). `dom fill`, `dom click` and `dom pressKey` on a `<label>` act on its control (`label.control`, reported as `input (via label)`); filling a label without one suggests `dom a11y query 'name=…'` or `dom form`. `dom a11y query 'name=E-mail address:'` takes the rest of the argument as the name (spaces and colons) instead of failing with `Unknown query field: "address"` or silently dropping words (a misspelled field inside a name, `name=Save rol:button`, exits 81 with a "did you mean"), and suggestions show shell-safe quoting. `:has-text`/`:text-is` use the `textContent` of hidden elements, so `visibility: hidden` and `display: none` behave alike (leave hidden ones out with `:visible`; a `:visible` selector matching nothing says how many elements match without it), button inputs match by value, `:has-text()` with empty text exits 81, and an empty selector in a list no longer leaks the rewritten CSS in the error (#324)
- **DOM actions wait for the requests their handlers start** - `dom click`/`hover`/`fill`/`pressKey`/`scroll` now track requests from before the action, so `onclick = () => fetch(...)` is waited for (150 ms idle, up to 2 s) and reported with its status instead of `pending`. A click that starts a navigation to a slow page returns after 2 s with the page request pending instead of blocking until the server answers. The triggered-request list now includes WebSocket connections (`GET ws://… → 101`), shows responses whose body is still streaming as `200 (loading)` (`loading: true`), is titled `Requests during the action:` (attribution is by time, so a poller's requests show up too), and points to `bdg network list` when JSON left requests out too (#315)
- **`dom layout` visibility and scroll advice** - Content in a closed `<details>` or under `content-visibility: hidden` is `hidden` (with the reason) and no longer matches `:visible`. `scrollBy` centres the element (like `dom scroll <selector>`, so sticky headers and fixed footers do not cover it) and is limited to how far the page can scroll; fixed elements (off-canvas menus; not those inside a transformed container, which scroll with the page) and elements beyond the scroll range (`left: -9999px` skip links) get `offScreenReason` instead, and a `<body>` that scrolls on its own is reported as `clippedBy: body`. An empty selector exits 81 in `dom layout`, `click` and the other selector commands instead of failing with a script error (#316)
- **Clicks silently lost after a login** - Chrome launched by bdg no longer runs the password manager or its leak check, whose bubble (e.g. "Change your password" after logging in with a breached password) captured all input in headless Chrome: later clicks and key presses reported success but never reached the page. bdg's Chrome preferences are now merged into the `Default/Preferences` of the profiles bdg manages (`~/.bdg/chrome-profile`, named sessions) as nested settings before every launch, so existing ones get them too; before, they were written as dotted top-level keys that Chrome ignored. A profile given with `-u`/`--user-data-dir` and attached Chromes (`--chrome-ws-url`) are not changed; with `-u`, turn the password manager and leak check off yourself if clicks stop reaching the page after a login. A mouse click whose press the page never saw now carries a warning ("The click may not have reached the element ...") (#313)
- **Sessions sharing a Chrome** - Named sessions started at the same time from different `BDG_SESSION_DIR`s could get the same port (one Chrome on 127.0.0.1, the other falling back to [::1]) and both drive the first Chrome, so stopping one ended the other. Port claims and the selection lock are now shared by all sessions of the user (under the OS temp directory), the free-port check also probes `::1`, and after launch bdg checks that the browser answering on the port is the Chrome it started (from the endpoint Chrome prints on startup); an automatically chosen port taken by another process is replaced, an explicit `--port` fails with exit 100. Restarting a session whose daemon crashed reaps its orphaned Chrome before choosing the port, so the session keeps its port (#314)
- **Named sessions and attaching: hints, names, crashed sessions** - Hints, suggestions and errors of a named session carry `--session <name>` (status and peek hints, "already running" (84), `No active session "<name>"`, stale browser id, timeouts), and a busy port no longer suggests `bdg cleanup --force`, which acted on the default session. Session names are case-insensitive (lower-cased, so `ALPHA` is `alpha` everywhere) and must start with a letter or digit, so `--session --json` no longer creates a session named `--json`. `--chrome-ws-url` refuses (exit 90) a Chrome another running bdg session launched and a tab another session is attached to, instead of taking it over; `99999` prints a JSON envelope with `--json` (exit 80, port out of range, also for `0`), `localhost:` is invalid (80), and an HTTP server that is not DevTools is reported as such; `--headless`/`--no-headless` with it exit 81 like `--port` and `-u`. `bdg sessions` lists sessions whose daemon died as `crashed` (Chrome still running) or `stale` (files left) with their cleanup command; `bdg cleanup --session <name> --purge` deletes a named session's directory. A too-long default session directory exits 81 like a named session, and the error blames the directory when no name would fit. Status JSON reports `chromePid: null` for an attached Chrome (#321)
- **Frames and listeners: origins, frame churn, framework handlers** - `dom frames` reports the origin a frame's scripts really run with (from its execution context): srcdoc and about:blank frames inherit their parent's origin (same-origin) instead of `"://"` and cross-origin, data: URLs and sandboxed frames without `allow-same-origin` are opaque (`origin: "null"`, `crossOrigin: true`). Nested frames are indented below their parent (`parentIndex` in JSON), long URLs are shortened in human output and empty ones shown as `(no URL)`. Frames removed while the page is listed are skipped instead of failing with exit 101; a frame that vanishes before `eval --frame` runs, or navigates or is removed while the script runs, exits 83 ("The frame navigated while the script ran" / "The frame was removed before the script finished") instead of a raw CDP error (101, or 81 with a `bdg cdp` hint), and so does a page that navigates during `dom eval` ("The page navigated while the script ran", or "was closed" when the tab is gone). A busy out-of-process frame is recovered through the session's own connection, and a 102 for scripts that could not be stopped no longer says the frame is usable again. `eval --frame` prints its `Frame:` line on stderr (hidden by `-q`), so stdout pipes into `jq`. `await new Promise(() => {})` now reports that the awaited promise did not settle within 20s instead of "the page was busy", and a busy iframe is called a frame. `dom listeners` collapses React root containers (recognised by React's keys or dispatcher names; dispatchers matched by function identity, so other multi-type handlers stay listed) into one line per root (`collapsed` in JSON; `--all` lists them), marks empty handlers such as React's `onclick` placeholder `[no-op]` so the delegation note still names `click`, and shows the jQuery handlers behind jQuery's dispatcher with their name, source and delegate selector (only delegates the element matches, at most 50 per call; a throwing `jQuery` global only loses these details). The heading names the cached index and the iframe holding the element, `--type` can be repeated and suggests close types (`Click`, `onclick` → `click`), and the hints mention that `<object>`/`<embed>` documents are not searched (#323)
- **False success signals in `fill`, `form` and `click`** - `dom fill` reads the value back and, when the page rejected or moved it (saucedemo's problem_user writes the last name into the first name), warns first: `The field's value is "" after filling (expected "Lovelace"); the page may have rejected or moved the input`, with `valueMismatch: { expected, actual }` in JSON (password values masked; still exit 0, since pages also reformat values legitimately). `dom form` counts a radio or checkbox group once (filled when any option is checked), treats labels marked with `*` as required, says `READY to submit` only when every required field is filled and at least one field is (otherwise e.g. `2 required fields empty: Last Name, Zip` or `NOT ready (no fields filled)`; with no field marked required it names the empty ones), and marks only the submitting button `(primary)`, never Cancel, Reset or Back. `fill`, `click`, `hover`, `pressKey`, `scroll` and `submit` name the element they hit (`Element: input.toggle in div.view "Write report"`, `data.element`), also for an index or one of several matches. An action with warnings (covered element clicked with DOM events, click not received, value mismatch) starts with `⚠ Element Clicked (with warnings)` and the warning instead of `✓`, above the request list. The request list shows documents, XHR/fetch and WebSockets (and failed assets) first and sums up static assets in one line (`+ 97 assets (css, js, fonts, images)`; all still in JSON, with `resourceType`), its title gives the total (`Requests during the action (18):`), and `dom submit`'s `Network Requests` count now comes from the same list instead of a separate CDP counter with its own rules (it counted `data:` URLs and CORS preflights, a redirect chain once, and stopped at the end of the wait), so the line, the list and JSON agree. JSON changes: `summary.readyToSubmit` is `false` for an untouched form, form field counts count a choice group once (`emptyFieldLabels` is new), and `dom submit`'s `networkRequests` is the number of reportable requests (as listed, plus `triggeredRequestsOmitted`). The value read-back runs separately after the fill (at most 1 s), so a `<select>` whose change handler navigates still fills successfully; it compares values as the browser normalises them (color case, numbers, email, line endings, times), reports a maxlength cut (`The value was cut to 10 characters by maxlength`) and passwords only by length. Non-GET requests (beacons), pings and CSP reports are listed, not summed up as assets; the primary-button heuristic prefers an explicit submit button, then the styled or last untyped one, and knows German, French, Spanish, Italian and Polish cancel/back words; only a standalone `*` marks a label required (#330)
- **`dom layout` accuracy** - Scroll lists inside CSS `zoom` (also on `<body>`) or `transform: scale()` are clipped where they show instead of at their unscaled size. An ancestor painted over the element, such as a card's `::after` overlay, is reported as `coveredBy` (as `dom click` already did), and an overlay scrollbar that appears after a scroll (macOS, mobile) no longer hides a cover near the viewport's bottom or right edge. Content of a collapsed `height: 0; overflow: hidden` accordion is `hidden (clipped by div#acc: zero height)` instead of `out of view … (below)`. The new `invisible` field (`opacity: 0 on div#menu`, `clip-path: inset(100%) on div#cp`) flags elements made invisible by an ancestor's opacity or a clip, and human output prints no coordinates for hidden elements and doesn't repeat the iframe that clips an element. When JSON is capped too, the human note says `(--json lists the first 100)`, and `--index` given with an index argument suggests the command that was run (`bdg dom layout 0`), not `dom click` (#322)

## [0.8.0] - 2026-10-04

Thanks to @sfc-gh-mochen, @sfc-gh-adsaxena and @StealthEyeLLC, whose pull requests (#169, #199, #200, #252) led to the text selectors, `bdg eval`, `dom eval --frame`, readable binary WebSocket messages and `bdg dom listeners` in this release.

### Added

- **`bdg page navigate <url>` / `reload` / `back` / `forward`** - Move the session's page and wait for it to load (`--no-wait` to return at once); unreachable URLs exit 80, no history entry exits 81
- **`bdg dom hover`, `dom click --double` / `--right`** - Hover (menus, tooltips), double-click and right-click with real mouse events, falling back to DOM events like `click`
- **`bdg dom listeners <selector|index>`** - Lists the event listeners that run for an element: on the element, its ancestors (through open shadow roots), its document and window, grouped by event type and nearest first, with each handler's name, source preview and script location. Delegated handlers (React, jQuery) show up on the ancestor they are attached to, with a note when an interaction event is handled only there; `--type click,keydown` filters, `--index` and cached query indices work like `dom click` (idea from #252 by @StealthEyeLLC)
- **`dom fill` on `<select multiple>`** - Comma-separated values or labels select several options (`""` selects none)
- **Text and visibility selectors** - `:has-text()`, `:text-is()` and `:visible` at the end of a selector in every DOM command (idea from #169 by @sfc-gh-mochen)
- **`dom eval --frame`** - evaluate in a specific iframe, including cross-origin ones (idea from #200 by @sfc-gh-mochen)
- **`bdg dom frames`** - List the page's iframes (index, URL, name/id, origin, cross-origin / out-of-process) for `dom eval --frame`

### Changed

- **BREAKING: one JSON envelope everywhere** - Every `--json` output is a single `{ version, success, data }` / `{ version, success: false, error, exitCode }` envelope
  - `peek --json`: data is now `.data.network` / `.data.console` (was `.data.data.network`); `--network`/`--console`/`--last` filters now apply in JSON mode
  - `network list --json`: `data.requests` is the filtered list honoring `--last`, plus `totalCount` and `filteredCount` (the unfiltered `requests` and duplicate `filtered` fields are gone)
  - `console --json` and `status --json` no longer nest `success` / `version` inside `data`
  - Follow modes (`-f --json`) print one envelope per refresh and no longer emit terminal clear codes; `console -f --json` now honors `--json`
  - `dom fill/click/submit/pressKey/scroll --json`: the redundant `success` flag is no longer repeated inside `data`
  - `--version --json` prints `{ data: { version } }`; `--json` may also be given before the subcommand (`bdg --json peek`)
- **BREAKING: Daemon is the session** - The separate worker process is gone; the daemon hosts the Chrome/CDP session in-process and exits when the session ends (#253)
  - Only `bdg <url>` starts a daemon; other commands without a session exit 83 ("No active session") instead of spawning an idle daemon (`bdg status` still reports `active: false`, exit 0)
  - `bdg stop --kill-chrome` is kept for compatibility but has no additional effect: Chrome launched by bdg is always closed on stop
  - Liveness is decided by the daemon socket, not PID files; `session.pid`, `session.lock` and `daemon.lock` are no longer used
  - Single-instance is enforced atomically (socket claimed via `link()`), so concurrent `bdg <url>` runs can no longer spawn two daemons
  - Daemon SIGTERM/SIGINT and a stop during startup now always tear down Chrome
  - `bdg cleanup --aggressive` is an alias for `--force`; `--force` kills a stuck daemon and its Chrome
- **BREAKING: Node.js 22.12+ required** - Node 20 reached end-of-life in April 2026; `commander` 15 and current tooling require Node 22. CI, release workflow and Docker images now use Node 22
- **`status --json`** - The internal `domVersion` counter is no longer reported (query caches no longer depend on it)
- **Node versions** - CI runs unit/contract and smoke tests on Node 22, 24 and 26 (build and lint stay on 22, the minimum); Docker images use `node:24-alpine`; `@types/node` matches the minimum supported Node (22) so APIs missing there fail type-checking instead of at runtime. Dependabot no longer proposes major bumps of `@types/node` or TypeScript (typescript-eslint does not support TypeScript 7 yet)
- **Session IPC commands renamed** - `worker_peek`/`worker_details`/`worker_status`/`worker_har_data`/`worker_network_headers` are now `session_*`, and the start response field `workerPid` is `daemonPid` (there is no worker process since #253). Stop a running session before upgrading: an older daemon does not understand the new names
- **Exit code 106 renamed** - `WORKER_START_FAILURE` is now `SESSION_START_FAILURE` in `bdg --help --json` (same code, Chrome launch or CDP connection failed)
- **Release workflow** - Prereleases are published to the `next` npm dist-tag instead of `latest`; GitHub releases are created with `gh release create` (auto-generated notes) instead of the archived `actions/create-release`; explicit `contents: write` permission; releases only from `main`
- **CI** - GitHub Actions bumped to their Node 24 majors (checkout, setup-node, cache, artifacts, paths-filter, setup-chrome, CodeQL); Dependabot now also updates GitHub Actions
- **`bdg <url> --json`** - Session start reports its result (or "already running" / target mismatch with `existingSession`) as a JSON envelope

### Performance

- **Faster CLI start** - `dist/index.js` and `dist/daemon.js` are bundled into one file each (esbuild); `node:http` and the CDP protocol schema are loaded only by the commands that need them. A `bdg` command starts in about 48 ms instead of 100 ms (Node 22)
- **Faster sessions** - Page readiness waits for network and DOM quiet at the same time (not one after the other), and Chrome's start and exit are checked every 50 ms instead of every 500 ms: on a simple page `bdg <url>` takes about 1.0 s instead of 1.3 s, `page navigate` 0.43 s instead of 0.65 s, `bdg stop` 0.15 s instead of 0.62 s

### Removed

- **BREAKING: `bdg peek --dom` / `-d`** - It never showed data (DOM was only captured into `session.json`, which nothing writes since #253). Use `bdg dom a11y tree` or `bdg dom query` for page structure
- **Vestigial session-output code** - `TelemetryStore.domData`/`buildOutput`, `OutputBuilder.build`/`buildError`, the `DOMData` type and the deprecated `getEnvChromeFlags` (unused; `BDG_CHROME_FLAGS` is parsed by the start command)

### Fixed

- **Third deep test: session lifecycle**
  - A Chrome left by a killed daemon no longer makes the next start fail with "port in use": it is killed and waited for before the port is checked
  - A port held by a listener on all interfaces (`nc -l`, `0.0.0.0`) is reported as in use at once (it ended after 5.5 s as "Chrome failed to launch")
  - `--remote-debugging-port`/`-pipe` in `--chrome-flags` or `BDG_CHROME_FLAGS` is refused with 81 (it waited 30 s); `--chrome-flags --json` (a bdg option swallowed as the value) is refused too
  - `status` explains why there is no session: "The last session ended at …: Chrome crashed / its page was closed / the --timeout was reached" (`lastSession` in JSON); while a session shuts down it says so instead of reporting its Chrome as orphaned
  - `status` shows when `--timeout` stops the session (`autoStopAt`)
  - A command interrupted by the session ending says so (83) instead of "WebSocket connection closed" (101) or "Connection closed before … response" (110)
  - Frozen daemon: `network har` answers in 10 s (it waited 45 s) and `--json` errors never show internal request names
  - SIGTERM during `bdg <url>` prints "Start cancelled (terminated)" (also as JSON) and exits 143, now listed as `TERMINATED`
  - A daemon whose start request never came (Ctrl-C right after launching it) exits after 3 s instead of 10
  - `network har -` writes the HAR to stdout (it created a file named `-`)
  - `cleanup` with a session directory that is a file reports that (103) instead of "now clean"
  - Start error suggestions no longer begin with an empty line
- **Third deep test: high findings**
  - Service workers run in a bdg session: they were paused by auto-attach and never resumed (the page's `register()` never settled); a child whose setup does not answer is now resumed after 1 s
  - `network har` on large sessions: the IPC reader re-split the whole buffered response on every chunk (quadratic; 770 requests timed out after 45 s), now linear; single responses may be up to 256 MB
  - A page kept busy by a script started from a timer is recovered by every command, not just `dom eval`: `dom get/query/screenshot/form/a11y` and raw `cdp` terminate the page's scripts when the page stops answering for 25 s and exit 102 (a page that answers but is slow, e.g. a huge screenshot, is waited for) ("the page is usable again") instead of hanging 30–90 s with 101/110
  - `page back/forward` within a document (hash, pushState) and `page navigate` to a `#fragment` return at once (they waited 15 s for a load that never comes)
- **Third deep test: telemetry**
  - `console -f` and `network list -f` stream: each new message (or finished request) is printed once, nothing is lost in bursts, the output is not redrawn (so pipes get no repeats), `--last` sets how many to show at start, and a separator marks a page change
  - Request durations (TIME column, `details` Duration) come from Chrome's timestamps: fast requests showed about 50 ms too much; requests cancelled by a navigation end when the page navigated (the 5 s grace was added)
  - Text with a lone UTF-16 surrogate (a page logging half an emoji) no longer makes `--json` output invalid for jq: it shows U+FFFD
  - Requests blocked by CSP and similar show the reason (`(blocked:csp)`) in `details` and the HAR
  - `--type WS`, `DOC`, `FET` and `resource-type:` accept the abbreviations `network list` shows; `mime-type:image/*` works
  - `console.assert` failures count as errors
  - 204/304 responses no longer show "Error: net::ERR_ABORTED" in `peek -v`
  - `details network ""` exits 81; HAR path errors suggest a `.har` name; `--preset` help lists the presets; the `duration:` filter is in the reference
- **Third deep test: DOM and page**
  - `page navigate/reload/back/forward` report the document's HTTP status and warn on 4xx/5xx, on a URL that is a download, and on a server that has not answered within 15 s (instead of 110 after 30 s); `--no-wait` returns at once; `page back` from the first page exits 81 instead of landing on about:blank; `page navigate javascript:…` points to `dom eval`
  - A command run while a navigation waits for the server says so (exit 102) instead of claiming a script kept the page busy and terminating its scripts
  - `dom fill` warns when the field is hidden, inert or behind a modal dialog; `dom submit` refuses a form whose submit button is disabled (81); `dom hover` works on disabled elements (tooltips)
  - `dom click/hover/pressKey/scroll` warn when the selector matched several elements, like `fill` did
  - a11y queries leave out text nodes (each button was found three times, and acting on a text node failed); "Next steps" suggest fill or click by the first result's role
  - `dom screenshot --follow`: `--limit 1` captures one frame, and an element that disappears ends the sequence with its error; element screenshots report the element's bounds in JSON
  - `dom get --nth/--all` without `--raw` exits 81 (they were ignored); `cdp Page.close` is blocked (use `bdg stop`); a filtered `network list` header reads "21 matching, 240 in all"
- **Ideas from earlier pull requests**
  - `bdg eval <script>` is a shortcut for `bdg dom eval` (idea from #200 by @sfc-gh-mochen); `bdg query x`, `bdg click …` and other group commands typed without their group suggest the full command (`bdg dom query`) instead of failing as a start URL
  - `details network <id>` shows the text of binary WebSocket messages that are UTF-8 (`(binary, 13 bytes) {"op":"ping"}`) (idea from #199 by @sfc-gh-adsaxena)
  - Playwright-only selectors (`:has-text()`, `:text()`, `:visible`) get a bdg way to do the same in the error (idea from #169 by @sfc-gh-mochen)
  - Leftovers of the 0.7.2 test reports (#227, #228): `peek` shows an empty CONSOLE section again; `console --level <level>` lists the matching messages (it showed the error/warning summary, hiding e.g. `--level info`); `dom form --brief` shows each field's value; `details console <n>` with no messages says so (it said "available: 0--1")
- **Third deep test: leftovers**
  - `-q` hides tips and "Next steps"/"Suggestions" blocks in every command's human output (`dom query/form/submit`, `dom a11y`, `status`, `peek`), not just at start
  - Element previews (`dom query`, `dom get`) show the text as rendered: hidden parts are left out and no spaces are added at tag boundaries ("Marylebone, London", not "Marylebone , London")
  - `dom eval`: `undefined` inside arrays and objects is `null` (it was the string "undefined")
  - `dom query` with no match exits 83, like `dom get` and `dom a11y`; human output lists the first 50 matches (`--json` has all)
- **Smaller fixes**
  - `cdp`: an unknown domain gets a did-you-mean (`Netwrk` → `Network`); `bdg cdp Network --search cookie` searches that domain only; blocked methods (`Page.captureScreenshot`, `Browser.close`) show their bdg alternative as the example in `--describe`/`--search`
  - `dom a11y tree` (human) is indented by depth and leaves out text boxes, blank text, text repeating its parent and nameless layout wrappers, so the 50 lines show the page's structure
  - `dom get` and `a11y` one-line output show a field's value and checked/expanded state
  - A Chrome that opens no page at start says so plainly (the message suggested `pkill`)
  - `dom form`: a long label keeps its required `*`; an `aria-invalid` field shows its `aria-describedby`/`aria-errormessage` text instead of "Field is invalid"
- **Interaction commands**
  - A numeric index together with `--index` (`dom click 1 --index 3`) exits 81 instead of ignoring `--index`
  - `dom scroll` refuses conflicting options with 81: `--top` with `--bottom`, two vertical directions, or a selector with an offset/edge (they were silently resolved)
  - `fill` on a selector matching several elements warns and reports `matchCount`
  - `pressKey` accepts Esc, Return, Del, Up/Down/Left/Right, PgUp/PgDn and shifted digit symbols (`!`, `@`, …); an unknown key exits 81 with a did-you-mean instead of a selector hint
  - Clicking an `<option>` exits 81 with the `dom fill` command that selects it (it reported "display: none" and changed nothing)
  - Out-of-range integers say so (`--times 0`: "0 is out of range") instead of "Expected an integer"
  - "Not found" errors of `fill`/`click`/`pressKey`/`submit` say that closed shadow roots and cross-origin iframes cannot be reached
  - `dom query` shows `id`, `name` and `type` of each match, and the iframe or shadow root it is in (also in JSON as `context`)
  - `pressKey --json` reports `modifiers` as names (`["Ctrl"]`) instead of a bit mask; click results no longer carry the misleading `clickable` flag
- **Session lifecycle**
  - A frozen daemon is detected in 10 s by every command, including `stop`, `bdg <url>`, `dom *` and `cdp` (they waited 45 s and some exited 110): a quick handshake runs before requests that may take long, and all IPC timeouts exit 102 with a message that names no internal request
  - `status` while `bdg <url>` is still starting says so (`starting` in JSON) instead of "no session"; other commands meanwhile exit 85 "The session is still starting"
  - `status` without a session mentions a Chrome left running by an earlier session (`orphanedChromePid`), and `bdg cleanup` closes it
  - `status --verbose` shows the session's Chrome executable, mode and profile (also in `--json`) in about 0.1 s, instead of scanning installations for 5-7 s
  - Closing the page's tab (e.g. `cdp Target.closeTarget`) ends the session normally instead of as a crash, and `status` no longer exits 110 while the session is ending
  - Ctrl-C during `bdg <url>` prints "Start cancelled (interrupted)" (a JSON envelope with `--json`) and exits 130, now listed as `INTERRUPTED`
  - The daemon shuts down cleanly on SIGHUP (it died and left Chrome running)
  - `bdg dom help query` exits 0
  - `-q` is accepted by every command and hides tips and hints
  - `stop` says "Closed Chrome" (it closes Chrome gracefully); `cleanup` reports removing stale PID files
  - Headless Chrome sends the regular Chrome user agent (sites served "HeadlessChrome" a different page)
  - More ad, measurement and A/B-testing domains are left out of network capture by default (ad exchanges, comScore, Nielsen, Chartbeat, Permutive, Optimizely, Adobe, AT Internet); `--all` records them
- **Reading the page: a11y, forms, query, get, screenshot, cdp**
  - `dom a11y tree/query` and quick search include same-origin iframes (the tree stopped at the iframe); `a11y query` results are numbered and usable as indices (`bdg dom click 0`); "true"/"false" states are booleans
  - `a11y describe` on an element missing from the accessibility tree says why (not rendered, aria-hidden, `alt=""`, …) instead of "not found"/"re-run query"; the quick search keeps quotes (`bdg dom a11y 'Say "hi"'`)
  - `dom form` with the form inside a same-origin iframe exits 89 with how to reach its fields (it said "No forms discovered", and the old hint named commands that do not exist); "Other forms on page" shows their real names and field counts; contenteditable fields no longer get a wrong "use click + type" hint
  - Text previews never split an emoji (JSON stayed invalid for jq), keep words of separate elements apart, decode entities and skip `<style>`/`<script>`
  - The `dom query` "Extract text" hint is copy-pastable (shell-quoted, field values, the shown match)
  - `dom get --raw --all` numbers results from 0; conflicting options exit 81: `dom get <selector> --node-id`, `--all --nth`, `dom screenshot --selector … --index`, `--quality` for a PNG
  - `cdp Browser.close` is refused with `bdg stop` as the alternative (it ended the session behind bdg's back)
- **`dom eval`**
  - A page kept busy by a loop started from a timer is recovered: the next eval terminates the page's scripts after 20 s and exits 102 ("the page is usable again") instead of every eval failing with 101 after 30 s; the eval that started it returns at once
  - A returned promise that never settles exits 102 after 20 s ("did not settle") instead of a generic timeout
  - Nested values keep what JSON would lose: `undefined`, NaN, ±Infinity and -0 as strings, DOM nodes as `tag#id.class`, node lists, typed arrays, maps and sets as arrays, dates as ISO strings, cycles as `[Circular]` (`[1,undefined,NaN]` gave `[1,null,null]`, `{el: document.body}` gave `{"el":{}}`)
  - `throw {code: 42}` shows the object; quoting tips are only given for syntax errors; an empty script exits 81
- **Session start**
  - Chrome exiting during startup is reported at once with what Chrome said (e.g. an unknown `--chrome-flags` value), exit 100, instead of after about 30 s as a refused connection with port advice; a profile already open in another Chrome says so
  - Session directory problems are reported before the daemon starts: a file (103), not writable (82), or a path too long for the daemon socket (103), each with a fix
  - `-u` without a path (`bdg <url> -u --json`) or pointing at a file exits 81 instead of creating a `--json` profile directory; `bdg ""` and `bdg --port 9333` without a URL give errors (also as JSON) instead of the help text
  - `javascript:` URLs are refused as a start page (80); a URL with spaces suggests `%20` instead of quoting
  - `--chrome-ws-url`: a URL without `/devtools/browser|page/<id>` is refused with a `curl …/json/version` hint for its own host; a stale browser id or unknown page id exits 83 naming the current one; an unreachable Chrome exits 101 (with a `wss:` hint); `--port`/`-u` with it exit 81
  - `--timeout` is documented as counted from page load, and the start output shows when the session will stop (`autoStopAt` in JSON); `-q` keeps the HTTP error warning
  - "Session already running" JSON: `existingSession.durationMs` (was `duration` in seconds), a `suggestion`, and no internal `errorCode`; an external Chrome reports `externalChrome: true` instead of `chromePid: 0`
  - Chrome no longer receives `--remote-debugging-port` and the default flags twice
  - `--headless` help says what the default depends on
- **Interactions**
  - Clicks no longer take 5 s each once the page has opened another tab, and fills before the first click fire focus/blur events: the page is kept focused (focus emulation)
  - Interactions run one at a time per session: concurrent `pressKey` commands no longer type into each other's field
  - `click --no-wait` on a link to a slow page returns right away (it waited for the next page to commit)
  - Fields inside a `<fieldset disabled>` are refused as disabled (81) by `fill`, `click` and `pressKey`
  - `fill` refuses values the browser would change (an invalid color, an out-of-range or off-step range value) with 81, and a refused value keeps the field's previous value instead of emptying it; a number outside min/max is filled with a warning
  - File inputs: a directory is refused (81), a file whose name contains commas can be uploaded, and `""` clears the input
  - `pressKey` into a field it focuses types at the end of the existing text (was the start)
  - `dom submit <form>` submits with the form's default button, so its `name=value` is sent like a real click; the output says whether a submit button was used (was always "Clicked: yes")
  - Click point: elements wider than the viewport are clicked in their visible part; if the centre is covered, other points of the element are tried; a covered element names what covers it, and `inert` elements are reported as inert instead of covered
  - Dialogs accepted during `fill`/`click`/`submit`/`pressKey` are listed in the result and in `bdg console`
  - The bound element of index-based commands (`window.__bdgTarget`) is removed from the page afterwards
- **Errors, output paths and no-session messages**
  - Screenshot and HAR paths: a missing directory is created; a directory, a file in the path, an empty path, a read-only or forbidden location give a clear "Cannot write <path>: <reason>" (81 for a bad path, 82 for permissions) instead of "No active session" or a raw error. `screenshot --follow` into an existing file gives 81
  - Without a session, every command says "No active session" (83) with the same suggestion, including `dom get <selector>`, `dom get 0`, `a11y describe` and `a11y tree` (which printed raw IPC text or "No cached query results")
  - Stale indices name the index you gave ("The element at index 0 is no longer in the page") instead of an internal node id
  - Invalid selectors exit 81 in `dom get` and `a11y describe` too; `scroll --index` out of range exits 81 like the other commands; hidden (`display: none`) and zero-size screenshot targets both exit 81 with a message saying why
  - `cdp`: Chrome rejecting a method or its parameters exits 81 with a `--describe` hint (was 110); `--params` parse errors read "Invalid --params JSON: …"
  - `bdg help <unknown>` exits 81 with a did-you-mean instead of showing the general help; with `--json`, Commander's "Did you mean …?" goes into `suggestion` instead of a second line of `error`
- **Network and console display**
  - `network list`: long query strings keep their start (`?id=1&tok…`) instead of collapsing to `?…`, `www.` is no longer dropped, the header always reads "last N of M", and the Ping type is `PIN` (it read like `PNG`)
  - Filters: `status-code:=500` works as documented, unknown `resource-type:` values are rejected with a did-you-mean, new `duration:` filter (`duration:>1s`, `500ms`) and `slow` preset; `console --level` takes any case and `log`/`warn`; `--last` accepts 0 (all) to 10000 everywhere, and its errors no longer repeat the range or the default
  - `peek`: `--network --console` shows both sections (it showed none), pending requests are `PND` (not "OK pending"), a response whose body Chrome merely stopped reading (`net::ERR_ABORTED`) shows its status, and "Updated" is the time of the refresh
  - `details network` shows start time, duration, size and cache use; long bodies are cut in human output (the JSON has all of it); a body that was not captured is reported as `bodyNotCaptured` with the reason instead of a placeholder string; CORS failures name the CORS reason
  - `details console` shows the stack; console lists align their columns, browser messages point at the resource URL instead of a fake `file:1:1`, `--history` separators no longer call every navigation a reload, warnings show their location, and `console --json` errors carry their `index`
  - Console text: DOM nodes, WeakMap/WeakSet and typed arrays are described instead of `{}`, nested arrays are expanded, and top-level strings are never quoted
  - Follow modes started without a session exit with 83 instead of retrying forever; a lost session is reported once, not every second
  - `getCookies` numbers cookies from 0 and says when SameSite is not set; `--url` is validated; `network har --json` reports the absolute file path; HAR body sizes use Content-Length when the body was not captured
  - Bidirectional override characters (e.g. U+202E) in page text are escaped like other control characters
- **Network data correctness**
  - Requests in flight for more than 60 s were silently dropped (from `network list`, `peek` and HAR, even after they finished); long polls, SSE and slow APIs now stay listed until they finish
  - Requests of a page that navigated away are recorded as cancelled (`net::ERR_ABORTED (the page navigated away)`) instead of staying "pending"; its WebSocket connections are marked closed
  - Network traffic of workers and cross-origin iframes is captured (their documents and fetches used to be missing or stuck as pending); attached iframes and workers are paused until bdg has set them up, so nothing they load is missed
  - `Set-Cookie` of a redirect hop is kept when Chrome reports it late (it was lost in about a third of redirects)
  - HAR timings of responses served from the browser cache use their real duration (the original request's timing made them look tens of seconds long)
  - The main document request belongs to the page it loads (it carried the previous page's navigation id)
  - `status` and `peek` follow same-document navigations (`history.pushState`, hash changes) and the title that comes with them
  - `bdg <url>` right after `bdg stop` no longer fails with "No active session" when it reaches the old daemon just as it exits; it waits and starts
- **`network har` on large sessions** - HAR data was fetched with the 10 s timeout meant for quick status queries, so exporting a session with hundreds of requests and bodies failed with "The session did not respond within 10s"; it uses the normal request timeout again
- **CLI consistency and session robustness**
  - `bdg --json` on its own prints the machine-readable help; `cdp … --json` and `dom a11y <search> --json` are accepted (the a11y quick search could not output JSON at all); `dom a11y` without arguments is a usage error (81) like other command groups
  - `dom eval` runs like the DevTools console: top-level `const`/`let` can be declared again in a later call and top-level `await` works (returned promises are still awaited)
  - A selector that matches nothing in `dom a11y describe` returns a one-line `error` and the advice in `suggestion` (the JSON `error` held a multi-line "Error: …" text)
  - A frozen or unresponsive session is reported after 10 s (exit 102, with a way out) instead of 45 s per command
  - `bdg <url>` right after `bdg stop` waits for the old session to end and starts (it failed with 84 or a bogus "different Chrome target" 90); a start cancelled by `bdg stop` exits 90 with a clear message instead of 106 (software failure); the "already running" message no longer names an internal request
  - `cleanup --aggressive` works as the documented `--force` alias; `daemon.log` is rotated above 5 MB; `--compact` (no effect) is hidden
  - Docs and hints: `cdp --help` shows the real domain/method counts, `--nth` is described as 0-based, the HAR example exports before `stop`, hints suggest `network list` instead of the deprecated `peek --network`, copy-pastable `dom eval` hints, and a new "Default Behaviors" section (filtered tracking domains, skipped bodies, hidden `console.group`, auto-accepted dialogs, single-tab sessions, `--timeout`, `port.txt`)
- **Network list and a11y tree** - `network list` shows a TIME column (`duration` in ms in `--json` and `peek --json`), keeps ports and query strings in URLs (a long query is elided before the path), and shows `data:`/`blob:` URLs as they are instead of mangling them (`/ext/plain,hello`). `dom a11y tree --json` no longer lists children that are not in the tree: ignored nodes are replaced by their children, as in DevTools, and nodes are in document order
- **Screenshot formats and editing shortcuts** - `dom screenshot` takes the format from the file extension (`.jpg`/`.jpeg` → JPEG), accepts `--format` in any case and `jpg`, and refuses a `--format` that contradicts the extension or an extension Chrome cannot write (`.gif`, `.webp`, …) with exit 81, instead of writing JPEG bytes to a `.png` file or failing with 101; `--follow --json` prints one envelope per frame. `dom pressKey` with Ctrl or Cmd now performs select all, copy, cut, paste, undo and (with Shift+Z) redo like a keyboard does (Ctrl+A did nothing)
- **Shadow DOM and iframe targeting** - Selectors only searched the top document, so elements inside web components (open shadow roots) and same-origin iframes could not be queried, read or used. All DOM commands (`query`, `get`, `fill`, `click`, `pressKey`, `scroll`, `submit`, `a11y describe`, `screenshot --selector/--scroll`) now search open shadow roots and same-origin iframes too, document matches first. Clicks land on the element (hit-testing in its shadow root or frame, coordinates offset by enclosing frames), and `pressKey` checks focus there. When nothing matches, the hint says that cross-origin iframes and closed shadow roots are not searched
- **`--chrome-ws-url` with a browser URL** - The browser-level URL (`ws://host:port/devtools/browser/<id>`, from `/json/version`) failed with "'Page.enable' wasn't found"; bdg now attaches to the first open tab of that Chrome (opening one if there is none). The session reports the port of the URL instead of 9222, `status` shows the Chrome as external (`externalChrome: true` in `--json`, no `chromeAlive: false`), and an unreachable URL fails in about a second instead of 37
- **Ctrl-C during `bdg <url>`** - Interrupting the start left the session starting in the background and then active. The daemon now stops a session whose starting command disconnects, whether Chrome is still launching or the start has just finished; stopping during the start also ends bdg's connection retries to Chrome at once (they could keep the daemon alive for about 37 s)
- **Console misses no sources** - Messages from cross-origin iframes and workers (separate targets that never reached the page's session) are now captured, with objects expanded, and so are browser messages such as "Failed to load resource" (404/500), CORS and security errors and deprecations. Browser messages carry `source` (`network`, `security`, ...) in `--json`. `dom query` no longer prints "undefined" for elements without text
- **WebSocket connections are visible** - They were captured but no command showed them (and open ones were only stored when they closed). They now appear in `peek` and `network list` as `WS` entries (`--type WebSocket`); `details network <id>` shows the handshake headers and the sent/received messages; HAR exports include them with `_webSocketMessages` (the Chrome DevTools convention). Network items in `peek` are listed in start order
- **HAR fidelity** - Binary response bodies were base64-encoded twice (Chrome already returns them base64) and their size was the base64 length; they are now exported as-is with the decoded size, and `--all` also captures binary bodies (images, fonts; within `--max-body-size`), which were never fetched before. Status texts come from the server or a complete table (307 was "Unknown"), failed requests carry `_error` (e.g. `net::ERR_NAME_NOT_RESOLVED`), entries are in start order, `log.browser` names the Chrome version, skipped bodies keep their size, and default export file names no longer overwrite an export from the same second. `details network` summarizes binary bodies instead of printing base64, and skip reasons no longer mention internal pattern names
- **`dom form` field states** - Empty required fields were reported as "invalid" before anyone touched them (now "required"), read-only fields as "ok" with fill commands and counted as filled (now "read-only", no command, not counted, like disabled fields), unrelated alerts in the same section were reported as a field's error, and fieldset legends were used as the form name. Discovery no longer calls `checkValidity()`, which fired `invalid` events on the page. Forms with a text input are preferred as the default form over radio-only ones
- **File inputs** - `bdg dom fill <file-input> <path>` selects the file(s) (comma-separated; relative to the current directory) instead of failing with a CDP suggestion that did not work; `dom form` suggests it for file inputs instead of `click`
- **`dom eval` results** - Values JSON cannot represent came back as `undefined` (NaN, Infinity, -0, BigInt), `{}` (functions, DOM nodes, dates, maps, errors) or failed with exit 101 (Symbol, `window`). They are now returned as readable descriptions (`NaN`, `123n`, `button#submit`, `Map(1) {1 => "a"}`), plain objects and arrays as JSON, and `--json` includes the value's `type` and `subtype`. A script that throws exits with the new code 91 (`SCRIPT_ERROR`, a user error) instead of 110, and the error tip no longer mentions a nonexistent `--file` option
- **`dom eval` endless loops froze the page** - `while (true) {}` timed out after 30 s with exit 101 and every later eval hung too. Scripts are now terminated after 20 s (exit 102, "terminated") and the page stays usable
- **Invalid selectors in interactions** - `dom fill/click/pressKey/scroll/submit` with an invalid CSS selector exited 110 and printed the injected script; they now exit 81 with "Invalid CSS selector", like `dom query`
- **Help accuracy** - The start screen and agent help showed stale counts ("53 domains, 300+ methods", "39 methods" for Network) and wrong signatures (`screenshot [path]`, `headers <id>`), and pointed to a repository-only `.claude/skills` path; counts now come from the bundled protocol and signatures match the commands. `bdg --help --json` reported every option that takes a value as `required: true`; `required` now means the option must be given, and the new `takesValue` says whether it takes a value
- **Docs** - `--index` is documented as 0-based (it was "1-based" in places), the nonexistent `Audits.checkContrast` example and the missing `docs/TOKEN_EFFICIENCY.md` link are gone, `BDG_CHROME_FLAGS`, start failures (exit 80) and automatic dialog handling are documented
- **`dom a11y query` / quick search never matched** - The documented comma form (`role=button,name=Submit`) and names containing spaces (`name=Google Chrome` was read as `name:Google`) did not work, `*` wildcards were advertised but compared literally, so `bdg dom a11y <text>` (which searches `name:*text*`) always failed. Fields are now separated by spaces or commas, values run to the next field (or can be quoted), `*` is a wildcard (role matches exactly otherwise, name/description as substrings), quick search treats phrases as names, and unknown fields (`rol:button`) exit 81 instead of being ignored
- **Terminal escape injection** - Console messages, titles, URLs and other page-provided text were printed raw, so a page could retitle, clear or recolor the terminal with escape sequences. Human output now shows control characters as `\uXXXX` (JSON output was already escaped)
- **Console indices and "current page"** - `console --list` (current page, or with `--level`) numbered messages from 0 per view, while `details console <n>` uses the session-wide index, so the numbers pointed at different messages; listed indices are now the session-wide ones. The current page is the page actually loaded (the daemon's navigation id), not the newest page that logged something, so stale errors from a previous page no longer appear after navigating to a page that logs nothing; messages without a navigation id are no longer dropped. `details console abc` / `1.5` exit 81
- **Console format specifiers** - `console.log("%s has %d items", "cart", 3)` is shown as `cart has 3 items` (`%s %d %i %f %o %O` substituted, `%c` styles dropped) instead of the raw format string followed by the arguments
- **`bdg stop` lost recent browser state** - Chrome was killed with SIGKILL on its whole process group, so cookies and storage written in the last ~30 s never reached a `--user-data-dir`. bdg now closes Chrome through CDP (`Browser.close`, Chrome's normal shutdown, about a second) and only falls back to SIGTERM on the main process and then a kill
- **Follow modes crashed when the session ended** - `tail`, `peek -f`, `console -f` and `network list -f` died with an `IPCConnectionError` stack trace; they now report "No active session" and keep retrying as documented
- **Misleading advice** - `bdg status` no longer suggests the nonexistent `bdg query` / `bdg tabs` (the latter even started a session); port-in-use errors no longer recommend `lsof … | xargs kill -9` or describe `cleanup --aggressive` as killing all Chrome processes. `--port` must be 1024–65535 (privileged ports failed with a raw EACCES)
- **`bdg <word>` started Chrome on `http://<word>/`** - A bare word (no dot, colon or slash) is now treated as a mistyped command: `bdg statsu` → exit 81 with "Did you mean: bdg status?", `bdg version` → `bdg --version`. Hosts without a dot still work as full URLs (`bdg http://intranet/`)
- **Unreachable start URL reported "Session Started"** - When the page cannot be loaded at all (DNS failure, connection refused, missing file) the start fails with exit 80 and the reason (`Could not load …: net::ERR_NAME_NOT_RESOLVED`), and no session is left running. A page that loads with an HTTP error still starts the session (for debugging it) but warns `⚠ The page responded with HTTP 500`; `bdg <url> --json` reports `documentStatus`
- **Start URL validation** - Unsupported schemes (`ftp://`, `ws://`) are rejected instead of being turned into `http://ftp//…`, and hostnames without letters or digits (`bdg -`) are rejected. Start errors in `--json` keep the suggestion in `suggestion` instead of appending it to `error`; the human message drops the "Daemon error:" prefix
- **`dom submit` on a form did nothing** - `dom submit "#login-form"` (the documented usage) clicked the middle of the form and reported success without submitting. A `<form>` target is now submitted with `requestSubmit()`; a form with invalid fields fails with exit 81 listing them (instead of "Form Submitted"), and targets that are neither a form nor a button are rejected. Navigation is detected from before the submission, so `navigationOccurred` is right even without `--wait-navigation`, and a timeout says the form was submitted and what it waited for
- **Interactions a user could not perform succeeded silently** - `dom pressKey` on an element that cannot take focus (e.g. a heading or disabled field) typed into whatever was focused; it now fails with exit 81 (`body`/`html` still take page-level keys like Escape). `dom click` on a disabled element exits 81; clicks on hidden or covered elements still fall back to `el.click()` but the warning says why (display: none, visibility: hidden, pointer-events: none, zero size, covered). `dom fill` on checkboxes accepts true/false, yes/no, on/off, 1/0 and rejects anything else (any other value used to uncheck), reports the `checked` state, rejects values the browser discards for number/date/time/range/color fields and values longer than `maxlength`, and masks password values in its output
- **`dom pressKey --modifiers`** - Unknown modifier names exit 81 instead of being dropped (aliases `cmd`, `command`, `control`, `option` are accepted), the human output names modifiers correctly (Shift was shown as "Meta"), and `pressKey B` types an uppercase B
- **Indices could act on the wrong element** - An index from `dom query` / `dom form` was turned back into "the n-th match of the selector" when used, so after the page changed (an element inserted, an SPA view switch, a navigation) `dom click 0` silently clicked a different element, radio buttons and checkboxes from `dom form` sharing a `name` all resolved to the first one, and any selector-based `dom get` / `a11y describe` reset the cache. Indices now address the exact element (backend node id) for fill, click, submit, pressKey, scroll, get, a11y describe and screenshot; when it is gone (removed or the page navigated) commands fail with exit 87 instead of re-running the query. `dom form` generates unique selectors (same-name radios get their `value`), and `dom scroll <index>` is supported
- **`dom get --node-id`** - Node ids printed by `dom query`, `dom get --raw` and `a11y describe` ("DOM Node ID") are now the same stable id and work with `--node-id` in later commands (they were per-connection ids that pointed at nothing, or at another element); `dom get --node-id <id>` no longer needs a selector, and an unknown id exits 83 instead of printing an empty result. Element details no longer describe a different element than the one requested
- **Element screenshots** - `dom screenshot --selector/--index` captures the element's border box (padding and border were cut off)
- **Cookies and full headers were never captured** - `Set-Cookie` response headers and `Cookie`/browser-added request headers only exist in CDP's `*ExtraInfo` events, which bdg ignored, so `network headers`, `details`, `network document` and HAR cookies were always missing them (including HttpOnly cookies). They are now recorded, whatever order Chrome delivers the events in; repeated headers print one per line, and `network headers` no longer prints `Name::value`
- **`has-response-header:` and `is:from-cache` never matched in `network list`** - The list had no headers to filter on; it now fetches them when a header filter is used (without adding them to the output). `is:from-cache` / `--preset cached` now also match responses served from the browser's memory/disk/prefetch cache, not only CDN `x-cache: HIT` headers
- **`network list` only saw the last 10 requests** - It (and `network list -f`) fetched the default 10-item preview, so filters, presets, `--type`, `--last 0` and `totalCount` worked on 10 requests. It now sees every captured request; `tail` honors its `--last`; `peek`/`tail` counts show the session total (`NETWORK (10/25)`) and `peek --json` includes `totals`; `peek --type` filters before applying `--last`; `peek`/`tail --last 0` shows everything
- **HTTP status lost on failed loads** - A request that got a response (e.g. 503) and then failed (aborted body) was reported with status 0. The received status is kept; status 0 now only means "no response". `network list` shows such requests as `ERR` instead of `PND`, `details` shows `FAILED (<reason>)`, `status-code:` filters skip them, and the new `is:failed` filter / `--preset failed` select them
- **Piped output truncated at 64 KB** - `bdg … | jq` (and any slower pipe reader) received at most 64 KB of output, so large JSON (`--help --json`, `dom eval`, `dom a11y tree`, `details`, `peek --last 1000`) was cut off with exit 0. stdout/stderr writes are now synchronous, and a reader closing the pipe early (`bdg peek -f | head`) ends the command quietly instead of crashing on EPIPE
- **Docs: HAR export after `bdg stop`** - The CLI reference claimed `bdg network har` reads `~/.bdg/session.json` after a session stops; telemetry only exists while the session runs, so export before `bdg stop`
- **`dom pressKey`** - Printable keys and Enter now go through Chrome's native input pipeline: characters are actually inserted (`a`, `Shift+b` → `B`, `Shift+1` → `!`), Enter adds a newline in textareas and contenteditable instead of submitting the form, and no fake `keypress`/`input`/`change`/`submit` events are dispatched on top (Tab no longer fires events on the next field)
- **`dom click`** - Clicks with real mouse events at the element's center, so components that open on `pointerdown`/`mousedown` (menus, comboboxes) respond; falls back to `el.click()` with a `warning` when the element is covered or has no size. Output reports `method: "mouse" | "dom"` instead of the misleading "may not have a click handler" warning
- **`dom fill`** - Read-only and disabled fields fail with exit 81 instead of being silently filled; checkboxes and radios are toggled by clicking, so controlled (React) inputs keep the new state; `<select>` matches options by value or label and lists the available options when none match; `focusout` fires once on blur (was twice)
- **Integer options** - `--index`, `--nth`, `--node-id`, `--quality`, `--times`, scroll pixels and `dom submit --wait-network/--timeout` reject non-integers and out-of-range values with exit 81 (was `NaN` or silently truncated, e.g. `5px` → 5)
- **Docker images** - Chrome failed to start in both images (`Running as root without --no-sandbox is not supported`). bdg now adds `--no-sandbox` only where the sandbox cannot work (Docker, root on Linux, or `BDG_NO_SANDBOX=1`) and drops the unstable `--single-process`, images run as the unprivileged `node` user, the duplicate apk Node.js is gone, and Podman containers are detected
- **Crash recovery in Alpine/BusyBox** - Process command lines are read from `/proc/<pid>/cmdline` on Linux, so an orphaned Chrome is recognized and reaped where BusyBox `ps` lacks `-o`/`-p`
- **npm package** - No longer ships compiled tests, test utilities or source maps (1088 → 403 files, 617 → 314 kB)
- **`bin/bdg-wrapper`** - No infinite self-exec loop when installed as `bdg` without a build; per-repo session directories include a path hash so repos with the same folder name no longer share a session
- **`tests/run-all-tests.sh --integration` / `--benchmark`** - No longer also run the edge-case suite
- **Exit codes in JSON** - Error envelopes always include `exitCode`, equal to the process exit code; errors forwarded by the daemon keep their semantic code and suggestion (e.g. unknown request id → 83 instead of 104)
- **Usage errors** - Unknown options, missing arguments, invalid values and command groups without a subcommand (`bdg dom`) exit 81 (was 1) and are JSON envelopes with `--json`
- **`dom query` with an invalid selector** - Fails with exit 81 instead of reporting 0 matches
- **Global `--debug`** - Works before or after the subcommand
- **`bdg help [command]`** - Shows help instead of starting a session on `http://help`
- **Current page in status** - `status`, `peek` and "session already running" show the page the session is on now (URL and title), not the start URL
- **`network list` columns** - SIZE now shows transferred bytes (was always `-`), failed requests keep their error text, and columns stay aligned with long request ids
- **`details network`** - Field labels no longer run into their values (`Resource Type:Document`)
- **`dom query` hints** - Suggest `bdg dom get <n> --raw` / `bdg dom get <n>` instead of the non-existent `bdg details dom <n>`
- **DOM interaction by index after `dom query`** - `dom fill/click <index>` targeted the wrong element (text preview used as a selector; 1-based index sent to 0-based page scripts)
- **Chrome leak on failed launch** - Chrome is owned by the session as soon as it starts, so a failure afterwards (e.g. no page target) or a stop/signal during startup tears it down
- **CDP connect retries** - A failed first WebSocket attempt no longer tears down the session before `connect()` retries
- **Process safety** - Removed the `ps | grep dist/daemon.js` orphan scan that could SIGKILL unrelated processes on macOS; PIDs are validated (`> 0`) and verified by command line before signalling (Chrome via a `--bdg-session-dir` marker flag, the daemon via its script path)
- **Test suite** - `npm test` now runs all unit/contract tests (≈11 files were silently skipped by the shell glob); smoke tests run on every PR against a local fixture server
- **Pattern hints** - `cdp` hint detection counts per pattern, matches case-insensitively and prefers the most specific pattern

### Security

- **Remove `tsc-alias` build dependency** - Replaced with `scripts/rewrite-aliases.mjs`, eliminating the unpatched `braces` advisory (GHSA-vfj7-8cjw-p6xm) from the dev dependency tree; build output is byte-identical
- **Dependency audit** - Resolved remaining `npm audit` findings (`ws`, `shell-quote`, `js-yaml`, `fast-uri`, `brace-expansion`, `smol-toml`, `@humanfs/node`)

## [0.7.2] - 2025-12-17

### Fixed

- **Wrapper symlink resolution** - Fix infinite recursion when bdg-wrapper invoked via symlink (#152)
  - Resolves symlinks before determining script directory
  - Enables documented installation method: `ln -s /path/to/bdg-wrapper ~/.local/bin/bdg`
  - Handles relative and absolute symlink targets
  - Supports symlink chains across directories
  - Thank you @sfc-gh-mochen for this contribution!

### Changed

- Updated development dependencies to latest versions
  - @typescript-eslint/eslint-plugin: 8.48.1 → 8.49.0
  - @typescript-eslint/parser: 8.48.1 → 8.49.0
  - @eslint/js: 9.39.1 → 9.39.2
  - eslint: 9.39.1 → 9.39.2
  - knip: 5.72.0 → 5.73.4
  - @types/node: 24.10.1 → 25.0.2
  - devtools-protocol: 0.0.1551306 → 0.0.1558402

## [0.7.1] - 2025-12-14

### Added

- **DOM scroll command** (`bdg dom scroll`) - Agent-friendly page navigation (#135)
  - Scroll to elements by CSS selector: `bdg dom scroll "footer"`
  - Scroll by pixel amount: `bdg dom scroll --down 500`
  - Scroll to page positions: `bdg dom scroll --top`, `bdg dom scroll --bottom`
  - Smooth scrolling with configurable behavior
  - Works with cached query indices from previous `bdg dom query` results
  - Thank you @felores for this contribution!
- **Custom Chrome flags support** - Configure Chrome launch behavior (#143)
  - CLI option: `bdg <url> --chrome-flags="--flag1,--flag2"`
  - Environment variable: `export BDG_CHROME_FLAGS="--flag1,--flag2"`
  - Useful for proxy configuration, custom user agents, and advanced Chrome settings
  - Centralized flag parsing in start command
  - Thank you @3dyuval for this contribution!
- **Agent experience improvements** - Better Claude Code integration (#144)
  - Auto-detect headless mode based on display availability (X11/Wayland on Linux, headless in CI)
  - Block raw CDP screenshot commands with helpful suggestions to use `bdg dom screenshot`
  - Consolidated skill documentation in `.claude/skills/bdg/SKILL.md`
  - Per-repo session isolation with wrapper script support
  - Auto-allocate ports for concurrent session support
  - Persistent sessions survive HMR (Hot Module Reload) during development
  - Thank you @sfc-gh-mochen for this contribution!

### Changed

- **Headless mode default** - Now auto-detected based on environment instead of always true
- **Chrome launch logging** - Removed duplicate log messages and fixed misleading cleanup message

### Documentation

- Added `--chrome-flags` examples to consolidated SKILL.md
- Expanded WebSocket and Shell migration details
- Clarified persistent sessions and HMR workflow in skill documentation

## [0.7.0] - 2025-12-01

### Added

- **Form discovery command** (`bdg dom form`) - Agent-friendly form inspection (#130)
  - Auto-discovers forms with semantic labels, current values, and validation state
  - Suggests ready-to-use commands: `bdg dom fill 0 "<value>"`
  - Form type inference: Login, Registration, Search, Address, Contact, Payment
  - Relevance scoring auto-selects the most important form on multi-form pages
  - `--all` flag to show all forms expanded
  - `--brief` flag for quick scan (field names, types, required status only)
  - Validation detection via native HTML5, aria-invalid, sibling errors, and error classes
- **Shell quote damage detection** (#127) - Better agent error recovery
  - Detects when shell interpretation damages quoted arguments
  - Provides specific recovery suggestions for common patterns
  - Helps agents retry with correct quoting

## [0.6.11] - 2025-11-27

### Added

- **Screenshot auto-resize for Claude Vision** (#118) - Inspired by [community feedback](https://www.reddit.com/r/ClaudeCode/comments/1p74cx6/comment/nqzkk44/) that avoiding screenshots lets agents run 100+ tool calls
  - Auto-resize to 1568px max edge (~1,600 tokens optimal for Claude Vision)
  - Fall back to viewport capture for tall pages (aspect ratio > 3:1)
  - Force `deviceScaleFactor=1` during capture (fixes 4x token bloat on Retina displays)
  - `--no-resize` flag for full resolution capture (archiving/debugging)
  - `--scroll <selector>` option to scroll element into view before capture
  - Resize metadata in JSON output (original/final dimensions, token estimates, capture mode)
- **Exit code registry in help** (#114) - `bdg --help --json` now includes all 17 exit codes for agent introspection
- **Typo detection with suggestions** (#114) - Levenshtein distance matching for `--preset` and `--type` options

### Changed

- **Agent-friendly consistency refactor** (#114)
  - Added `BdgResponse<T>` type with type guards for stable JSON API contract
  - Extracted shared utilities: `delay()`, `suggestions.ts`, `dataFetcher.ts`
  - Standardized logging with `createLogger()` instead of raw console
  - Consolidated error builders to single `buildJsonError` pattern
  - 57 files changed, -177 net lines (cleaner, more consistent code)

### Fixed

- **Screenshot DPR race condition** (#118) - Re-scroll after DPR override to prevent position drift
- **Screenshot clip coordinates** (#118) - Use scroll position in clip (document origin fix)
- **Screenshot scroll restoration** (#118) - Save/restore scroll position after capture
- **Validation error handling** (#114) - Validation errors now return exit 81 (was showing stack traces)
- **JSON output pollution** (#114) - Suppressed daemon logs and "Chrome killed" message when `--json` flag used
- **Documentation accuracy** - Fixed misleading token claims (Claude rejects >20MB images, doesn't charge 376k tokens)

## [0.6.10] - 2025-11-26

### Added

- **Element-level screenshots** (`bdg dom screenshot --selector`) - Capture specific elements instead of full page (#108)
  - `--selector <css>` for CSS selector-based element capture
  - `--index <n>` for cached element index from previous query
  - Uses CDP `DOM.getBoxModel` for precise element bounds
  - JSON output includes element bounds metadata
- **Screenshot sequences** (`bdg dom screenshot --follow`) - Continuous capture for monitoring (#108)
  - `--follow` enables capture to directory at intervals
  - `--interval <ms>` controls capture frequency (default: 1000ms)
  - `--limit <n>` stops after N frames
  - Supports element-level sequences (`--follow` + `--selector`)
  - Auto-creates directory if missing
- **Auto-refresh stale cache** - DOM commands "just work" after navigation (#110)
  - Automatically re-runs original query when cache is stale
  - Debug logging: `Cache stale, auto-refreshing query "..."`
  - Commands succeed transparently without manual re-query
- **DOM.documentUpdated tracking** - Detect SPA re-renders and document replacements (#110)
  - Complements existing `Page.frameNavigated` tracking
  - Catches React/Vue/Angular full re-renders
- **STALE_CACHE exit code (87)** - Clear signal for unrecoverable cache staleness (#110)
  - Returned when auto-refresh succeeds but index is out of range
  - Distinguishes from INVALID_ARGUMENTS (81)
- **WebSocket message capture in HAR export** - Full WebSocket frame data (#106)
  - Captures sent and received messages with timestamps
  - Includes opcode and payload data

### Changed

- **Screenshot output format** - Enhanced metadata for element screenshots (#108)
  - Shows "Element screenshot captured" vs "Screenshot captured"
  - Includes selector/index and bounds in JSON output
- **DomElementResolver** - Centralized auto-refresh logic (#110)
  - `resolveTarget()`, `getNodeIdForIndex()`, `getElementCount()` all auto-refresh
  - Stores original selector in cache for refresh capability

### Fixed

- **Package-lock.json sync** - Fixed dependency mismatch causing CI failures
  - Added missing @typescript-eslint packages at 8.46.4

### Dependencies

- Bump devtools-protocol from 0.0.1543509 to 0.0.1548823
- Bump @types/node from 22.19.0 to 24.10.1
- Bump @typescript-eslint/parser from 8.46.3 to 8.47.0
- Bump @typescript-eslint/eslint-plugin from 8.46.3 to 8.47.0
- Bump eslint-plugin-tsdoc from 0.4.0 to 0.5.0
- Bump knip from 5.68.0 to 5.70.1
- Bump lint-staged from 16.2.6 to 16.2.7

## [0.6.9] - 2025-11-24

### Added

- **DevTools-compatible network filter DSL** (`bdg network list`) - Chrome DevTools Network panel filter syntax (#91)
  - 10 filter types: domain, status-code, method, mime-type, resource-type, larger-than, has-response-header, is, scheme
  - Comparison operators for numeric filters (>=, <=, >, <, =)
  - Wildcard support for domain matching (e.g., `domain:*.example.com`)
  - Negation with `-` or `!` prefix (e.g., `-domain:cdn.*`, `!method:POST`)
  - 8 presets: errors, api, large, cached, documents, media, scripts, pending
  - Combined filters with AND logic
  - Follow mode for live streaming (`--follow`)
  - HAR export with filtering (`bdg network har --filter`)
- **Console object expansion** - Rich nested object display in console messages (#92)
  - Objects automatically expanded: `{user: {name: "John", id: 123}}` instead of `{user: Object}`
  - Arrays show contents: `[1, 2, 3]` instead of `Array(3)`
  - Special types formatted: Date, RegExp, Error, Map, Set
  - Large objects truncated with `…` indicator
  - Async expansion via `Runtime.getProperties` when CDP preview is incomplete
  - Messages maintain timestamp order even with async expansion
  - Configurable via `OBJECT_EXPANSION_MAX_DEPTH` and `OBJECT_EXPANSION_MAX_PROPERTIES` constants
- **Console level filtering** - `--level` option for filtering by severity (#105)
  - Filter by error, warning, info, or debug levels
  - Complements existing `--filter` option for type-based filtering
- **Quiet mode** - `-q`/`--quiet` flag for minimal session start output (#105)
  - Ideal for AI agents that parse JSON output
  - Suppresses progress messages and tips
- **Benchmark v3.1 specification** - Comprehensive debugging-focused benchmark comparing bdg vs MCP
  - 5 tests: Basic Error, Multiple Errors, SPA Debugging, Form Validation, Memory Leak
  - Detailed scoring rubrics for Discovery, Analysis, and Workflow
  - Token efficiency metrics and comparative analysis
  - Results: bdg 77/100 vs MCP 60/100 (+28% score advantage, +33% TES advantage)
  - Full documentation in `docs/benchmarks/BENCHMARK_DEVTOOLS_DEBUGGING_V3.1.md`
  - Test results in `docs/benchmarks/BENCHMARK_RESULTS_2025-11-24.md`

### Changed

- **Refactored network commands** - Modular structure in `src/commands/network/` directory (#91)
  - Centralized messages in `networkMessages.ts`
  - Filter DSL parser with validation and helpful error suggestions
  - Deprecation warning for `bdg peek --network` (use `bdg network list`)
- **Refactored telemetry modules** - Improved code organization (#92)
  - New `remoteObjectUtils.ts` with shared predicates and formatters
  - New `objectExpander.ts` for async CDP-based expansion
  - Failure tracking with threshold warning for CDP connection issues
- **Enhanced console timestamps** - Millisecond precision in list view (#105)
  - Format: `HH:MM:SS.mmm` instead of `HH:MM:SS`
  - Better alignment with DevTools console timestamps
- **Improved source location formatting** - Handle inline/eval code gracefully (#105)
  - Shows `<inline>` or `<eval>` instead of empty string for dynamically evaluated code
- **Consolidated console level types** - Single source of truth (#105)
  - Removed duplicate `LEVEL_MAP` in favor of `ConsoleLevel` type
  - Fixed `ConsoleFormatOptions.level` type (`string` → `ConsoleLevel`)

### Fixed

- **Console buffer size** - IPC layer now passes client's `lastN` parameter (#105)
  - Console command requests all messages (`lastN=0`) instead of hardcoded 10
  - Fixes missing messages when more than 10 console logs exist
- **Memory profiling timeouts** - Increased IPC timeout from 10s to 30s (#105)
  - Matches CDP timeout for HeapProfiler/Memory domain operations
  - Fixes timeouts when taking heap snapshots
- **Network error details** - Capture comprehensive failure information (#105)
  - Added `errorText`, `canceled`, `blocked`, and `blockedReason` from `loadingFailed` events
  - Better debugging for SSL/TLS errors, CORS failures, and blocked requests
- **Commander.js option passing** - Fixed `--json` flag not propagating to subcommands (#88)
  - Convert `jsonOption` from shared constant to factory function
  - Add `.enablePositionalOptions()` to parent commands (dom, a11y)
  - Add `runJsonCommand` helper for consistent early JSON exit pattern
- **React/Vue form compatibility** - Add synthetic keyboard events for framework detection (#88)
  - `dispatchSyntheticKeyEvents()` fires `keypress`, `input`, `change`, `submit` events
  - Fixes form validation not triggering in React/Vue apps
- **A11y command routing** - CSS selector detection for smart routing (#88)
  - Properly handles `bdg dom a11y describe <selector>` vs index-based access
  - Better error handling for JSON output mode

### Documentation

- Added comparative analysis sections for each benchmark test explaining performance differences
- Added token usage metrics showing bdg's efficiency advantages in most scenarios
- Documented architectural differences (CDP access, batch operations, memory profiling)
- Removed outdated roadmap documentation (IMPLEMENTATION_STATUS.md, ROADMAP.md)

## [0.6.8] - 2025-11-22

### Added

- **Smart console command** (`bdg console`) - Intelligent console message inspection (#87)
  - Default view shows current page only with error/warning prioritization
  - Deduplication groups repeated messages with occurrence counts
  - Stack traces with source locations (file:line:column)
  - `--history` flag to see messages from all page loads
  - `--list` flag for chronological view with navigation markers
  - `--follow` flag for real-time streaming
  - JSON output with summary statistics
- **Navigation tracking** - Console messages tagged with `navigationId` for page load awareness
  - Visual "Page Reload" markers in `--list` view when using `--history`
  - Automatic filtering to current navigation by default
- **RemoteObject formatting** (`src/telemetry/remoteObject.ts`) - Rich console argument serialization
  - Handles objects, arrays, errors, and primitives
  - Uses CDP preview data for accurate representation
- **String utilities** (`src/utils/strings.ts`) - Shared text truncation helper

### Changed

- **Console output format** - Problem-focused summary replaces simple list
  - Errors shown first with source locations and stack traces
  - Warnings grouped separately
  - Info/debug/other summarized with counts
- **Worker command registry** - Now includes `navigationId` in console message responses
- **Documentation updates** - CLI reference, decision trees, and task mappings updated

## [0.6.7] - 2025-11-22

### Fixed

- **Subcommand help output** - `--help --json` now returns focused command info instead of full tool structure (#84)
- **Graceful degradation for dom get** - Handle accessibility API unavailability gracefully (#82)
- **Stale query cache detection** - Detect and clear stale query cache after page navigation (#74)

### Changed

- **Improved cache management** - Better DOM element resolution and cache management architecture (#79)
- **Consolidated cleanup logic** - Improved type safety in cleanup state and type guards (#77)
- **Removed unused exports** - Clean up unused exports identified by knip (#80)
- **Documentation updates** - Slimmer README with Wiki links, updated CDP method count to 644

## [0.6.6] - 2025-11-21

### Added

- **Keyboard interaction command** (`bdg dom pressKey`) - Send keyboard events to elements (#72)
  - Support for all common keys: Enter, Tab, Escape, Space, Arrow keys, F1-F12, a-z, 0-9
  - Modifier key support: shift, ctrl, alt, meta (comma-separated)
  - `--times` option for repeated key presses
  - Works with both selectors and cached query indices
  - Auto-waits for network stability (with `--no-wait` opt-out)
- **Network stability waiting** - Click and fill commands now wait for network to settle (#72)
  - Prevents race conditions when actions trigger AJAX requests
  - `--no-wait` flag to opt-out when immediate return is needed
- **Direct index support for dom click** - Use 0-based indices from query cache directly (#72)

### Changed

- **Improved `dom get` output** - Shows DOM context (tag, classes, text) when a11y name is missing (#72)
- **Improved `a11y describe` output** - Includes tag name, CSS classes, and text preview (#72)
- **Smart routing for `bdg dom a11y`** - Automatically routes to appropriate subcommand based on input type (#72)
- **Better filter feedback** - Shows helpful message when `--type` filter matches nothing (#72)
- **Enhanced URL validation hints** - Better error messages for shell quoting issues (#72)

### Fixed

- **Reject invalid `--last 0` value** - The peek command now validates that N >= 1
- **Resolved element target helper** - Extracted shared logic to reduce ~70 lines of duplicate code (#72)

## [0.6.5] - 2025-11-21

### Added

- **Agent-friendly discovery system** - Machine-readable help and intelligent pattern detection (#68, #69)
  - `bdg --help --json` - Machine-readable schema with task mappings, decision trees, and runtime state
  - Pattern detection for common CDP usage that suggests high-level alternatives
  - 15 task-to-command mappings with CDP fallback options
  - 5 intent-based decision trees (DOM, Network, Console, Monitoring, Session)
  - Dynamic runtime state showing command availability
  - Capabilities summary (53 CDP domains, 300+ methods)
- **Query cache for index-based DOM access** - Persistent cache enables fast element references (#68)
  - After `bdg dom query <selector>`, reference elements by index in subsequent commands
  - Direct index access for inspection: `bdg dom get 0`, `bdg dom a11y describe 0`
  - File-based cache in `~/.bdg/query-cache.json` persists across CLI invocations
  - Automatically cleared when starting new queries or ending sessions
  - Two access patterns documented: direct index (inspection) vs --index flag (interaction)
- **Enhanced command hints** - Context-aware guidance for better command usage (#68)
  - Pattern-based hints suggest high-level commands when using verbose CDP
  - Runtime.evaluate triggers suggest `bdg dom query` for element inspection
  - Page.captureScreenshot triggers suggest `bdg dom screenshot`
  - Network.getCookies triggers suggest `bdg network getCookies`
  - CommandRunner integration for consistent hint display
- **Resource type indicators in peek** - Visual indicators for network resource types (#68)
  - Short codes in peek output: IMG (images), DOC (documents), XHR (AJAX), SCR (scripts)
  - Helps quickly identify resource types during live monitoring
  - Complements existing `--type` filtering for resource-based queries

### Changed

- **Improved error messages** - Better guidance and actionable suggestions (#68)
  - Enhanced daemon-not-running errors with clear next steps
  - Session-not-found errors include start command examples
  - Invalid argument errors show expected formats
- **Documentation updates** - Comprehensive agent discoverability documentation (#68)
  - Added CLAUDE.md section on DOM interaction patterns
  - Created manual testing guide for agent discovery features
  - Reorganized agent discoverability docs to focus on unresolved items
  - Added PAIN_POINTS_RESOLVED.md tracking completed improvements

### Fixed

- **String escaping security issue** - Properly escape backslashes in selector strings (#68)
  - Fixes CodeQL high-severity warning about incomplete string escaping
  - Backslashes now escaped before single quotes to prevent bypass
  - Resolves potential injection in DOM formatter hints

### Performance

- **Optimized HAR endpoint selection** - Prefer current navigation's Document resource (#68)
  - Smarter default endpoint inference from network data
  - Improves accuracy of HAR export for SPAs

## [0.6.4] - 2025-11-20

### Added

- **HAR Export** (`bdg network har`) - Export network data as HAR 1.2 format (#65)
  - `bdg network har [output-file]` - Export to HAR format compatible with Chrome DevTools
  - Works with live sessions (queries daemon via IPC) or post-session (reads session.json)
  - Optional output filename defaults to timestamped file in ~/.bdg/
  - Automatic binary content detection and base64 encoding
  - Includes creator/browser metadata and Chrome version
  - Valid HAR 1.2 format that opens in Chrome DevTools and HAR Viewer
  - **Real timing data**: DNS resolution, TCP/SSL connection, send, wait (TTFB), and receive times
  - **Accurate sizes**: Wire-level body sizes (encodedDataLength), HTTP headers including request/status lines
  - **Server metadata**: IP address and connection ID for each request
  - Proper handling of missing timing fields (-1 for unknown per HAR spec)
- **Network headers command** (`bdg network headers`) - HTTP header inspection for debugging and analysis (#67)
  - `bdg network headers` - Display all request and response headers for all network requests
  - `bdg network headers <id>` - Show headers for a specific request by ID
  - `bdg network headers --request` - Show only request headers
  - `bdg network headers --response` - Show only response headers
  - Human-readable tabular format with proper key-value alignment
  - JSON output mode for programmatic processing
  - Works with both live sessions and post-session analysis
- **Resource type filtering** - Enhanced network telemetry with resource type metadata (#66)
  - All network requests now include `resourceType` field (Document, Stylesheet, Script, XHR, Fetch, Image, Font, etc.)
  - `bdg peek --type <types>` - Filter by resource type (e.g., `--type Document,XHR`)
  - Resource types displayed in peek command output alongside URLs
  - Better understanding of network traffic composition for debugging and optimization

### Changed

- **Documentation updates** - Updated CLI reference and roadmap for HAR export feature
  - Removed completed Issue #62 from roadmap
  - Prioritized Issue #48 (form interaction enhancements)

## [0.6.3] - 2025-11-19 [YANKED]

**Note**: This version was never released. Content moved to v0.6.4.

### Added

- **HAR Export** (`bdg network har`) - Export network data as HAR 1.2 format (#61)
  - `bdg network har [output-file]` - Export to HAR format compatible with Chrome DevTools
  - Works with live sessions (queries daemon via IPC) or post-session (reads session.json)
  - Optional output filename defaults to timestamped file in ~/.bdg/
  - Automatic binary content detection and base64 encoding
  - Includes creator/browser metadata and Chrome version
  - Valid HAR 1.2 format that opens in Chrome DevTools and HAR Viewer
  - **Real timing data**: DNS resolution, TCP/SSL connection, send, wait (TTFB), and receive times
  - **Accurate sizes**: Wire-level body sizes (encodedDataLength), HTTP headers including request/status lines
  - **Server metadata**: IP address and connection ID for each request
  - Proper handling of missing timing fields (-1 for unknown per HAR spec)

## [0.6.2] - 2025-11-19

### Added

- **Accessibility tree inspection** (`bdg dom a11y`) - Comprehensive accessibility testing capabilities (#64)
  - `bdg dom a11y tree` - View full accessibility tree with role/name/description hierarchy
  - `bdg dom a11y query <pattern>` - Query nodes by role, name, or description (AND logic)
  - `bdg dom a11y describe <selector>` - Get accessibility info for specific element
  - Exposes Chrome's accessibility tree (what screen readers see)
  - Human-readable tree view with automatic ignored node filtering
  - JSON output for programmatic processing
  - Use cases: verify accessible names, validate ARIA landmarks, audit form labels, CI/CD accessibility testing
- **Aggressive daemon cleanup** - Enhanced cleanup of orphaned daemon processes (#46)
  - `bdg cleanup --aggressive` now finds and kills orphaned daemon processes
  - Cross-platform support (macOS, Linux, Windows)
  - Prevents resource leaks from test failures, timeouts, and crashes
  - Safe cleanup that preserves currently tracked daemon

### Changed

- **Test infrastructure consolidation** (#63)
  - Added c8 coverage tooling with proper exclusions for test files
  - Added comprehensive unit tests for core utilities (errors, http, process)
  - Created reusable shell test helpers in `tests/lib/`
  - Hardened shell tests against timing issues with better retry logic
  - Improved smoke test reliability with better timeouts and daemon helpers
- **Documentation reorganization** (#63)
  - Consolidated scattered planning docs into `docs/roadmap/`
  - Moved agent principles to dedicated `docs/principles/` directory
  - Created `docs/quality/` section with test guides and shell test hardening docs
  - Added implementation status tracking in roadmap
  - Updated README with clear documentation navigation section
- **Code quality improvements** (#59)
  - Enhanced error handling and logging consistency
  - Improved module boundaries and separation of concerns
  - All 19 integration tests now pass (100% pass rate)

### Fixed

- **Test reliability** (#59)
  - Fixed `tail.test` to match current JSON output format
  - Fixed `url-handling.test` to use `--headless` flag for IP address test

### Dependencies

- Bump js-yaml from 4.1.0 to 4.1.1 (#45) - dev dependency security update

## [0.6.1] - 2025-11-16

### Changed

- **Internal Refactoring**: Comprehensive codebase reorganization for better maintainability
  - **Module boundaries** (#44): Moved Chrome cleanup to session layer, extracted start command helpers, fixed error imports across 28 files for clearer separation of concerns
  - **Connection layer** (#43): Extracted types, config, and port reservation into dedicated modules (+266 lines, improved discoverability)
  - **Daemon architecture** (#42): Extracted handlers and lifecycle logic from monolithic files (ipcServer.ts reduced by 80%, worker.ts reduced by 81%)
  - **IPC layer** (#41): Extracted transport layer, flattened types, added barrel exports for cleaner imports
  - **Session module** (#40, #39): Improved file operations with `fs.rmSync({ force: true })`, better Windows support, consolidated duplicate lock logic, exported `readPidFromFile` for reuse
  - **Telemetry module** (#38): Replaced `console.error` with structured logging, used `filterDefined` for cleaner JSON output, added `isFilteredOut` helper
  - **UI layer** (#37): Added `joinLines` helper, replaced non-null assertions with explicit null checks, added type interfaces for command options
  - **DOM module** (#32): Consolidated into `src/commands/dom/` directory (7 files), deleted unused dead code, improved documentation
- **Code Quality**: Removed dead code identified by static analysis, fixed TSDoc syntax violations, improved error handling consistency
- **Testing**: Added 4 contract test files for session module (430 lines), enhanced test isolation with `BDG_SESSION_DIR`

### Fixed

- **Peek command exit code**: Return `RESOURCE_NOT_FOUND` (83) instead of `SESSION_FILE_ERROR` (103) when no session exists
- **Worker IPC race condition**: Reordered initialization to setup IPC listener before sending ready signal, preventing intermittent failures when agents run follow-up commands immediately
- **Chrome binary validation**: Added actionable error messages for `CHROME_PATH` overrides
- **Process cleanup**: Improved detection and cleanup of orphaned worker processes when daemon crashes
- **Form interaction bugs** (#32): Fixed 6 critical issues including injection vulnerability, memory leak, browser compatibility, visibility detection, selector generation, and dead code

### Internal

- **Net code reduction**: Despite adding features, overall codebase became more maintainable with ~1,200 lines removed from core daemon files
- **Test coverage**: 165/165 tests passing (100%), enhanced with flaky tests investigation report
- **Documentation**: Added comprehensive UX improvements tracking, form interaction plan, agent discoverability guide

## [0.6.0] - 2025-11-13

### Added
- **CDP Self-Discovery**: Comprehensive protocol introspection for agent-friendly self-documentation
  - `bdg cdp --list` - List all 53 CDP domains with metadata
  - `bdg cdp <Domain> --list` - List all methods in a domain (e.g., Network has 39 methods)
  - `bdg cdp <Method> --describe` - Show full method schema with parameters, types, and examples
  - `bdg cdp --search <keyword>` - Search across 300+ CDP methods
- **Case-Insensitive CDP Commands**: `network.getcookies` automatically normalizes to `Network.getCookies`
- **Intelligent Error Recovery**: Typo detection using Levenshtein distance algorithm
  - Suggests up to 3 similar methods when typos detected
  - Example: `Network.getCookie` → "Did you mean: Network.getCookies?"
- **Type-Safe CDP API**: Full TypeScript types using official devtools-protocol package
  - IDE autocomplete for all 300+ CDP methods
  - Compile-time type checking for parameters and return values
  - Zero runtime overhead (types erased at compile time)
- **Enhanced User Feedback**:
  - Progress indicators during Chrome launch ("Launching Chrome...", "Waiting for Chrome to be ready...", "✓ Chrome ready")
  - Detailed timeout error messages with troubleshooting steps
  - Error context with suggestions in both JSON and human-readable formats

### Changed
- **Type System Migration**: Migrated from custom CDP types to official `devtools-protocol` types
  - Removed 176 lines of custom type definitions
  - Updated 12 files across telemetry, connection, commands, and daemon layers
  - Better IDE support and automatic updates with protocol changes
- **Documentation Updates**:
  - Added `docs/TYPE_SAFE_CDP.md` - Comprehensive guide to type-safe CDP usage
  - Updated `CLAUDE.md` with "Agent-Friendly Discovery" section
  - Enhanced README with CDP discovery examples
- **Command Options**: Added explicit `false` defaults to boolean options for clarity

### Fixed
- **Tilde Expansion**: Fix `~/` expansion in `--user-data-dir` option (was causing ENOENT errors)
- **Directory Creation**: Ensure `userDataDir` exists before launching Chrome (chrome-launcher requirement)
- **CI Integration**: Link `bdg` to PATH for integration tests in GitHub Actions

### Testing
- Added 28 CDP discovery integration tests (`tests/integration/cdp-discovery.test.sh`)
- All smoke tests passing (11/11)
- Integration tests: 9/9 passing (2 flaky tests removed from CI)

### Internal
- New modules: `src/cdp/` - Protocol introspection infrastructure
  - `protocol.ts` (250 lines) - Protocol loader with case-insensitive lookup
  - `schema.ts` (357 lines) - Agent-friendly method schemas
  - `types.ts` (147 lines) - TypeScript types for protocol schema
  - `typed-cdp.ts` (177 lines) - Type-safe CDP wrapper
- Refactored error handling with structured `errorContext` support
- Enhanced `CommandRunner` to pass suggestions to both JSON and human output

### Performance
- Protocol introspection cached for performance
- No runtime overhead from type-safe API (TypeScript types only)

## [0.5.1] - 2025-11-12

### Fixed
- Improved cleanup of orphaned worker processes when daemon crashes
- Enhanced stale session detection and automatic cleanup
- Better test isolation with `BDG_SESSION_DIR` environment variable override
- Chrome binary validation with actionable error messages for `CHROME_PATH` overrides
- Chrome profile directory now relative to session directory for better test isolation

### Changed
- Refactored error handling organization (connection errors moved from `ui/errors` to `connection/errors` domain)
- Implemented hybrid CI/CD testing strategy:
  - PR builds run fast contract tests only (~30-60s, no Chrome needed)
  - Main branch runs full suite including smoke tests with Chrome
  - Smoke tests skipped on PRs for faster feedback
- Enhanced orphaned process detection (worker survives daemon crash)
- Improved process kill mocking to handle negative PIDs correctly

### Testing
- Added comprehensive smoke test suite for end-to-end validation:
  - Session lifecycle tests (start, peek, stop)
  - Error handling tests (daemon crashes, invalid inputs)
  - Runs only on main branch with headless Chrome
- Improved smoke test reliability (increased wait times, better cleanup)
- Better test process mocking for contract tests
- Documented test pyramid strategy in `TESTING_PHILOSOPHY.md`

### Internal
- Removed dead code identified by static analysis (knip)
- Fixed TSDoc syntax violations (no curly braces in `@throws`, proper `@example` code fences)
- Added test home directory utilities (`testHome.ts`)
- Enhanced daemon cleanup logic with Chrome process termination

## [0.5.0] - 2025-11-08

### Added
- **Docker support improvements**
  - Automatic Docker environment detection via `isDocker()` helper
  - Docker-specific Chrome flags (`DOCKER_CHROME_FLAGS`) for GPU/graphics workarounds
  - `--cap-add=SYS_ADMIN` capability added to docker-compose.yml for Chrome sandbox support
  - Comprehensive Docker integration tests

### Changed
- Chrome launcher now automatically applies Docker-optimized flags when running in containers
  - `--disable-gpu` - Disable GPU hardware acceleration
  - `--disable-dev-shm-usage` - Overcome limited resource problems
  - `--disable-software-rasterizer` - Don't fall back to software rendering
  - `--single-process` - Run Chrome in single-process mode (safer in containers)

### Fixed
- Chrome now launches successfully in Docker containers with proper GPU workarounds
- Docker environment detection works via `/.dockerenv` file and `/proc/self/cgroup` checks

### Documentation
- Updated docker-compose.yml with required security capabilities
- Added comments explaining Docker-specific Chrome requirements
- Documented alternative `seccomp=unconfined` approach for restricted environments

## [0.4.0] - 2025-11-08

### Added
- **External Chrome connection support** via `--chrome-ws-url` flag
  - Connect to Chrome running in Docker containers or external processes
  - Supports WebSocket URLs (e.g., `ws://localhost:9222/devtools/page/{id}`)
  - Skips Chrome launch and lifecycle management for external instances
  - Comprehensive Docker documentation in `docs/DOCKER.md`
- Centralized Chrome messages in `src/ui/messages/chrome.ts`:
  - `chromeExternalConnectionMessage()`
  - `chromeExternalWebSocketMessage(wsUrl)`
  - `chromeExternalNoPidMessage()`
  - `chromeExternalSkipTerminationMessage()`
  - `noPageTargetFoundError(port, availableTargets)`

### Changed
- Refactored worker configuration to use `filterDefined()` utility (2 locations)
- Improved code maintainability by removing 87 excessive inline comments
- Enhanced error messages with centralized formatting functions
- Test suite improvements: fixed 6 syntax errors and added missing `--headless` flags

### Fixed
- Worker ready signal now handles external Chrome correctly (no null reference errors)
- IPC chain properly passes `chromeWsUrl` through all layers
- Page target error messages include diagnostics and troubleshooting steps

### Performance
- Cleaner codebase with 94% fewer inline comments (kept only critical ones)

### Testing
- **100% test pass rate achieved** (19/19 tests passing)
  - Integration tests: 9/9 (100%)
  - Error scenarios: 6/6 (100%)
  - Benchmarks: 4/4 (100%)

## [0.3.2] - 2025-11-07

### Added
- **New `bdg tail` command** for continuous session monitoring
  - Live updates with configurable interval (`--interval <ms>`, default 1000ms)
  - All filtering options from peek (`--network`, `--console`, `--last N`)
  - Proper SIGINT handling (Ctrl+C)
  - JSON and verbose output modes
  - Alternative to `bdg peek --follow` with better Unix semantics
- Integration tests for tail command (9 test cases)

### Changed
- Updated help text to suggest `bdg tail` for continuous monitoring
- Enhanced CLI documentation
- Updated landing page with all available commands and diamond icon (◆)

### Removed
- Review documentation moved to completed work archives (CODE_REVIEW.md, REFACTORING_GUIDE.md, TECHNICAL_DEBT.md)

### Phase 3 Technical Debt Resolution (Complete)
This release completes Phase 3 of technical debt cleanup, achieving better Unix philosophy compliance:
- **TD-001**: `--kill-chrome` flag remains available (users can also use `bdg cleanup --aggressive`)
- **TD-005**: Created separate `tail` command (separates snapshot vs. streaming concerns)

**All Technical Debt Resolved**: 13/13 items complete (100%)
- Phase 1 & 2: Internal code quality (11 items) ✅
- Phase 3: Unix philosophy compliance (2 items) ✅

## [0.3.1] - 2025-11-07

### Changed
- **Code quality improvements** through Phase 1 technical debt resolution
  - Simplified error code mapping in stop command (TD-006)
  - Extracted magic numbers to named constants across codebase (TD-010)
  - Enhanced IPC connection error messages with contextual information (TD-012)
  - Replaced platform-specific execSync with cross-platform helper (TD-004)
  - Resolved TODO comments in IPC server (TD-009)
- **UI layer reorganization** for better maintainability
  - Moved error handling modules from `src/` to `src/ui/errors/` directory
  - Moved logger modules from `src/` to `src/ui/logging/` directory
  - Updated all import paths to use new locations
- **Documentation improvements**
  - Clarified release process for title format and changelog updates
  - Added comprehensive code review document (CODE_REVIEW.md) cataloguing 19 technical debt items
  - Added detailed refactoring guide (REFACTORING_GUIDE.md) with before/after examples

### Removed
- Deprecated re-export files (`src/errors.ts`, `src/logger.ts`)

### Performance
- Improved code maintainability through reduced duplication and clearer structure

## [0.3.0] - 2025-11-07

### Added
- **Screenshot command** (`bdg dom screenshot`) for capturing page screenshots
  - Full-page and viewport-only capture modes
  - PNG and JPEG format support with quality control (0-100)
  - Automatic directory creation
  - Comprehensive metadata output (dimensions, size, format)
  - Human-readable and JSON output modes
- Schema contract tests with golden files to prevent schema drift (12 tests)
- Golden CDP workflow script for agent reference implementation (`tests/agent-benchmark/scenarios/00-golden-cdp-workflow.sh`)
- Comprehensive exit codes documentation (`docs/EXIT_CODES.md`)
- Schema migration plan documentation (`docs/roadmap/SCHEMA_MIGRATION_PLAN.md`)
- Week 0 completion report (`docs/roadmap/WEEK_0_COMPLETION_REPORT.md`)
- `ScreenshotData` interface to type definitions
- Screenshot formatter for human-readable output

### Changed
- Page readiness now waits for stability by default (prevents premature DOM capture)
- Test suite organized with dedicated fixtures directory
- ESLint configuration enhanced for test files
- Improved documentation structure for roadmap and quality guidelines

### Fixed
- npm distribution tags properly configured (`latest` and `alpha` both point to current version)
- Package README now updates correctly on npm registry
- TypeScript build cache issues resolved with clean rebuild process

### Performance
- Test fixtures automatically copied to dist during build

## [0.2.1] - 2025-11-06

### Added
- Comprehensive test suite with agent benchmarks, error scenarios, edge cases, and integration tests
- Test runner script (`tests/run-all-tests.sh`) with granular suite selection (`--benchmarks`, `--integration`, `--errors`, `--edge-cases`)
- Agent benchmark framework for real-world web automation scenarios (Hacker News, GitHub, Wikipedia, Reddit)
- Error scenario tests for port conflicts, invalid URLs, session recovery, daemon crashes, Chrome launch failures
- Edge case tests for URL validation and handling
- Integration tests for CDP, console, DOM, network, cleanup, details, peek, and status commands
- Comprehensive test documentation in `tests/README.md`
- Testing philosophy documentation in `docs/quality/`
- Project roadmap documentation across multiple phases

### Changed
- **Code quality improvements** following KISS, DRY, and YAGNI principles
- Enhanced TSDoc comments with detailed descriptions and `@remarks` sections
- Reorganized testing documentation to `docs/quality/` directory
- Improved error handling with proper warning messages instead of silent failures
- Optimized Chrome diagnostics calls (reduced from 3× to 1× in error paths)
- Combined duplicate PID validation logic in launcher (reduced 30 lines to 26)

### Fixed
- **Collector activation timing** - activate before navigation to capture initial page load events
- **Stale daemon cleanup** - properly handle and report errors when removing stale daemon.pid files
- **Port conflict detection** - detect orphaned Chrome processes before launch with better error messages
- **URL validation** - stricter validation with centralized protocol constants and simplified logic
- **Chrome process validation** - combined PID and liveness checks for more efficient error detection

### Removed
- Dead code and unused catch parameters across codebase
- Obsolete `vbscript:` protocol support (YAGNI compliance)
- Redundant protocol validation regex checks (~25 lines)
- Duplicate protocol lists in URL utilities

### Performance
- Reduced code duplication by ~68 lines through DRY refactoring
- Optimized Chrome diagnostics generation in error paths
- Simplified URL validation logic for faster processing

## [0.2.0] - 2025-11-06

### Added
- Debug logging mode with `--debug` flag for troubleshooting daemon/IPC issues
- Live activity metrics to `bdg status` command (network requests, console messages, DOM queries)
- Smart page readiness detection for SSR applications with three-phase adaptive detection
- Chrome popup suppression (translate prompts, notification requests) for cleaner automation
- Configurable IPC timeouts for better test reliability and slow page handling

### Changed
- Flatten CLI structure by eliminating `src/cli` directory for simpler imports
- Centralize all UI messages into `src/ui` layer (commands, errors, session, console, preview, validation)
- Rename "collectors" → "telemetry" throughout codebase for clearer terminology
- Enhance message organization with domain-specific message modules
- Improve peek command UX in follow mode (timestamps, hide tips during live updates)
- Hide empty sections in peek output when filters are active

### Fixed
- Chrome launch validation now checks process liveness (no more false "PID: 0" success messages)
- Enhanced Chrome launch errors with installation diagnostics and troubleshooting steps
- Enhanced target-not-found errors with available tabs list and diagnostic commands
- Port validation now throws consistent `ChromeLaunchError` instead of generic `Error`
- Stale session auto-cleanup when daemon PIDs are dead (no more manual cleanup required)
- **"Last Request" timestamp in status command** (was showing "489560h ago" instead of "2s ago")

## [0.1.0] - 2025-11-05

### Added
- Direct CDP passthrough command (`bdg cdp`) for low-level Chrome DevTools Protocol access
- High-level network commands (`bdg network getCookies`) with human-readable formatting
- JavaScript evaluation command (`bdg dom eval`) for executing code in browser context
- Console log queries (`bdg console`) with filtering and pagination support
- Comprehensive contract tests for network collector and IPC server (1,173 lines)
- Enhanced CDP type definitions with complete Network domain coverage
- CommandRunner helper for unified error handling and output formatting
- commonOptions helper for shared CLI flags (`--json`, `--last`, `--filter`)
- responseValidator helper for type-safe IPC/CDP response validation
- Phase 1 reliability improvements for SSR applications
- Smart page readiness detection foundation (load event, network stability, DOM stability)
- IPC-based live data streaming for `peek` and `details` commands

### Changed
- Migrated all CLI commands to unified helper architecture (KISS, DRY, YAGNI principles)
- Replaced two-tier file-based preview system with pure IPC streaming
- Improved status output with clean formatting and Chrome diagnostics
- Enhanced error messages with consistent formatting and actionable suggestions
- Git commit guidelines: exclude AI tool attribution from commit messages

### Removed
- Old DOM collector implementation (domCache, domQuery, selectorParser)
- ipcTest command and tests (no longer needed)
- PreviewWriter.ts and file-based preview system (139 lines)
- Preview loop and file write operations from worker
- Unused test fixtures and dead code

### Fixed
- Module resolution for TypeScript path aliases in tests
- IPC timeout configuration for test reliability
- Chrome launch validation with proper PID checks
- Stale session detection and auto-cleanup

### Performance
- **241x smaller data transfer** for peek/details (no file I/O)
- Faster response times with live data from memory instead of disk reads
- Real-time access to preview data without stopping collection

## [0.1.0-alpha.1] - 2025-11-05

### Changed
- Updated installation instructions to recommend alpha tag

## [0.1.0-alpha.0] - 2025-11-05

### Added
- Initial alpha release
- Core CLI commands: start, stop, status, cleanup, peek, details
- Daemon + IPC architecture for persistent CDP connections
- Three telemetry collectors: DOM, network, console
- Chrome launcher integration with auto-detection
- Session management with Unix socket IPC
- JSON output format for programmatic consumption
- Basic filtering for tracking domains and dev server noise

---

**Legend:**
- `Added` - New features
- `Changed` - Changes in existing functionality
- `Deprecated` - Soon-to-be removed features
- `Removed` - Removed features
- `Fixed` - Bug fixes
- `Security` - Vulnerability fixes
- `Performance` - Performance improvements
