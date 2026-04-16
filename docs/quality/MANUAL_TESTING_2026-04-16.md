# BDG Manual Testing Report

**Version:** 0.7.2
**Date:** 2026-04-16
**Platform:** macOS (Darwin 24.6.0)

## Test Methodology

All commands tested in isolated daily-task scenarios using:
- `example.com` (minimal static page)
- `httpbin.org/forms/post` (form interactions)
- `developer.mozilla.org` (complex SPA with analytics/telemetry)
- Various invalid inputs for error-handling coverage

Artifacts: `/tmp/bdg-test-report/` (screenshots, HARs)

---

## Commands Exercised

| Command | Sub-commands / Flags tested |
|---|---|
| `bdg <url>` | Start session; `--all`, `--quiet`, invalid URLs |
| `bdg status` | Default, `--json`, `--verbose` |
| `bdg stop` | Default, `--json`, `--kill-chrome` (implicit), no-session |
| `bdg cleanup` | Default, `--json` |
| `bdg peek` | `--json`, `--verbose`, `--network`, `--console`, `--dom`, `--last`, `--follow` |
| `bdg tail` | Default, `--help` |
| `bdg details` | `network <id>`, `console <idx>`, invalid type, out-of-range |
| `bdg dom query` | Selectors, `*`, invalid selectors, empty string |
| `bdg dom get` | Selector, index, `--raw`, `--json` |
| `bdg dom eval` | Simple, object, promise, throw, syntax error |
| `bdg dom a11y` | `tree`, `query role:*`, `describe` |
| `bdg dom form` | Default, `--brief`, `--all`, `--json` |
| `bdg dom screenshot` | Full page, `--selector` |
| `bdg dom fill` | Index, selector, invalid selector |
| `bdg dom click` | Index, selector, radio (by index) |
| `bdg dom submit` | Form submission |
| `bdg dom pressKey` | Tab key |
| `bdg dom scroll` | `--bottom`, `--top`, `--down`, selector |
| `bdg network list` | `--filter`, `--preset`, `--type`, `--last`, `--json` |
| `bdg network har` | Export |
| `bdg network getCookies` | Default, `--json` |
| `bdg network headers` | Valid ID, invalid ID, missing ID |
| `bdg network document` | Default |
| `bdg console` | Default, `--list`, `--level`, `--json` |
| `bdg cdp` | `--list`, `--search`, `--describe`, execution (valid/invalid) |

---

## 🔴 Critical Bugs

### 1. Form index click hits wrong element (multi-match selectors)
Clicking a radio/checkbox by form index targets the first element matching its `name` attribute, not the actual indexed element.

**Repro:**
```bash
bdg httpbin.org/forms/post
bdg dom click 4     # Form index 4 is radio "Medium"
bdg dom form        # Shows [3] Small = checked, not [4] Medium
```

The click output reports `Selector: input[name="size"]` — the resolver used only the `name` attribute, which matches all three size radios. Happens for all grouped inputs (radios + same-name checkboxes).

**Workaround:** use a CSS selector with `[value=...]`.

**Impact:** Major — breaks the primary "click by index" UX advertised by `bdg dom form`.

### 2. `bdg network list` silently caps at 10 requests
Regardless of `--last` value (tested 5, 50, 100, 500) or `--all`, the response is hard-capped at 10 entries even though session captured 80+ and HAR exports all 80.

```bash
bdg status --json | jq .data.activity.networkRequestsCaptured   # 80
bdg network list --last 500 --json | jq '.data.requests | length'  # 10
bdg network har x.har                                           # "Exported 80 requests"
```

**Impact:** Major — analysts using `network list` for auditing get a silently truncated view. The `(last 5 of 10)` header is also misleading (total is actually 80).

### 3. `bdg <unknown-command>` silently attempts to start a session
Typos at the top level are interpreted as URLs:
```bash
bdg unknown
# → tries to start a new Chrome session targeting "unknown"
# → only the pre-existing-session guard prevented a new browser launch
```
Dangerous for users and agents; there's no "unknown command" hint.

### 4. Stale URL in `bdg status` after in-page navigation
After JS-navigating to a new page within the same session, `bdg status --json` still returns the old `pageState.url` and `title`. CDP `Runtime.evaluate location.href` confirms the page actually changed.
```bash
# navigate from /JavaScript to /Array
bdg status --json | jq .data.pageState.url   # still .../JavaScript
bdg cdp Runtime.evaluate --params '{"expression":"location.href"}'  # .../Array
```
**Impact:** Agents relying on status to verify navigation get wrong answers.

### 5. `bdg network document` returns favicon, not the main document
On `httpbin.org/post`, `network document` returned the `favicon.ico` 404 request, not the HTML document. Probably iterates in wrong order or uses the last request matching a loose type filter.

### 6. `bdg network headers` with **no argument** returns random request
No error; it just prints some request (in my test, `favicon.ico`). Required argument is not enforced.

### 7. Form submit reports `Navigation: no` when navigation did occur
`bdg dom submit 12` on httpbin form POSTed and navigated to `/post`, but output said `Navigation: no`. Only 1 network request was counted for the submission.

---

## 🟡 Significant Issues

### 8. Exit-code inconsistencies
- `bdg unknown-flag` → exit **1** (should be **81** INVALID_ARGUMENTS).
- `bdg details` (missing required arg) → exit **1**.
- `bdg cdp Runtime.evaluate` (missing params) → exit **104** (CDP error), should be **81**.
- `bdg "not a url!"` prints error but exits **0**.
- `bdg <url>` while a session exists prints "Error:" but exits **0** (should be non-zero, e.g., 84).

### 9. `--json` flag doesn't silence human-oriented stderr
`bdg status --json` with no session prints `Error: No active session found\nStart a session first...` to stderr in addition to JSON. For an automation-first flag this should be pure machine output.

### 10. `status --json` says `success: true` while stderr says "Error:"
`bdg status --json` without a session returns `{"success": true, "active": false}` but stderr emits `Error: No active session found`. The JSON envelope contradicts the human-readable error.

### 11. Suggestions reference commands that don't exist
- `bdg status` footer suggests **`bdg query <script>`** — no such top-level command; it's `bdg dom eval`.
- `bdg status` (empty state) suggests **`bdg tabs`** — no such subcommand exists.
- Several "Next steps" from `dom query` suggest `bdg details dom 0`; the actual command is `bdg dom get 0`.

### 12. `bdg dom a11y` (bare) prints help instead of dumping the tree
The help text says the `search` argument is optional and even describes what bare-mode does, yet running with no argument just prints the help. Either the default behavior should match the description or the arg should be required.

### 13. `bdg dom a11y "Example"` fails on partial-name search that should match
Searched "Example" on example.com where a heading is "Example Domain". Reply:
```
Error: No nodes found matching pattern
Pattern: name:*Example*.
```
The wildcard expansion is correct, the node exists — suggests the matcher isn't checking subrole/child text. `bdg dom a11y query "name:Example Domain"` likely would work, but the shorthand doesn't.

### 14. `bdg status` / `bdg stop` start a daemon just to report "no session"
Running those commands on a clean system spins up and immediately tears down a daemon process. Wasteful and slow.

### 15. `bdg peek --console` (no console msgs) prints only the header + "Tip" — no "(none)" marker
Compare with `--dom` which prints `DOM: (none)`. Inconsistent feedback.

### 16. `bdg peek --dom` still prints the Network section
Filter flags don't actually filter — they add sections rather than restrict output.

### 17. `--quiet` only affects session start, not other commands
`bdg --quiet status` still emits the full tabular output.

### 18. `bdg dom form --brief` doesn't show filled values or checked state
`--brief` strips the "Value" column entirely, so you can't quickly verify fill/click operations. Defeats the point of a quick-state summary.

### 19. Double colons in `network headers` output
```
access-control-allow-credentials::true
Referer::                  https://httpbin.org/forms/post
```
Formatting bug — single colon expected.

### 20. `console %c` directives rendered as raw text
MDN's `%cairgap.js%c Report-only mode enabled font-size:larger;...` — CSS format args are concatenated into the message text rather than stripped or applied. Poor readability.

### 21. Console `--level info` still shows summary "No errors or warnings"
When filtering to one level, the summary should either adapt or be suppressed. Currently it always prints the error/warning summary.

### 22. Invalid/empty CSS selectors return exit 0
`bdg dom query ""` and `bdg dom query "###"` both print "No nodes found" with exit 0. For empty strings especially, this should be a usage error (exit 81).

---

## 🟠 Minor Issues

### 23. Race in parallel DOM queries
Three parallel `bdg dom query` / `bdg network list` calls on example.com produced one "No nodes found matching 'h1'" even though h1 exists. Reproduced once, not consistently. Likely a query cache or target-selection race.

### 24. Peek deprecation notice is shown but command still works
`bdg peek --network` prints `Note: "bdg peek --network" is deprecated. Use "bdg network list"...` then happily executes. Fine, but the deprecation has been around long enough to consider a hard error if it's been deprecated more than one release.

### 25. `bdg dom eval` uses quoted JSON strings for simple results
`bdg dom eval "document.title"` → `"Example Domain"` (with quotes). Agents parsing have to strip quotes vs. non-string returns. Consider `--raw` to match `dom get --raw`.

### 26. Help-output noise on successful start
Session-start output is 50+ lines of helper text, which dominates CLI logs. Could be collapsed behind `--verbose` / `--help-after-start`.

### 27. Confusing error message for stale DOM cache
```
Re-run "bdg dom query cached query" to refresh the cache
```
"cached query" reads as a literal argument name; should be `bdg dom query <your-selector>`.

### 28. `bdg network list --filter method:POST` shows "last 1 of 4" but "last 0 of 10" when empty
When a filter matches nothing, it prints `last 0 of N` which is confusing. Just say "no matching requests".

### 29. The `bdg --help` top-level line suggests using URL as the default command — but combining a command plus a URL conflicts silently
E.g. `bdg https://example.com status` is accepted as URL only; `status` is ignored. No error.

---

## ✅ What Works Well

- **Core session lifecycle** (start/status/stop/cleanup) — reliable.
- **CDP discovery**: `--list`, `--search`, `--describe` are excellent.
- **CDP execution** with case-insensitive method names and helpful hints ("Consider using `bdg network getCookies` instead of...").
- **Form discovery** (`bdg dom form`) — rich, human-readable, exactly what agents need.
- **A11y tree / a11y query** — works well for `role:*` patterns.
- **HAR export** — captures all 80+ requests faithfully.
- **Screenshot** — full page, element selector, file write all worked on first try.
- **DOM eval** — clean handling of promises (auto-await), errors with stack traces.
- **Detailed error suggestions** in JSON envelope (`exitCode`, `suggestion`) — great for agents.
- **`bdg dom form --brief` index table** pairs well with `dom fill N "value"` for text inputs.
- **Typo detection**: `Runtime.invalidMethod` → "Did you mean Runtime.evaluate?" — very nice.

---

## Daily-Task Scenarios — Actual Output Summary

| Task | Command Used | Worked? |
|---|---|---|
| Read page title | `bdg dom eval "document.title"` | ✅ |
| Take screenshot | `bdg dom screenshot out.png` | ✅ |
| Count links on MDN | `bdg dom eval "document.querySelectorAll('a').length"` → 602 | ✅ |
| Extract h2 headings | `bdg dom query "h2"` | ✅ |
| Find form fields | `bdg dom form` | ✅ |
| Fill text input by index | `bdg dom fill 0 "John Doe"` | ✅ |
| Select radio by index | `bdg dom click 4` (Medium) | ❌ Hit "Small" |
| Check a checkbox by index | `bdg dom click 6` (Bacon) | ✅ |
| Submit form | `bdg dom submit 12` | ✅ POSTed, ❌ "Navigation: no" wrong |
| Export HAR | `bdg network har x.har` | ✅ |
| List network errors | `bdg network list --preset errors` | ⚠️ capped at 10 |
| Find failed requests | `bdg network list --filter status-code:404` | ⚠️ capped at 10 |
| Inspect POST body | `bdg details network <id>` | ✅ |
| Monitor console live | `bdg tail` | ✅ |
| Get main document info | `bdg network document` | ❌ returned favicon |
| Navigate via JS | `bdg dom eval "location.href = '...'"` | ⚠️ status didn't update |
| Check page after nav | `bdg status` | ❌ stale URL |
| Discover CDP methods | `bdg cdp --search cookie` | ✅ |
| Run raw CDP call | `bdg cdp Runtime.evaluate --params '{}'` | ✅ |
| Clean up | `bdg stop && bdg cleanup` | ✅ |

---

## Recommended Priorities

1. **Fix radio/checkbox `click-by-index` resolver** — regressed UX for a primary workflow.
2. **Fix `network list` 10-item cap** — critical for debugging.
3. **Fix stale `status` after navigation** — breaks verification flows.
4. **Make `bdg <unknown>` error out instead of treating typos as URLs**.
5. **Standardize exit codes**: wire Commander `unknown option/missing arg` through the existing `EXIT_CODES.INVALID_ARGUMENTS` (81).
6. **Fix `network headers` / `network document`** argument validation & target selection.
7. **Strip stale command suggestions** (`bdg query`, `bdg tabs`, `bdg details dom`).
8. **Correct the "double colon" header formatting**.
9. **Honor `--json` / `--quiet` strictly**: no human-readable stderr when JSON requested.
