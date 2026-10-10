---
name: ship
description: "bdg's shipping workflow: take verified issues from the queue to merged PRs with coding subagents (implementer, fresh reviewer, fresh-agent usage test before merge), with bdg's commands, gates, conventions and fresh-agent test scenarios in one place. Use when the user asks to work through issues, run a session or wave, ship a feature end to end, run a fresh-agent test round or exploratory sweep, or says 'jedziemy w cyklu'."
---

# Ship (bdg)

Everything the orchestrator needs for bdg is in this file: the cycle, the project settings, brief templates, merge gates and the fresh-agent scenarios.

## The cycle

You are the **orchestrator**. You don't write the feature code yourself. You:
- turn issues into briefs;
- run implementer, reviewer and tester agents;
- hold the gates;
- merge;
- report.

The value of this cycle is that each PR gets three independent looks before it lands:
- **Tests the implementer wrote first.**
- **A fresh reviewer** who never saw the implementation.
- **A fresh agent** who uses the change as a real user would.

In practice reviews find real bugs in most PRs, and the fresh-agent test finds the bugs neither tests nor review catch. Skip none of them for behaviour changes.

### 1. Build the queue and the waves

- **Only verified issues go in.** The problem must be reproduced, or confirmed in the code with a file and line. If an issue isn't verified, verify it first or ask.
- **Ask what the session should cover.** Propose 4–6 issues with one line each on why. Recommend one set; don't present a menu.
- **Group into waves of 2–3 parallel implementers.** More than that overloads the machine and the review loop.
  - Issues that touch the same files or output run in sequence. The second one starts from the first one's branch, or after the first merges.
  - Light, conflict-free changes go first. Docs come last, so they describe the final behaviour.
- **Decide merge authority at session start.** Ask whether you may merge on green, or whether the user wants to OK each PR. That decision doesn't carry over to the next session.
- **Product decisions belong to the user.** Changing default behaviour, contracts or exit codes is one. Present the options with a recommendation, then wait.

### 2. Implement

Spawn one implementer per issue, each in its **own git worktree** on its own branch. Use the brief in `references/implementer-brief.md`. The non-negotiables:
- **Test first.** Write a failing test, then make it pass. Prefer a failing test on the old code over reasoning.
- **Before/after evidence.** Show real command output or a measurement, not just "tests pass".
- **Deterministic tests.** Wait on an observable event, never on a sleep. Timing-sensitive tests run N× in CI before merge (see `references/merge-gates.md`).
- **Docs travel with the change:** user docs, help text, the changelog entry, and the agent skill or AGENTS docs.
- **The implementer opens a draft PR** with the full body: what changed, before/after, verification, run IDs, and any decisions it made.
- **Forbidden actions go in every brief:** `git stash` (the stash list is shared across worktrees), broad `pkill`/`killall` (kill only the PIDs you started), and touching the user's real data dirs, other worktrees or the main checkout.

### 3. Review

Once the implementer reports, spawn a **fresh reviewer** with no context from the implementation. Use `references/reviewer-brief.md`. Give it the diff and a list of the risky areas specific to this change, for example:
- races;
- failure and cleanup paths;
- resource leaks;
- security (secrets, file writes, injection);
- contract changes (JSON shape, exit codes, defaults);
- interaction with recently merged features.

Findings come back ranked **blocking / should-fix / nit**, each with a file:line reference and a concrete scenario.

- Send every finding back to the **same implementer**, continuing it so it keeps its context. Each finding gets a test first, then a fix, or an argued rejection. You decide disputes.
- Run a **second review** only when the fix commit is large or risky (rollback logic, file handling, concurrency). Nit-only rounds don't get one.

### 4. Fresh-agent usage test, before merge

This step has the highest yield. Run it for any feature or behaviour change. Skip it only for tiny fixes and docs. Use `references/agent-tester-brief.md`.

- Build the PR branch, then give a fresh agent **realistic tasks** in the product's own terms, not a description of the diff. It should learn the tool the way a new user would: from `--help`, the docs and the skill.
- It reports per task: works / partly / broken, an ease rating from 1 to 10, bugs (exact command, expected vs actual, exit code), and friction.
- Findings **about this change** go back to the implementer, and get fixed **in the same PR**.
- Findings about **older code** go in a new verified issue, in the right milestone.

### 5. Merge gates

Check everything in `references/merge-gates.md`. In short:
- the review is clean, or its findings are resolved;
- the agent test is done;
- the required CI check is green, including the slowest/flakiest platform when the change touches its area;
- the branch is mergeable on the current base;
- the changelog has no duplicate or misplaced entries after a rebase.

Merge with the project's merge style and a subject that references the PR. Then:
- watch the **post-merge CI on the default branch**. A red main gets fixed before anything else;
- remove the worktree and the local branch;
- close or comment on the issue if the PR didn't.

### 6. Keep the books

- **After each merge:** update the roadmap/tracking issue (done / new / moved).
- **Fix or file:** every finding from any step is fixed now or filed as a verified issue. Never leave it only "out of scope" in a PR body or summary.
- **Reporting:** report to the user at merges, real problems and decisions, or when asked. Don't relay every background notification or stale watcher.
- **Releases** happen only when the user decides, never automatically at the end of a session.

### 7. Retro at the end of the session

In a few lines, tell the user:
- what merged and what was filed;
- what slowed the session down, e.g. repeated conflicts, flaky tests, review rounds;
- what was unnecessary;
- one or two process changes to make.

Write the agreed changes into project memory or this skill (Project settings), so the next session starts with them.

### Recurring traps

- **Changelog conflicts on every merge.** Each PR then needs a rebase plus a full CI rerun. In bdg, PRs don't edit `CHANGELOG.md` at all; the release PR writes it from the merged PRs' descriptions.
- **Shared registries** (route tables, option registries, store fields) conflict when PRs run in parallel. Prefer auto-registration, or tell implementers to keep their edits additive.
- **A rebase that ran after an agent's last test run.** Re-run at least typecheck and the affected tests before you merge.
- **A merge state of "UNKNOWN"** right after a push. Re-check after a few seconds.
- **"Flaky" can be a real bug.** Root-cause a flake before you mark it as one. Several flakes in this cycle were product bugs or tests asserting wrong timing.
- **Agents report interim "waiting for CI".** Don't treat that as done. Wait for the final report.
- **Stale CodeQL/linters on test fixtures,** e.g. a variable named `SECRET`. Rename; don't suppress.

## Project settings (bdg)

### Repo
- Remote: github.com/szymdzum/browser-debugger-cli (`gh --repo szymdzum/browser-debugger-cli`)
- Default branch: main
- Merge style: merge commit, subject `<PR title> (#N)`
- Push: over SSH, `git push -u git@github.com:szymdzum/browser-debugger-cli.git <branch>`. HTTPS pushes can fail.
- Who merges: ask the user at the start of each session
- Who opens the PR: the implementer, as a draft with a full body (what changed, why, verification with CI run IDs); it goes ready for review once the gates pass

### Environment
- Runtime pin: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"`. The repo has no .nvmrc, and the default Node may be too new.
- Worktree deps: `ln -s <main checkout>/node_modules ../bdg-<N>/node_modules`, then build in the worktree. Never rebuild a dist shared with other agents.
- Test env: `BDG_TEST_SESSION_DIR` and `BDG_TEST_HOME_DIR` under /tmp. Socket paths are too long otherwise.
- Manual sessions: `BDG_SESSION_DIR=/tmp/...`. Never use `~/.bdg`.

### Commands
- Check: `npm run check` (release: `npm run check:enhanced`)
- Unit: `npm test`
- Build: `npm run build`
- Smoke, one file: `npx tsx --test --test-concurrency=1 src/__tests__/smoke/<file>.smoke.test.ts`
- Integration: `./tests/run-all-tests.sh --integration`
- CI repeat: `gh workflow run ci.yml --repo szymdzum/browser-debugger-cli --ref <branch> -f smoke_files='<space-separated paths>' -f repeat=10`. Don't use brace globs, and don't use `debug=true` (#510).
- PR checks: `gh pr checks <n>`. Don't use `--watch`.

### Gates
- Required check: `CI OK`. macOS smoke runs on PRs that touch timing-sensitive paths. It isn't part of CI OK, but it must be green or a known, filed flake.
- Timing-sensitive tests: repeat=10 on Linux and macOS before merge (docs/quality/TEST_GUIDE.md).
- CI or environment changes (browser, runner, tooling): dispatch the full smoke suite with repeat ≥ 3 before merge.
- After merge, watch main's push run, including macOS.

### Changelog
- PRs never edit `CHANGELOG.md`. The PR description is the changelog source: it must say what changed for users, and mark changed defaults or contracts and breaking changes (with what to do).
- The release PR writes the version's section from the PRs merged since the last tag (`docs/RELEASE_PROCESS.md`), in the order Breaking, Added, Changed, Fixed, Security, Internal.

### Conflict-prone files (avoid shared edit points)
- Fixture pages: a new module in `src/__testutils__/fixturePages/` exporting `ROUTES`; don't edit `fixtureServer.ts` for static pages.
- Option behaviors: the area table in `src/commands/optionBehaviors/<area>.ts`, not a shared list.

### Forbidden
- `git stash`: the user's stashes live in the shared list.
- Broad `pkill`/`killall`/`pkill -P`.
- Touching `~/.bdg`.
- Leaving test downloads in `~/Downloads`.
- Committing without being asked.
- AI attribution.
- Relaying an npm OTP through chat.
- Releasing unless the user decides.

### Conventions to quote in briefs (CLAUDE.md)
- CommandRunner. Throw CommandError or return `{success, error}`, never both.
- The BdgResponse JSON envelope. Exit codes from `src/utils/exitCodes.ts`.
- Centralized messages in `src/ui/messages` and `src/errors/messages.ts`.
- OPTION_BEHAVIORS keys are `<last command name>:--long-flag` (a test enforces this).
- TSDoc on all functions. No inline comments. About 30 lines per function. No empty catch.
- Update `docs/CLI_REFERENCE.md` and `.claude/skills/bdg/SKILL.md` when behaviour changes.

### Tracking
- Roadmap: #466. Milestones: "Next: hardening", "Next: agent gaps", "1.0".
- Fix or file: every finding is fixed now or filed as a verified issue.

### Fresh-agent test setup
- Run the branch build with `node <worktree>/dist/index.js` and `BDG_SESSION_DIR=/tmp/...`. Send SIGINT to the node PID directly, not through a shell function.
- Scenarios: the scenarios section below.
- Protected dir: diff `~/Downloads` before and after.

## Brief templates

### Implementer brief
Fill in the `<…>` parts. Keep it self-contained: the implementer has no context beyond this text and the repo.

---

Implement issue `<#N>` in `<project>` (`<repo>`). Read the issue (`<command to view it>`), then `<CLAUDE.md / AGENTS.md / CONTRIBUTING>`. Also read the code it touches: `<files and modules worth reading first>`.

**Worktree.** Don't edit the main checkout at `<path>`. Make your own worktree:
```
<git fetch>
<git worktree add ../<repo>-<N> -b <type>/<slug> origin/<default-branch>>
<link or install dependencies, e.g. symlink node_modules>
```
If another branch you depend on hasn't merged yet, base the worktree on that branch and rebase onto the default branch before the final push.

**Scope** (the issue's acceptance criteria, plus):
- `<concrete expectations>`
- `<decisions you must make and justify, and the options to choose between>`
- `<user-visible contract rules: output format, exit codes, error message conventions>`
- Update the docs that describe this behaviour: `<docs, help, skill, option registry>`.
- Add a changelog entry: `<where and which section>`.

**Tests**
- Write a failing test first, then the fix. Report which tests failed before the change.
- Tests must be deterministic. Wait for an observable event (a log line, a request, a DOM change, a file), never a fixed sleep. If anything is timing-sensitive, dispatch `<CI repeat command>` with repeat=10 and report the run ID.
- Collect before/after evidence: real command output or a measurement on `<fixture or real target>`.

**Verify**
- Environment: `<runtime pin, e.g. PATH to the right Node>`, `<test env vars>`.
- Run `<lint/check>`, `<unit tests>`, `<build>`, and `<the relevant integration/smoke tests>`.
- Push: `<push command, e.g. over SSH>`.
- Open a **draft PR** with a full body: what changed, before/after, verification with run IDs, decisions you made, and known limits. Link the issue (`Closes #N`).
- Commit without AI attribution unless the repo asks for it.

**Rules**
- No `git stash`. The stash list is shared across worktrees.
- No `pkill`, `killall` or `pkill -P`. Kill only PIDs you started.
- Never touch `<the user's real data dirs>`, other worktrees, or the main checkout.
- `<project-specific forbidden actions>`
- Other agents are working in parallel on `<their areas and files>`. Stay out of those, and keep your edits to shared files (`<changelog, registries>`) minimal and additive.

**Report.** What changed, decisions with reasons, before/after evidence, test and CI results with run IDs, the commit hash, the PR URL, and any finding outside your scope (I'll file it).

### Reviewer brief
The reviewer must be a **fresh agent** that hasn't seen the implementation discussion. Give it the diff, the issue, and the risky areas. Don't give it the implementer's reasoning.

---

Review `<commit(s) / branch>` in the worktree `<path>` (`<project>`). Diff it against `<base>`, and don't modify the worktree. Put scratch files in `<tmp dir>`.

**Context.** Issue `<#N>` (`<view command>`). The change:
- `<3–8 bullets: what it claims to do, including design choices>`

**Check carefully:**
- **Correctness:** check each claim against the code, and each acceptance criterion against the tests.
- **Failure and cleanup paths:** errors, timeouts, interrupts (Ctrl-C/SIGTERM), partial failures. Does every path release what it acquired (listeners, sockets, temp files, flags)?
- **Concurrency:** races between concurrent commands, between an event and the command that waits for it, and between a switch or rollback and late events.
- **Resource bounds:** memory caps, output size (including token cost for agent users), file sizes.
- **Security:** secrets in output, logs or errors; file writes (symlinks, permissions, atomicity); injection; prototype pollution.
- **Contracts:** is the output shape additive only? Exit codes, changed defaults (are they documented as Changed?), backwards compatibility.
- **Interaction with recent work:** `<recently merged features this could break>`.
- **Tests:** do they test the claim? Would they fail on the old code? Are they deterministic?
- **Docs and changelog:** do they say exactly what the code does?
- **Conventions:** `<project conventions to check>`.
- `<change-specific risky questions>`

**Run** `<build>`, `<the targeted unit tests>` and `<one targeted smoke/integration test>`. If a claim is cheap to check by hand, do it.

**Rules:** no `git stash`; no `pkill`/`killall`; don't touch `<user data dirs>`.

**Report.** Findings as **blocking / should-fix / nit**, each with file:line and a concrete scenario (inputs → wrong outcome). Also list what you checked and found fine. Keep it short.

### Fresh-agent usage test brief
Run this on the **PR branch before merging**. The tester is a fresh agent playing a real user. It gets tasks, not a description of the diff. Its findings about this change are fixed in the same PR; findings about older code become new issues.

Build the branch first, e.g. `<build command in the PR worktree>`.

---

You are `<a coding agent / a developer>` who has never used `<tool>`. Test it on realistic tasks and report what works, what is confusing, and any bugs.

**Setup.** At the start of every shell call:
```
<runtime PATH pin>
<alias the built binary from the PR worktree>
<isolated data dir env vars>
```
- Never touch `<the user's real data dirs>`.
- Learn the tool the way a new user would: `<help command>`, `<docs/skill path>`. Don't read the source unless you need to confirm a bug.

**Fixture.** Build a small local fixture in `<tmp dir>` that exercises:
- `<concrete pages, endpoints, files or data the tasks need>`

Kill only the processes you started.

**Tasks.** Phrase these as goals, not steps:
1. `<goal that uses the new feature>`
2. `<goal that combines it with existing features>`
3. `<edge case: interrupt, failure, odd input, another mode or platform>`
4. `<a real-world target if one is reachable>`

**Rules:**
- No `pkill`/`killall`.
- No git commands and no repo edits.
- Put scratch files in `<tmp dir>`.
- Clean up at the end: stop sessions, kill your own PIDs.
- Check `<the user's real dirs that must stay untouched>` before and after.

**Report.**
- One line per task: works / partly / broken, plus a 1–10 rating for ease of use.
- Bugs: exact command, expected vs actual output, exit code.
- Friction: confusing output, missing hints, docs that don't match behaviour.
- The before/after diff of the protected dirs.

Be concise.

### Merge gates
Merge a PR only when **all** of these hold. If one fails, fix it; don't negotiate it.

1. **Review is resolved.** Every blocking and should-fix finding is fixed or rejected with a reason you accept. Nits are fixed, or filed if they're worth tracking.
2. **The fresh-agent usage test is done** on the branch, for features and behaviour changes. Its findings about this change are fixed in the PR. Findings about other code are filed.
3. **Tests were written first,** or there is evidence the tests fail without the change (for example, rebuilding with the fix turned off).
4. **Timing-sensitive tests passed a repeat run.** That's the CI repeat dispatch (see Commands) with repeat ≥ 10, on Linux and macOS. A CI change to the environment (browser version, runner image, tooling) needs the same treatment for the full suite.
5. **Required CI is green on the final head commit.** Re-check the head SHA after any push or rebase. Never merge on a watcher that reported an older commit.
6. **The branch is mergeable on the current base.** After a rebase:
   - re-run at least typecheck and the affected tests;
   - check that `CHANGELOG.md` wasn't edited;
   - check that no conflict marker is left anywhere.
7. **Docs match the behaviour:** user docs, help text, agent skill, option registry, a PR description that says what changed for users (it feeds the changelog at release). Changed defaults or contracts are listed under **Changed**.
8. **No leftovers:** no temp files in the repo, no stray processes from the agents, nothing written to the user's real data dirs.

#### After merging

- Watch the default branch's post-merge CI, including any jobs that only run there. If main is red, fixing it comes before any new work.
- Remove the worktree and the local branch.
- Update the roadmap or tracking issue, and the project memory.
- If the PR didn't close its issue, close it, or comment with what's left.


## Fresh-agent test scenarios

A fixed list of tasks for fresh-agent test rounds, so rounds can be compared over time. A fresh agent is a new agent with no context about bdg's internals: it gets a realistic task and an installed `bdg`, and is **not told which feature is being tested**. What it discovers, works around and rates shows how agent-friendly bdg is; unit, smoke and integration tests don't catch false successes, misleading hints or friction.

Every feature or behaviour-change PR runs the scenarios that touch its area on the PR branch, before merge (tiny fixes and docs are exempt). Keep the scenario IDs stable; when a scenario changes, note the date in its **History** line so older ratings aren't compared with a different task.

### Running a Round

1. **Build the branch** in its worktree (Node pinned, see Project settings above):
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
5. **Brief the agents** with the scenario's task text only (the **Task** line), the bdg command, the session directory and, for fixtures, the URL. Don't mention the feature, the issue or the expected output. Screenshots are allowed. Run at most 4 agents in parallel.
6. **Interrupts**: to test Ctrl-C, send SIGINT to the `node` PID of that bdg command directly (`kill -INT <pid>`), not through a shell function or a process group. Kill only PIDs you started; no `pkill`/`killall`.
7. **Clean up**: `bdg stop` in each session directory (`BDG_SESSION_DIR=… node dist/index.js stop`), stop the fixture server, remove the `/tmp/bdg-round-*` directories once the reports are in.

Pair each round with your own manual runs of the same scenarios: agents report friction, you check correctness.

### Report Format

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

### Scenarios

Each scenario has an ID, the task given to the agent, how to set it up, what "works" looks like, and what to rate.

#### S01 OAuth-like popup

- **Task:** "Sign in on this page. The sign-in window posts a token back to the page; tell me the token the page shows."
- **Setup:** fixture `/tabs`. `#open-popup` opens `/tabs-popup` with `window.open()`; its button posts `token-123` to the opener and closes the popup.
- **Works:** the click reports the popup it opened (`Opened: popup … (bdg page switch 1)`); the agent switches, clicks, and the action says the tab closed and the session is back on the opener; `#token` reads `token-123`. No stuck session on a closed tab.
- **Rate:** whether the agent found `page switch` from the action output alone, and whether the closed-popup return was clear.
- **History:** from #453 / #557.

#### S02 MDN search modal

- **Task:** "On developer.mozilla.org, search for `Array.prototype.flat` with the site's search box and open the first result."
- **Setup:** real site <https://developer.mozilla.org/en-US/>. The search form is rendered in a shadow root only after the Search button is clicked (fixture equivalent: `/shadow-forms`, `#open-search` and `<x-search-modal>`).
- **Works:** `dom fill` reaches the field in the shadow root and the site's `inputType` handlers don't throw; results appear (`Shown:`); the first result opens. No `dom eval` needed to type.
- **Rate:** number of `dom eval` calls and screenshots; whether `dom form` or `dom query` found the field.
- **History:** from #552, #456.

#### S03 bbc.com/news noise

- **Task:** "Load bbc.com/news and tell me which requests failed and whether the page logged real errors."
- **Setup:** real site <https://www.bbc.com/news>.
- **Works:** `bdg console` separates page errors from Chrome Issues noise (cookie and third-party warnings); `network list` stays a readable size (paged/bounded, with the counts explained); failed requests are identifiable without dumping the whole list.
- **Rate:** output size (lines / tokens) of `console` and `network list`; whether the agent trusted the answer.
- **History:** from #492, #451.

#### S04 Forms in shadow DOM

- **Task:** "Log in on this page with user `ada` and PIN `1234`, then subscribe `ada@example.com` to the newsletter."
- **Setup:** fixture `/shadow-forms`: a login form in an open shadow root, a newsletter form two shadow roots deep, a field component (`<x-field>`), a closed shadow root (`<x-vault>`).
- **Works:** `dom form` lists the shadow forms; `dom fill` and `dom submit` work by label or selector; the closed root is reported as not reachable instead of failing silently.
- **Rate:** whether `dom form` was used and trusted; workarounds for shadow roots.
- **History:** from #456.

#### S05 JS dialogs on load and on click

- **Task:** "Click Delete on this page but cancel the confirmation, then rename the item to `Berlin`. Then open the second page and tell me what it asked while loading."
- **Setup:** fixture `/dialogs` (confirm, prompt, prompt with default, alert, a beforeunload guard) and `/dialogs-load` (a confirm while loading).
- **Works:** `--dialog dismiss` and `--prompt-text` answer the action's dialogs; results list `Dialog: confirm() dismissed: "Sure?"`; the load-time confirm is reported by `bdg <url>` / `page navigate`; nothing hangs on an unanswered dialog.
- **Rate:** whether the agent found `--dialog` without trial and error; clarity of the dialog lines.
- **History:** from #450, #553.

#### S06 Blocked cookies

- **Task:** "This page logs in with cookies but the session doesn't stick. Find out why."
- **Setup:** blocked cookie fixtures from `serveFixtures.ts`: open the **seed** URL first (stores a `SameSite=Lax` cookie for `localhost`), then the **page** URL, which sets `SameSite=None` without `Secure` over http and a cookie for another domain, and fetches the API cross-site.
- **Works:** `details network` names the blocked cookies and the reason (SameSite=None without Secure, domain mismatch, Lax not sent cross-site); no cookie value is printed.
- **Rate:** whether the agent reached the reason without raw CDP; whether any value leaked.
- **History:** from #493.

#### S07 Auth state save, stop, `--state`

- **Task:** "Log in, then restart the browser session and continue where you left off without logging in again."
- **Setup:** real site <https://the-internet.herokuapp.com/login> (`tomsmith` / `SuperSecretPassword!`; the session cookie has no Expires), or a page that stores a token in localStorage and sessionStorage. The smoke fixture is in `src/__tests__/smoke/auth-state.smoke.test.ts`.
- **Works:** `bdg state save <file>` → `bdg stop` → `bdg <url> --state <file>` is still logged in; output shows counts and origins, never values; the file is 0600.
- **Rate:** whether the agent found `state save` / `--state` from help; whether it put the file somewhere safe.
- **History:** from #454.

#### S08 Ctrl-C during start, screenshot and `page switch`

- **Task:** "Start a session on this slow page, give up after a few seconds, and start again on the home page. Then take a full-page screenshot and interrupt it, and interrupt a tab switch."
- **Setup:** fixture `/slow` (answers after 8 s); `/tabs` for a second tab. Interrupt with `kill -INT <node pid>` (see Running a Round).
- **Works:** each interrupted command exits 130 with a `--json` envelope; nothing half-started is left (`bdg status` is clean or the session is usable); the next start works without `bdg cleanup`; the screenshot leaves the page layout as it was.
- **Rate:** whether the agent needed `cleanup` or `--force`; clarity of the interrupted messages.
- **History:** from #557 and the startup interruption fixes.

#### S09 CDP event collection

- **Task:** "Record a performance trace of clicking the button on this page into a file. Then make the page's API call return a mocked response."
- **Setup:** fixture `/` (calls `/api/test`) or `/effects`; any page with a fetch.
- **Works:** trace: `bdg cdp Tracing.start` … `bdg cdp Tracing.end --collect Tracing.dataCollected --until Tracing.tracingComplete --out trace.ndjson` writes the events. Mock: the Fetch recipe (`Fetch.enable --listen Fetch.requestPaused`, `--events`, `Fetch.fulfillRequest`) answers the paused request; paused requests are named as such, not as a hang.
- **Rate:** whether the agent found `--collect` and the recipe (help, `--describe`, hints); how many raw CDP attempts it took.
- **History:** from #452.

#### S10 Downloads

- **Task:** "Download the report from this page, including the one that opens in a new tab, and tell me where the files are."
- **Setup:** fixture `/downloads` (`#report`, `#report-tab` with `target=_blank`, `#report-window` with `window.open()`, `#slow` held until you request `<fixture url>slow-download/release`, e.g. with `curl`).
- **Works:** each action lists `Download: <name> → <path>` under the session's `downloads/` directory, also for the tab and the popup; the slow one shows `inProgress` and then appears; **`~/Downloads` is unchanged** (diff it).
- **Rate:** whether the agent found the path from the action output; any file outside the session directory.
- **History:** from the downloads work (#453 tabs).

#### S11 `network list --page` / `--sort` after navigation

- **Task:** "Open this page, follow the link to the second page, and list the second page's failed requests, slowest first."
- **Setup:** fixture `/frames` (a missing image, a worker) then navigate to `/attributes`; or any real site with two pages.
- **Works:** `network list --preset errors` shows the current page only by default and says how many requests of earlier pages it hid (`--page all` shows them); `--sort duration` puts the slowest first and the header says so. No 404s of the old page reported as current.
- **Rate:** whether the agent trusted the list; output size.
- **History:** from #451.

#### S12 Action errors

- **Task:** "Click each button on this page and tell me which ones break something."
- **Setup:** fixture `/action-errors` (`#sync` throws, `#async` throws from a timer, `#rejection` rejects, `#logged` logs errors and a warning, `#many` logs four errors, `#navigate` goes to a page that throws on load).
- **Works:** each click lists the errors it caused (`Errors: …`, `[2x]`, `+N more`), the timer and rejection cases included; warnings and errors from before the action are left out; the click itself still succeeds.
- **Rate:** whether the agent needed `bdg console` or `dom eval` to see the errors.
- **History:** from #449.

#### S13 Full-page screenshot scrollbar

- **Task:** "Take a full-page screenshot of this long page, then tell me the page's visible width."
- **Setup:** any long page with a scrollbar (fixture `/layout`, or a real article page).
- **Works:** the screenshot is complete; afterwards `innerWidth - clientWidth` (the scrollbar) and the window size are as before the screenshot.
- **Rate:** whether the agent noticed any layout change; screenshot correctness.
- **History:** from #514, #537.

### Exploratory Sweep

The scenarios keep rounds comparable; the sweep finds what they don't cover. Run it regularly: once per working session on `main`, or nightly through a cloud routine while credit lasts.

1. **Pick 3–5 real sites** not used in the last sweep, mixing kinds: a news site, a single-page app (React, Vue), a shop with a cart and checkout form, a docs site with search, a login flow, a page with iframes or web components. Keep a list of visited sites in the sweep summary.
2. **Give each agent an open-ended task** per site, the way a user would: "find out why this page is slow", "fill the signup form without submitting it", "check what this page logs and requests when you add an item to the cart". No feature names.
3. **Watch for**: false success (an action claims success but nothing happened), wrong or stale data, outputs too big to read, hints pointing to the wrong command, workarounds (`dom eval`, screenshots, `sleep` loops, raw CDP for something bdg has), leaks (secret values, files outside the session directory, `~/Downloads`), sessions left running.
4. **Report** in the same format (result, ease, bugs, friction), plus "would add to the scenario list?". A finding that should be checked every round becomes a new scenario here (next free ID, with its setup and a History line).
5. **Triage**: every finding is fixed or filed as a verified issue (reproduced, with the command and output).
