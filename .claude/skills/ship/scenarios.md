# Fresh-agent test scenarios

## Contents
- Running a round
- Report format
- Scenarios S01–S14
- Exploratory sweep

A fixed list of tasks for fresh-agent test rounds, so rounds can be compared over time. A fresh agent is a new agent with no context about bdg's internals: it gets a realistic task and an installed `bdg`, and is **not told which feature is being tested**. What it discovers, works around and rates shows how agent-friendly bdg is; unit, smoke and integration tests don't catch false successes, misleading hints or friction.

Every feature or behaviour-change PR runs the scenarios that touch its area on the PR branch, before merge (tiny fixes and docs are exempt). Keep the scenario IDs stable; when a scenario changes, note the date in its **History** line so older ratings aren't compared with a different task.

## Running a round

1. **Build the branch** in its worktree (Node pinned, see Environment in `SKILL.md`):
   ```bash
   export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"
   npm run build
   alias bdg="node $PWD/dist/index.js"     # for your own manual runs; give agents the full command
   ```
   Agents run `node <worktree>/dist/index.js`, never a globally linked `bdg` (it may be another version). Don't rebuild a `dist` other agents are using.
2. **Isolate the session directory**: every agent gets its own `BDG_SESSION_DIR=/tmp/bdg-round-<date>-<agent>` (short: socket paths have a length limit). Never use `~/.bdg`.
3. **Start the fixtures** when a scenario uses them, and pass the printed URLs to the agents:
   ```bash
   npx tsx src/__testutils__/serveFixtures.ts    # fixture server + blocked cookie servers; Ctrl-C stops them
   ```
   The pages are the smoke test fixtures (`src/__testutils__/fixtureServer.ts` and `fixturePages/`), so a scenario and its smoke test see the same page.
4. **Snapshot `~/Downloads`** before the round, and compare after it; nothing may appear there:
   ```bash
   ls -A ~/Downloads > /tmp/downloads-before.txt
   # ... round ...
   ls -A ~/Downloads | diff /tmp/downloads-before.txt - && echo "Downloads untouched"
   ```
5. **Brief the agents** with the scenario's task text only (the **Task** line), the bdg command, the session directory and, for fixtures, the URL. Don't mention the feature, the issue or the expected output. Screenshots are allowed. Run at most 4 agents in parallel, and not while implementers' suites are running: each agent runs its own Chrome, and smoke tests flake under that load.
6. **Interrupts**: to test Ctrl-C, send SIGINT to the `node` PID of that bdg command directly (`kill -INT <pid>`), not through a shell function or a process group. Kill only PIDs you started; no `pkill`/`killall`.
7. **Clean up**: `bdg stop` in each session directory (`BDG_SESSION_DIR=… node dist/index.js stop`), stop the fixture server, remove the `/tmp/bdg-round-*` directories once the reports are in.

Pair each round with your own manual runs of the same scenarios: agents report friction, you check correctness.

## Report format

Each agent answers per scenario:

```markdown
## S05 JS dialogs on load and on click
- Result: works | partly | broken
- Ease: 7/10
- Commands: 9 (bdg 7, dom eval 1, screenshots 1)
- Bugs: wrong or false output, with the command and what it printed
- Friction: what was slow, confusing or needed a workaround (eval, screenshots, sleep loops, raw CDP)
- Discovery: how it found the right command (help, --help --json, an error's suggestion, a hint)
```

The round summary (`.tmp/<round>/SUMMARY.md`, untracked) has the branch and commit, a table per scenario (result, ease, eval/screenshot counts) next to the previous round's, and the findings in priority order. Every finding is fixed in the PR or filed as an issue.

## Scenarios

Each scenario has an ID, the task given to the agent, how to set it up, what "works" looks like, and what to rate.

### S01 OAuth-like popup

- **Task:** "Sign in on this page. The sign-in window posts a token back to the page; tell me the token the page shows."
- **Setup:** fixture `/tabs`. `#open-popup` opens `/tabs-popup` with `window.open()`; its button posts `token-123` to the opener and closes the popup.
- **Works:** the click reports the popup it opened (`Opened: popup … (bdg page switch 1)`); the agent switches, clicks, and the action says the tab closed and the session is back on the opener; `#token` reads `token-123`. No stuck session on a closed tab.
- **Rate:** whether the agent found `page switch` from the action output alone, and whether the closed-popup return was clear.
- **History:** from #453 / #557.

### S02 MDN search modal

- **Task:** "On developer.mozilla.org, search for `Array.prototype.flat` with the site's search box and open the first result."
- **Setup:** real site <https://developer.mozilla.org/en-US/>. The search form is rendered in a shadow root only after the Search button is clicked (fixture equivalent: `/shadow-forms`, `#open-search` and `<x-search-modal>`).
- **Works:** `dom fill` reaches the field in the shadow root and the site's `inputType` handlers don't throw; results appear (`Shown:`); the first result opens. No `dom eval` needed to type.
- **Rate:** number of `dom eval` calls and screenshots; whether `dom form` or `dom query` found the field.
- **History:** from #552, #456.

### S03 bbc.com/news noise

- **Task:** "Load bbc.com/news and tell me which requests failed and whether the page logged real errors."
- **Setup:** real site <https://www.bbc.com/news>.
- **Works:** `bdg console` separates page errors from Chrome Issues noise (cookie and third-party warnings); `network list` stays a readable size (paged/bounded, with the counts explained); failed requests are identifiable without dumping the whole list.
- **Rate:** output size (lines / tokens) of `console` and `network list`; whether the agent trusted the answer.
- **History:** from #492, #451.

### S04 Forms in shadow DOM

- **Task:** "Log in on this page with user `ada` and PIN `1234`, then subscribe `ada@example.com` to the newsletter."
- **Setup:** fixture `/shadow-forms`: a login form in an open shadow root, a newsletter form two shadow roots deep, a field component (`<x-field>`), a closed shadow root (`<x-vault>`).
- **Works:** `dom form` lists the shadow forms; `dom fill` and `dom submit` work by label or selector; the closed root is reported as not reachable instead of failing silently.
- **Rate:** whether `dom form` was used and trusted; workarounds for shadow roots.
- **History:** from #456.

### S05 JS dialogs on load and on click

- **Task:** "Click Delete on this page but cancel the confirmation, then rename the item to `Berlin`. Then open the second page and tell me what it asked while loading."
- **Setup:** fixture `/dialogs` (confirm, prompt, prompt with default, alert, a beforeunload guard) and `/dialogs-load` (a confirm while loading).
- **Works:** `--dialog dismiss` and `--prompt-text` answer the action's dialogs; results list `Dialog: confirm() dismissed: "Sure?"`; the load-time confirm is reported by `bdg <url>` / `page navigate`; nothing hangs on an unanswered dialog.
- **Rate:** whether the agent found `--dialog` without trial and error; clarity of the dialog lines.
- **History:** from #450, #553.

### S06 Blocked cookies

- **Task:** "This page logs in with cookies but the session doesn't stick. Find out why."
- **Setup:** blocked cookie fixtures from `serveFixtures.ts`: open the **seed** URL first (stores a `SameSite=Lax` cookie for `localhost`), then the **page** URL, which sets `SameSite=None` without `Secure` over http and a cookie for another domain, and fetches the API cross-site.
- **Works:** `details network` names the blocked cookies and the reason (SameSite=None without Secure, domain mismatch, Lax not sent cross-site); no cookie value is printed.
- **Rate:** whether the agent reached the reason without raw CDP; whether any value leaked.
- **History:** from #493.

### S07 Auth state save, stop, `--state`

- **Task:** "Log in, then restart the browser session and continue where you left off without logging in again."
- **Setup:** real site <https://the-internet.herokuapp.com/login> (`tomsmith` / `SuperSecretPassword!`; the session cookie has no Expires), or a page that stores a token in localStorage and sessionStorage. The smoke fixture is in `src/__tests__/smoke/auth-state.smoke.test.ts`.
- **Works:** `bdg state save <file>` → `bdg stop` → `bdg <url> --state <file>` is still logged in; output shows counts and origins, never values; the file is 0600.
- **Rate:** whether the agent found `state save` / `--state` from help; whether it put the file somewhere safe.
- **History:** from #454.

### S08 Ctrl-C during start, screenshot and `page switch`

- **Task:** "Start a session on this slow page, give up after a few seconds, and start again on the home page. Then take a full-page screenshot and interrupt it, and interrupt a tab switch."
- **Setup:** fixture `/slow` (answers after 8 s); `/tabs` for a second tab. Interrupt with `kill -INT <node pid>` (see Running a Round).
- **Works:** each interrupted command exits 130 with a `--json` envelope; nothing half-started is left (`bdg status` is clean or the session is usable); the next start works without `bdg cleanup`; the screenshot leaves the page layout as it was.
- **Rate:** whether the agent needed `cleanup` or `--force`; clarity of the interrupted messages.
- **History:** from #557 and the startup interruption fixes.

### S09 CDP event collection

- **Task:** "Record a performance trace of clicking the button on this page into a file. Then make the page's API call return a mocked response."
- **Setup:** fixture `/` (calls `/api/test`) or `/effects`; any page with a fetch.
- **Works:** trace: `bdg cdp Tracing.start` … `bdg cdp Tracing.end --collect Tracing.dataCollected --until Tracing.tracingComplete --out trace.ndjson` writes the events. Mock: the Fetch recipe (`Fetch.enable --listen Fetch.requestPaused`, `--events`, `Fetch.fulfillRequest`) answers the paused request; paused requests are named as such, not as a hang.
- **Rate:** whether the agent found `--collect` and the recipe (help, `--describe`, hints); how many raw CDP attempts it took.
- **History:** from #452.

### S10 Downloads

- **Task:** "Download the report from this page, including the one that opens in a new tab, and tell me where the files are."
- **Setup:** fixture `/downloads` (`#report`, `#report-tab` with `target=_blank`, `#report-window` with `window.open()`, `#slow` held until you request `<fixture url>slow-download/release`, e.g. with `curl`).
- **Works:** each action lists `Download: <name> → <path>` under the session's `downloads/` directory, also for the tab and the popup; the slow one shows `inProgress` and then appears; **`~/Downloads` is unchanged** (diff it).
- **Rate:** whether the agent found the path from the action output; any file outside the session directory.
- **History:** from the downloads work (#453 tabs).

### S11 `network list --page` / `--sort` after navigation

- **Task:** "Open this page, follow the link to the second page, and list the second page's failed requests, slowest first."
- **Setup:** fixture `/frames` (a missing image, a worker) then navigate to `/attributes`; or any real site with two pages.
- **Works:** `network list --preset errors` shows the current page only by default and says how many requests of earlier pages it hid (`--page all` shows them); `--sort duration` puts the slowest first and the header says so. No 404s of the old page reported as current.
- **Rate:** whether the agent trusted the list; output size.
- **History:** from #451.

### S12 Action errors

- **Task:** "Click each button on this page and tell me which ones break something."
- **Setup:** fixture `/action-errors` (`#sync` throws, `#async` throws from a timer, `#rejection` rejects, `#logged` logs errors and a warning, `#many` logs four errors, `#navigate` goes to a page that throws on load).
- **Works:** each click lists the errors it caused (`Errors: …`, `[2x]`, `+N more`), the timer and rejection cases included; warnings and errors from before the action are left out; the click itself still succeeds.
- **Rate:** whether the agent needed `bdg console` or `dom eval` to see the errors.
- **History:** from #449.

### S13 Full-page screenshot scrollbar

- **Task:** "Take a full-page screenshot of this long page, then tell me the page's visible width."
- **Setup:** any long page with a scrollbar (fixture `/layout`, or a real article page).
- **Works:** the screenshot is complete; afterwards `innerWidth - clientWidth` (the scrollbar) and the window size are as before the screenshot.
- **Rate:** whether the agent noticed any layout change; screenshot correctness.
- **History:** from #514, #537.

### S14 Utility-CSS class lists in `dom query`

- **Task:** "On reddit.com, find the link that leads to account registration and tell me its URL and every CSS class on that element, exactly as the page has them."
- **Setup:** real site <https://www.reddit.com> (Tailwind-style class lists, 9 classes on `#signup-button`); or github.com/microsoft/vscode.
- **Works:** `dom query` rows show `class="px-sm +8"` and stay readable (reddit `dom query a` about 4 KB, not 14 KB); the agent reads `+N` as a count, not a class, and gets the full list from `--json` (`classes`) or `dom get` without `dom eval`.
- **Rate:** whether the agent understood `+N` from the help text or the row alone; number of `dom eval` calls used to get the full list.
- **History:** from #460 (2026-10-10).

## Exploratory sweep

The scenarios keep rounds comparable; the sweep finds what they don't cover. Run it regularly: once per working session on `main`, or on a schedule through a cloud routine.

1. **Pick 3–5 real sites** not used in the last sweep, mixing kinds: a news site, a single-page app (React, Vue), a shop with a cart and checkout form, a docs site with search, a login flow, a page with iframes or web components. Keep a list of visited sites in the sweep summary.
2. **Give each agent an open-ended task** per site, the way a user would: "find out why this page is slow", "fill the signup form without submitting it", "check what this page logs and requests when you add an item to the cart". No feature names.
3. **Watch for**: false success (an action claims success but nothing happened), wrong or stale data, outputs too big to read, hints pointing to the wrong command, workarounds (`dom eval`, screenshots, `sleep` loops, raw CDP for something bdg has), leaks (secret values, files outside the session directory, `~/Downloads`), sessions left running.
4. **Report** in the same format (result, ease, bugs, friction), plus "would add to the scenario list?". A finding that should be checked every round becomes a new scenario here (next free ID, with its setup and a History line).
5. **Triage**: every finding is fixed or filed as a verified issue (reproduced, with the command and output).
