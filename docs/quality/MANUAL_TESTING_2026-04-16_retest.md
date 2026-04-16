# BDG Manual QA Re-Test Report

**Version:** 0.7.2
**Date:** 2026-04-16 (retest, after branch `bug-tracking/test-report-2026-04-16`)
**Scope:** Black-box QA pass against the full CLI surface. No source edits.
**Tester worked from:** `/opt/homebrew/bin/bdg` → `dist/index.js` (npm-linked)

## Environment

| | |
|---|---|
| OS | macOS 15.6.1 (Darwin 24.6.0) |
| Node | v22.20.0 |
| Chrome | 147.0.7727.102 (HeadlessChrome reported in UA) |
| bdg | 0.7.2 |
| Working dir | `/tmp/bdg-qa-2026-04-16` |

## Methodology

- Discovery via `bdg --help --json`, `bdg cdp --list`, per-command `--help`.
- Exit codes captured directly (`echo "EXIT: $?"`), never read through a pipe — piped exit codes reflect the trailing process, not bdg.
- stdout / stderr separated with `2>err >out` for every `--json` command.
- JSON validated with `python3 -c 'import json,sys; json.load(sys.stdin)'`.
- Adversarial runs do not trust one result — parallel/flaky cases repeated 3×.

## Commands Exercised

| Command | Flags / sub-commands actually run | Result |
|---|---|---|
| `bdg <url>` | bare, `--timeout`, `--headless`, `--no-headless`, `--quiet`, `--debug`, `--chrome-ws-url`, `--max-body-size`, `--verbose` | ✅/❌ mixed |
| `bdg status` | default, `-v`, `--json`, post-kill | ✅/❌ mixed |
| `bdg stop` | default, `--kill-chrome`, `--json`, no-session | ✅ |
| `bdg cleanup` | default, `--force`, `--remove-output`, `--json` | ✅ with caveats |
| `bdg peek` | default, `--json`, `--verbose`, `--network` (removed), `--console`, `--dom`, `--follow`, `--last 0/-1/5/99999/abc`, `--type Document/XHR/NoSuch` | ✅/❌ mixed |
| `bdg tail` | default (3s) | ✅ (looks identical to `peek --follow`) |
| `bdg details` | `network <real-id>`, `network <bogus>`, `console <valid>`, `console 100/abc/-1`, missing args | ❌ exit-code issues |
| `bdg dom query` | `"*"`, `""`, `"   "`, `"###"`, `"🦄"`, `h1` parallel ×5 ×3 | ❌ parallel race |
| `bdg dom get` | `<selector>`, `<index>`, `999`, `--raw` | ✅ |
| `bdg dom eval` | simple, object, number, promise-resolve/reject, throw, syntax error, reference error, infinite loop | ❌ timeout+error-class bugs |
| `bdg dom a11y` | bare, `tree`, `query role:*`, `query name:*`, bare search `"Pizza"`, `describe 0` | ✅/❌ |
| `bdg dom form` | default, `--brief`, `--all`, `--json` | ✅ (brief now shows state — fix confirmed) |
| `bdg dom screenshot` | full, `--selector`, `--index`, `--format jpeg --quality 50`, `--no-full-page`, `--scroll` | ✅ / ❌ exit codes |
| `bdg dom fill` | selector, index, `999`, `""`/`""`, 10 000-char value | ❌ leaks on empty |
| `bdg dom click` | selector, index, radio/checkbox-by-index, `-1`, `""`, `999`, `#no-match` | ❌ leaks on empty/`-1` |
| `bdg dom submit` | form button by index with `--wait-navigation`, missing selector, no cache | ❌ exit codes |
| `bdg dom pressKey` | `Tab`, `Enter`, `Escape`, `ArrowDown`, `NotAKey`, `--times 3` | ✅ |
| `bdg dom scroll` | `--bottom`, `--top`, `--down 500`, selector, bare (no arg), `--top --down 500` | ❌ conflicts silently merged |
| `bdg network list` | default, `--filter status-code:>=400`, `method:POST`, `!method:GET`, `no-such-field:x`, `--preset errors/api/bogus`, `--last 0/5/500`, `--verbose`, `--json` | ❌ JSON shape + `--verbose` no-op |
| `bdg network har` | no arg, explicit path, `--filter method:POST` | ✅ |
| `bdg network getCookies` | default, after cookie set, `--url <domain>`, `--json` | ❌ JSON shape |
| `bdg network headers` | no arg (main doc), `<real-id>`, `<bogus>`, `--header content-type` | ✅ |
| `bdg network document` | default | ✅ |
| `bdg console` | default, `--list`, `--level error/warning/info/debug/bogus`, `--last 0/3`, `--json`, `--list --json` | ✅ (summary skipped on info — fix confirmed) |
| `bdg cdp` | `--list` (all), `<Domain> --list`, `<Method> --describe`, `--search cookie`, execution valid/invalid/lowercase/bad-JSON/missing-params | ✅ |
| `bdg --help --json` | full tree | ✅ |
| `bdg --version` | default, `-V`, `--version --json` | ✅/minor |

## Daily-Task Scenarios

| Task | Command used | Worked? |
|---|---|---|
| Read page title | `bdg dom eval "document.title"` | ✅ (unquoted string — fix confirmed) |
| Start on minimal page | `bdg example.com` | ✅ |
| Start on unreachable host | `bdg http://127.0.0.1:1/` | ❌ reports "Session started" + exit 0 |
| Start on expired-SSL page | `bdg https://expired.badssl.com/` | ❌ exit 0; no error surface |
| Start on data: URL | `bdg "data:text/html,<h1>hello</h1>"` | ✅ |
| Start on file:// | `bdg "file:///etc/hosts"` | ✅ |
| Discover form fields | `bdg dom form`, `--brief` | ✅ (brief now shows values — fix confirmed) |
| Fill text, tel, email, time, textarea | `bdg dom fill <idx> "<val>"` | ✅ |
| Select radio by index | `bdg dom click 4` | ✅ (no longer hits "Small" — fix confirmed) |
| Check checkbox by index | `bdg dom click 6`, `bdg dom click 9` | ✅ |
| Submit form | `bdg dom submit 12 --wait-navigation` | ✅ ("Navigation: yes" — fix confirmed) |
| Verify POST body | `bdg details network <id>` | ✅ |
| Navigate via JS inside session | `bdg dom eval "location.href='…/Array'"` | ✅; `status` + `pageState` update correctly (fix confirmed) |
| Inspect heavy SPA network | `bdg network list` on MDN | ✅ (80 requests captured, `--last 500` returns all — fix confirmed) |
| Filter failing requests | `bdg network list --filter status-code:>=400` | ✅ (human) / ⚠️ JSON uses misleading field names |
| Export HAR | `bdg network har out.har` | ✅ |
| HAR with filter | `bdg network har … --filter method:POST` | ✅ |
| List cookies | `bdg network getCookies` after `/cookies/set?foo=bar` | ✅ (human) / ⚠️ `data: []` shape |
| Clear cookies | `bdg cdp Network.clearBrowserCookies` | ✅ |
| Discover CDP methods | `bdg cdp --search cookie`, `bdg cdp Network.getCookies --describe` | ✅ |
| Call CDP with malformed params | `bdg cdp Runtime.evaluate --params 'not json'` | ✅ (exit 81) |
| Take full-page screenshot | `bdg dom screenshot out.png` | ✅ |
| Element-selector screenshot | `bdg dom screenshot --selector form out.png` | ✅ |
| Capture via cached index | `bdg dom screenshot --index 0 out.png` | ⚠️ "Failed to get element bounds" + exit 0 on some elements |
| Take JPEG q50 | `bdg dom screenshot --format jpeg --quality 50 out.jpg` | ✅ |
| Monitor live | `bdg peek --follow` / `bdg tail` | ✅ (appear to be identical) |
| Parallel DOM queries ×5 | 5× `bdg dom query "h1"` in background | ❌ returns 0-or-1 non-deterministically |
| Kill daemon mid-session | `kill -9 $(cat ~/.bdg/daemon.pid)` then `bdg status` | ⚠️ recovers, but exit code / double-"Error:" issues |
| Re-start while running | `bdg example.com` with running session | ✅ (exit 84) |

---

## 🔴 Critical bugs

### C1. `bdg <url> --chrome-ws-url <invalid>` reports success on connection failure

**Repro:**
```bash
bdg https://example.com --chrome-ws-url "ws://127.0.0.1:9999/devtools/page/nonexistent" --timeout 5
echo $?  # 0
```

**Actual:** stderr dumps raw worker log (`[worker] Starting (PID …)`, internal config JSON, `[worker] WebSocket closed: 1006`) and exits **0**.
**Expected:** Exit 101 (CDP_CONNECTION_FAILURE) with clean `Error: failed to connect to Chrome at <url>`.
**Impact:** Automation cannot detect that the session never attached. Silent failure.

### C2. `bdg <url> --max-body-size abc` leaks internal stack trace and exits 0

**Repro:**
```bash
bdg example.com --max-body-size abc --timeout 3
echo $?  # 0
```

**Actual stderr:**
```
file:///Users/szymondzumak/Developer/browser-debugger-cli/dist/commands/shared/validation.js:39
    throw new CommandError(message, { suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
          ^

CommandError: Error: Invalid value: "abc" is not a valid integer
Valid range: 1 to 100

Example: --value 1
```

**Actual:** Exit **1** (default Node unhandled-exception exit). `CommandError` thrown from `buildSessionOptions` escapes the action handler because `collectorAction(url, options)` in `src/commands/start.ts:226` is called outside the `try { assertValid* } catch` block on lines 216–224. `maxBodySizeRule.validate(...)` (line 153) runs after validation and throws straight to Node.
**Expected:** Clean error + exit 81; include `--max-body-size` in the validation message instead of `--value`.
**Impact:** Any invalid numeric option on session start crashes the process with a stack trace that exposes the dist path.

### C3. `bdg dom eval` with `while(true)` wedges the session for 30 s per retry

**Repro:**
```bash
bdg example.com
bdg dom eval "while(true){}"
echo $?  # 101 after 30 s, message: "Worker response timeout (30s)"
bdg dom eval "1+1"
echo $?  # 101 after another 30 s — Runtime is still stuck
bdg stop # only way to recover
```

**Actual:** First eval exits 101 (CDP_CONNECTION_FAILURE) with message `Error: Worker response timeout (30s)`. The Runtime target is still executing the loop so every subsequent `dom eval` waits the full 30 s before timing out.
**Expected:**
1. Use CDP's own timeout semantics (`Runtime.evaluate` accepts `timeout` in params; or call `Runtime.terminateExecution` on timeout) so the loop is actually killed.
2. Exit 102 (CDP_TIMEOUT), not 101 — 101 implies the WebSocket died, which it didn't.
3. Message should name the script, not the worker IPC layer.
**Impact:** An agent retrying on 101 re-hangs for 30 s each time; the session is effectively bricked until someone notices and calls `bdg stop`.

### C4. `bdg dom click ""`, `click -1`, `fill "" ""` leak internal JS source and break recovery hints

**Repro:**
```bash
bdg example.com
bdg dom click ""
bdg dom click -1
bdg dom fill "" ""
```

**Actual** (all three, exit **110**):
```
Error: Script execution failed: Uncaught at line 3, column 31

Expression received: (
(function(selector, index) {
  const allMatches = document.querySelectorAll(selector);
  …

Troubleshooting:
  1. Verify element exists: bdg dom query ""
  2. Check element is visible and clickable
  3. Try direct eval: bdg dom eval "document.querySelector('').click()"
```

The "Troubleshooting" block recommends `bdg dom query ""` and `bdg dom eval "document.querySelector('')"` — both of which themselves fail. `-1` and `""` need to be rejected at arg-parsing time with exit 81.
**Impact:** Looks like a bdg bug to users; the stack trace leaks the implementation of the click helper.

### C5. `bdg <unreachable-url>` reports success even when Chrome can't connect

**Repro:**
```bash
bdg http://127.0.0.1:1/ --timeout 10
echo $?  # 0
bdg status --json | jq .data.pageState
# { "url": "http://127.0.0.1:1/", "title": "127.0.0.1" }

bdg https://expired.badssl.com/ --timeout 5
echo $?  # 0
# title reported: "Privacy error"
```

**Actual:** Exit 0, "Session started" logged, status reports the original URL and a chrome-error title.
**Expected:** bdg should surface main-frame navigation failures (`Page.frameStoppedLoading` with `errorText`, or `Page.navigate` returning an errorText on the `Page.frameStartedLoading` → `Page.lifecycleEvent`) and exit 80 (INVALID_URL) or a new code.
**Impact:** Any monitoring/automation that starts bdg against a broken URL gets a successful exit and happily carries on.

### C6. `bdg network list --json` uses deceptive field names

**Repro:**
```bash
bdg https://httpbin.org/forms/post
# …submit a form so there is a POST…
bdg network list --filter method:POST --json | jq '.data | {requests: (.requests|length), filtered: (.filtered|length)}'
# { "requests": 6, "filtered": 1 }
```

**Actual:** `.data.requests` is the **unfiltered** list; the filtered subset sits at `.data.filtered`. Same holds for `--last N`: `requests` is full, `filtered` is the slice.
**Expected:** `requests` should be the final (filtered + sliced) result — that's what a consumer expects when they pass `--filter`. Put the full list behind `allRequests` (or drop it) and populate `total` (currently always `null`).
**Impact:** Any agent that reads `.data.requests` after applying `--filter` gets wrong answers without any signal. Silent JSON-contract violation.

### C7. Parallel `bdg dom query` is racy — returns 0 matches non-deterministically

**Repro:**
```bash
bdg https://developer.mozilla.org/en-US/docs/Web/JavaScript
for round in 1 2 3; do
  for i in 1 2 3 4 5; do
    bdg dom query "h1" --json > "r${round}-${i}.json" &
  done
  wait
done
for f in r*.json; do jq -r '.data.count' "$f"; done
```

Across 3 rounds × 5 parallel queries, observed `0`s interleaved with `1`s:
```
r1: 1 1 0 0 1
r2: 1 0 1 0 1
r3: 0 0 1 1 1
```

Parallel `network list` and `console` were stable in the same rounds. The race is in the DOM query path (cache? document-root attach?).
**Impact:** Agents fanning out queries can get false negatives and act on them. Bug #23 in the previous report flagged this once; now it reproduces reliably under load.

### C8. `bdg --chrome-ws-url <unreachable>` dumps raw worker stderr

**Repro:**
```bash
bdg https://example.com --chrome-ws-url "ws://127.0.0.1:9999/devtools/page/x" --timeout 5
echo $?  # 106 (WORKER_START_FAILURE) — exit code is correct
```

**Actual stderr** (exit 106):
```
Error: Daemon error: Worker process exited before sending ready signal (code: 1, signal: null)
stderr: [worker] Starting (PID 16188)
[worker] Config: {"url":"https://example.com","port":9222,"telemetry":["dom","network","console"],…,"chromeWsUrl":"ws://127.0.0.1:9999/…"}
[worker] Connecting to existing Chrome instance...
[worker] WebSocket URL: ws://127.0.0.1:9999/devtools/page/x
[worker] Using external Chrome (no PID - not managed by bdg)
[worker] WebSocket closed: 1006 - 
[worker] Chrome connection lost (code: 1006, reason: )
```

The exit code is fine; the stderr output is raw worker log spew (internal config, `[worker] …` tags, WebSocket codes). Scriptable consumers have to parse past implementation detail to know "could not reach that WebSocket".
**Expected:** one-line user-facing error (`Error: could not connect to Chrome at ws://…:9999 (connection refused)`) + `--json` envelope; move the worker log to debug.

---

## 🟡 Significant issues

### S1. `bdg status` writes `Error: Error: Daemon not running` (double prefix)

**Repro:** any state that previously had a daemon but no longer does (e.g. after `kill -9` on the daemon):
```bash
bdg example.com; kill -9 $(cat ~/.bdg/daemon.pid)
bdg status 2>&1 | head -1
# Error: Error: Daemon not running
```

The error payload already contains `Error: ` and the formatter prepends another `Error: `. Also visible in JSON:
```bash
bdg status --json | jq -r '.error' | head -1
# Error: Daemon not running
```
The `error` field in JSON should be plain `"Daemon not running"`; human output should not double-prefix.

### S2. `bdg details network <bogus-id>` and `details console <n>` exit 104 (UNHANDLED_EXCEPTION)

```bash
bdg details network BOGUS123;  echo $?  # 104
bdg details console 999;       echo $?  # 104
bdg details console abc;       echo $?  # 104
```
The semantic code is 83 (RESOURCE_NOT_FOUND). 104 means "bdg crashed", which misleads operators.
Additional glitch: when no console messages exist, the range string is `"available: 0--1"` — should be `"no console messages captured"`.

### S3. `dom eval` user-script errors exit 110 (SOFTWARE_ERROR)

```bash
bdg dom eval "throw new Error('x')";   echo $?  # 110
bdg dom eval "Promise.reject('x')";    echo $?  # 110
bdg dom eval "return 1";               echo $?  # 110 (syntax error)
bdg dom eval "noSuch.x";               echo $?  # 110
```
`110` is defined as "Generic software error (use specific codes when possible)". A user-provided script throwing is not a bdg software error — it's the user's own code running. Map to 81 (INVALID_ARGUMENTS) or add an `EVAL_RUNTIME_ERROR` code so operators can distinguish "bdg crashed" from "my script threw".

### S4. `dom eval` error hint recommends a nonexistent `--file` option

```
Tips:
  - Use single quotes around script: bdg dom eval '...'
  - For complex scripts, use heredoc or --file option
```
`bdg dom eval --file script.js` → `error: unknown option '--file'`. Either add the option or remove the tip.

### S5. `bdg peek --last` range error message is inaccurate

```bash
bdg peek --last 0      # "Error: Invalid value: \"0\" is not a valid integer"  exit 81
bdg peek --last 99999  # same message                                           exit 81
bdg peek --last abc    # same message                                           exit 81
```
`0` and `99999` ARE integers. The message should be "out of range (1–1000)". The example `Example: --value 1` also uses a nonexistent flag name — should be `--last`.

### S6. `dom get`, `screenshot --index` suggestion shows negative upper bound when empty

```bash
bdg dom get 999
# Error: Index 999 out of range (found 0 nodes)
# Use an index between 0 and -1   ← negative upper bound is gibberish
```
When the range is empty, say "no cached results — run `bdg dom query <selector>` first" rather than "0 and −1".

### S7. `network list --verbose` is a no-op

```bash
diff <(bdg network list) <(bdg network list --verbose)
# empty
```
Help text promises "Show full URLs and additional details". Either implement or remove.

### S8. `network getCookies --json` shape is inconsistent with the rest of the API

```json
{ "version": "0.7.2", "success": true, "data": [ {…cookie…}, {…} ] }
```
Every other `--json` command uses `data: {…}` with named fields. Cookies should live at `data.cookies: [...]`. Scripts parsing `.data.cookies` get `undefined`.

### S9. `bdg cleanup` spawns a daemon to do cleanup

```bash
rm -rf ~/.bdg/*
bdg cleanup
# [bdg] Starting daemon...
# [bdg] Daemon started successfully
# No session files found. Session directory is already clean
```
This regresses the spirit of the previous fix for `status` / `stop` (issue #14). Cleanup should not spawn a daemon just to report there's nothing to do.

### S10. `dom submit` without cache / without match exits 0

```bash
bdg example.com
bdg dom submit 0      # "No cached query results found"   exit 0
bdg dom submit "#no"  # "Element not found"               exit 0
```
Should exit 87 and 83 respectively (consistent with `dom click`, which does).

### S11. `screenshot --index 0` fails with "Failed to get element bounds" + exit 0

Observed on `form` element after `bdg dom query "form"` — the element is on-screen:
```bash
bdg dom query "form"
bdg dom screenshot --index 0 shot.png
# Error: Failed to get element bounds
# Element may not be rendered or visible   exit 0
```
Note: `bdg dom screenshot --selector form shot.png` against the same element works. Either the cached nodeId is lost, or the bounds lookup is using the wrong target.

### S12. `dom query` with syntactically invalid CSS silently returns "no matches"

```bash
bdg dom query "###"   # No nodes found   exit 0
bdg dom query "🦄"     # No nodes found   exit 0
```
Browsers throw `SyntaxError: '###' is not a valid selector`. Treating it as "zero matches" hides user error. Catch the exception at the boundary and exit 81.

---

## 🟠 Minor issues

### M1. CDP help drift
`bdg cdp --help` says "53 domains"; `bdg cdp --list` returns 54. Pick one.

### M2. `bdg cdp --list` auto-emits JSON without `--json`
Every other command requires `--json`. Convenient but inconsistent.

### M3. Conflicting flags silently accepted
- `bdg <url> --headless --no-headless` → last one wins, no warning.
- `bdg <url> --quiet --debug` → debug wins, `--quiet` discarded.
- `bdg dom scroll --top --down 500` → `--top` wins silently.

At minimum, warn. Arguably, exit 81.

### M4. `dom scroll --bottom` reports `Position: (0, 0)`
The "Position" is the input, not the resulting scroll position. Should read the post-scroll `window.scrollY` / `scrollTop`.

### M5. Different JSON shapes for `console` vs `console --list`
```
console        --json → data.{success, summary, errors, warnings}
console --list --json → data.{success, summary, errors, warnings, messages}
```
Tolerable but the `messages` field could always be present (empty when not requested) to simplify consumers.

### M6. `stop --json` exposes `chrome: false` when `--kill-chrome` not set
Reads as a failure. Rename field or add an explanation.

### M7. `--compact` global flag doesn't compact `--json` output of commands
Help says "compact JSON … for output files" — undocumented that CLI JSON is unaffected.

### M8. `bdg --version --json` returns `0.7.2`, not the `{version, success, data}` envelope
Trivially inconsistent.

### M9. Chrome user-data-dir persists between sessions in same cwd
After a form POST, `bdg stop && bdg https://httpbin.org/forms/post` from the same directory reopened to `/post` instead of `/forms/post` for a few seconds. Likely Chrome session restore using the persisted `chrome-profile`. Worth warning users or passing `--disable-session-crashed-bubble` + a clean profile each time.

### M10. `tail` and `peek --follow` appear functionally identical
`tail --help` describes the tool but the output stream is indistinguishable from `peek --follow`. If they are aliases, document it; if they differ, the difference isn't visible.

### M11. `network list --json`: `total` is always `null`
Unused field. Drop it or populate it.

### M12. `network headers` / `details network` body formatting
`network headers <id>` puts the hint line **before** the divider — looks like part of the heading. Minor cosmetic.

### M13. Stale session warning when restarting in directory that had a prior session
`bdg cleanup` sometimes logs "`[cleanup] Killing cached Chrome process NNN (stale session cleanup)`" even right after a clean `bdg stop`. Suggests the pid-file cleanup races with the stop.

---

## ✅ What works well

- **Radio/checkbox click-by-index is fixed**: `bdg dom click 4` on httpbin's pizza form correctly hits `[value="medium"]`, not `[value="small"]`. Verified through the POST body captured by `bdg details network <id>`.
- **Form submit navigation detection** now reports `Navigation: yes` when the page navigates, and `bdg status` reflects the new URL within a few seconds.
- **`--last N`** on `bdg network list` no longer caps at 10 — returned all 80 requests on MDN, JSON envelope in sync with human output.
- **`dom form --brief`** now shows filled values and checked state (good for quick agent verification).
- **`a11y`** bare search matches partial names (`bdg dom a11y Pizza` returns six hits including the Group headings).
- **`dom eval`** on plain string returns unquoted value (`bdg dom eval "document.title"` → `Example Domain`, no wrapping quotes).
- **`console` summary + `--level`**: filtering to `info` suppresses the error/warning summary; `%c`, `%s`, `%d` substitutions work.
- **CDP typo suggestions** are excellent: `Runtime.invalidMethod` → "Did you mean: Runtime.evaluate, Runtime.enable".
- **Unknown top-level command** (`bdg xyzzy`) now exits 80 with actionable hint, rather than launching a Chrome against the typo.
- **Unknown options** and **missing required args** consistently exit 81 across subcommands (verified on `status --nope`, `details`, `details network`, `dom click`, etc.).
- **HAR export** preserves all requests and accepts `--filter`.
- **Extra positional args** after most subcommands correctly exit 81.

---

## Prioritized recommendations

1. **Fix silent-success on unreachable/error pages (C5).** Detect main-frame navigation failure (`Page.frameStoppedLoading` with `errorText`, or `Page.navigate` response's `errorText`) during session start and exit 80. Currently `bdg http://127.0.0.1:1/` and `bdg https://expired.badssl.com/` return 0.
2. **Catch `CommandError` from `buildSessionOptions` (C2).** The `collectorAction` call in `src/commands/start.ts:226` is outside the validation try/catch; `maxBodySizeRule.validate(...)` escapes as an unhandled Node exception. Wrap `collectorAction` the same way `assertValid*` calls are wrapped. Also fix the "Example: --value 1" template to use the actual flag name.
3. **Stop the `while(true)` foot-gun (C3).** Pass CDP's own `timeout` to `Runtime.evaluate`, and call `Runtime.terminateExecution` on timeout so subsequent calls recover. Map the timeout to exit 102 (CDP_TIMEOUT) with a script-aware message.
4. **Reject empty/negative selectors at the boundary (C4).** In the dom-command action handlers, `throw new CommandError(... INVALID_ARGUMENTS)` on `""`, whitespace, or numeric `<0`. Remove the "Troubleshooting" block that self-references the broken call.
5. **Rename the network-list JSON fields (C6).** `data.requests` should be the final (filter + slice) result. Move the unfiltered list behind `allRequests` or drop it. Populate `total` or remove it. Add a test that `data.requests.length` matches the human "last N of M" header.
6. **Sanitize `--chrome-ws-url` worker-failure output (C8).** Replace the multi-line worker-log dump with a one-line user-facing error; route the raw worker stderr to debug. Exit code is already correct (106).
7. **Investigate the parallel `dom query` race (C7).** 3/3 rounds showed non-deterministic 0/1 counts for `h1` on MDN; network / console parallel calls were stable. Likely in the query-cache write path or in `Runtime.callFunctionOn` against a document root that's invalidated mid-flight. Needs a unit-test-level repro before fixing.
8. **Normalize `status` error prefix (S1).** Strip the `Error: ` prefix inside the error payload *or* don't re-prepend in the formatter — right now both happen.
9. **Map "not found" errors to semantic codes (S2, S3, S10).** `details network/console <bogus>` → 83 (RESOURCE_NOT_FOUND). `dom eval` user-script throws → 81 (or new `EVAL_RUNTIME_ERROR`). `dom submit` misses → 83/87 (match `dom click`). Reserve 104/110 for actual bdg bugs.
10. **Clean up validation-message wording (S5, S6, S4).** `peek --last 0` should say "out of range (1–1000)" not "not a valid integer"; remove the "--file option" hint from `dom eval` (doesn't exist); the `--value` placeholder in `positiveIntRule` error messages should use the real flag name.
11. **Audit flag drift (S7, M1, M2, M7, M10, M11).** `network list --verbose` is a no-op; CDP help says 53 domains but lists 54; `--compact` doesn't affect `--json` CLI output; `tail` and `peek --follow` appear identical; `network list --json` has a perpetually-null `total`. Document or fix — pick one.
12. **Fix JSON contract drift (S8, M5, M8).** `getCookies --json` should be `data.cookies: [...]`; `console` vs `console --list` JSON shapes should be unified; `--version --json` should emit the standard envelope.
13. **Drop the daemon spawn from `bdg cleanup` (S9).** Same spirit as the earlier status/stop fix (#14). Inspect `~/.bdg/` directly.
14. **Treat invalid CSS selectors as errors (S12).** `dom query "###"` should exit 81, not silently "no matches". Catch `DOMException: SyntaxError` at the worker boundary.
