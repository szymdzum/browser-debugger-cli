# Brief templates

Render a brief with `node .claude/skills/ship/scripts/ship.mjs brief <role> N=<n> KEY=value…`: it inserts the shared blocks below and fills the `<KEY>` placeholders you pass (`MAIN`, the main checkout, is filled for you; `ROLE` is the role's PID-file tag). It prints the placeholders still open on stderr: fill those by hand (scope, decisions, risks), then send the text as the agent's prompt. Each agent sees nothing but its brief and the repo, so a brief repeats every rule the agent must follow; the blocks keep those rules written once.

| Role | Agent | Model | Runs | Cap (tool calls) |
|---|---|---|---|---|
| implementer | `general-purpose` | `sonnet`; `opus` for tier 3 | background | 80 |
| reviewer | `general-purpose` | `sonnet` | foreground | 25 (tier 1–2), 40 (tier 3) |
| tester | `general-purpose` | `sonnet` | foreground | 40; 20 for a fix with no new output or flag |
| verifier | `general-purpose` | `sonnet` | foreground | 60 |

Placeholders the script can fill: `N` (issue), `BRANCH`, `BASE` (merge base or the unmerged branch this PR builds on), `HEAD` (head SHA under review or test), `RED` (red commit SHA), `CAP`, `URLS` (fixture URLs), `DATE`.

## Shared blocks

<!-- block:node -->
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"
<!-- /block -->

<!-- block:foreground -->
**Commands.** Run everything in the foreground. If a command may take more than 30 s (test suites, builds), give your shell tool a longer timeout (up to 10 minutes) instead of backgrounding it: a background result is lost when your turn ends. The only background processes allowed are a fixture or HTTP server and a command you are about to interrupt, each with a PID file. No monitors, no polling loops, never wait for CI (the orchestrator does). Cut output before it reaches your context: `npm test 2>&1 | tail -20`, `npm run check 2>&1 | tail -15`, smoke `… 2>&1 | grep -E '^# (pass|fail)|^not ok'`, anything else `| head -40`. Read a file once; don't re-run a suite that already passed.
<!-- /block -->

<!-- block:forbidden -->
**Rules.**
- No `git stash` (the stash is shared across worktrees); no `--no-verify` or any other hook bypass.
- No `pkill`, `killall` or `pkill -P`. A background process you start writes its PID at start (`cmd & echo $! > /tmp/bdg-<ROLE>-<N>-NAME.pid`); kill only PIDs read back from those files. A stray bdg session is ended with `bdg stop` (or `bdg cleanup --force`) in its own `BDG_SESSION_DIR`.
- Never touch `~/.bdg`, other agents' worktrees, or the main checkout `<MAIN>` (its `.tmp/` included); the one exception is adding and removing your own worktrees with `git -C <MAIN> worktree …`. Nothing may land in `~/Downloads`.
- Don't open GitHub issues. Report findings with the command and its output; the orchestrator verifies and files them.
<!-- /block -->

<!-- block:findings -->
**Findings outside the change.** A finding about **older code** in the same file or function as the change, fixable in about 20 changed product lines plus its test, is **adjacent**: the implementer fixes it in this PR as its own commit (`fix: SYMPTOM (#<N> adjacent)`), unless it changes parsed output (`--json` fields, text a test asserts), a flag, an exit code or a default (then it is a decision for the user). Every other finding goes into the report, with its command and output.
<!-- /block -->

<!-- block:report-tail -->
Keep the report under ~40 lines; details belong in files or the PR body.
<!-- /block -->

## Implementer

<!-- brief:implementer -->
Implement issue #<N> in bdg (github.com/szymdzum/browser-debugger-cli). Read the issue with its comments (`gh issue view <N> --repo szymdzum/browser-debugger-cli --comments`), then `CLAUDE.md`, then the code it touches: <files and modules worth reading first>.

**Worktree.** From the main checkout, create yours: `cd <MAIN> && node .claude/skills/ship/scripts/ship.mjs worktree <N> <BRANCH>` (prints `../bdg-<N>`, `node_modules` linked; add `base=OTHER_BRANCH` to build on an unmerged branch, and rebase onto `main` before the final push). Work, build and commit only there. `node_modules` is a symlink to the main checkout: never `npm install` through it; a change to `package-lock.json` runs its own `npm ci` in your worktree.

**Scope** (the issue's acceptance criteria, plus):
- <concrete expectations>
- <decisions you must make and justify, and the options>
- Contracts: `--json` output in the `BdgResponse` envelope, additive only; exit codes from `src/utils/exitCodes.ts`; messages centralized (`src/ui/messages`, `src/errors/messages.ts`); `CommandError` or `{success, error}`, never both. Removing a `--json` field or changing an exit code or a default is not yours to decide: stop and report it as a decision.
- Validation of a value (an environment variable, a flag, an argument) covers **every entry path** that uses it, the start path (`bdg URL`) included: start spawns the daemon before most helpers run, so a check only in a shared helper fires too late there.
- Page-side code (anything `Runtime.evaluate` or `callFunctionOn` runs) gets its parameters as function arguments, never interpolated into the source (CodeQL `js/bad-code-sanitization`); the page returns keys or data, Node builds the messages.
- Secrets: no message, hint or `--json` field carries a secret's value, a fragment of it, or its length.
- Update the docs that describe the behaviour: `docs/CLI_REFERENCE.md`, help text, `.claude/skills/bdg/SKILL.md`, and the area table in `src/commands/optionBehaviors/<area>.ts` for non-obvious flags. Don't edit `CHANGELOG.md`: the PR description is the changelog source (what changed for users; changed defaults, contracts and breaking changes marked).
- New fixture pages go in a new module in `src/__testutils__/fixturePages/` exporting `ROUTES`; never edit `fixtureServer.ts`.
- Other agents work in parallel on <their areas and files>. Stay out of those; keep edits to shared files (registries, `src/errors/messages.ts`, docs) minimal and additive.

{{findings}}

**Tests.**
- **Red commit first.** Turn the issue's reproduction and each **testable** acceptance criterion into failing tests and commit them alone, before any fix: `test: reproduce #<N>` (bug) or `test: specify #<N>` (feature). Tests, fixture pages and empty skeletons only (a new function's signature throwing `not implemented`, so a unit test can import it); otherwise drive the CLI. A criterion that is a measurement or a doc change gets no test: say how you checked it.
- Run them on that commit: they must fail **on an assertion about the issue** (or the CLI's real output), not on a build or import error.
- Then fix vertically: one test, then the code that passes it. Never weaken a red assertion in a fix commit; if one was wrong, fix it in a commit of its own and say why in the report.
- A test that passed on its first run is a regression test: say what it protects against.
- Deterministic only: wait for an observable event (a log line, a request, a DOM change, a file), never a fixed sleep. List timing-sensitive smoke files in the report (the orchestrator dispatches the repeat run).
- No red commit for docs-only changes, refactors covered by existing tests, or CI/tooling; say which applies.
- <detection heuristics only, delete otherwise: before the PR, build a false-positive matrix on scratch pages and report the counts: an element that unmounts on press, a label that changes on press, a sibling that slides under the mouse, a page-wide ticker or aria-live region updating on its own, an unrelated toast during the action window; each must stay silent unless the issue says otherwise>
- <redaction or parsing changes only, delete otherwise: the case matrix, inputs × output surfaces (human, --json, file, log); every cell is a row of the red commit's table test; report the counts>

**Verify.** Every shell call starts with:
```
{{node}}
export BDG_TEST_SESSION_PARENT=/tmp/bt-<N> BDG_TEST_HOME_DIR=/tmp/bt-<N>-h   # manual runs: BDG_SESSION_DIR=/tmp/bdg-<N>-manual
```
Run `npm run check`, `npm test`, `npm run build` and the affected smoke files (`npx tsx --test --test-concurrency=1 src/__tests__/smoke/<file>.smoke.test.ts`); CI runs the full smoke suite. When the change alters human or `--json` output, also run every test that asserts the old text (`rg` the old string across `src/`), not only the files you added (a shared formatter change passed 2 smoke files and CI found a third, #691). Collect before/after evidence on a fixture page (`npx tsx src/__testutils__/serveFixtures.ts`) or a real site: two lines, not a capture of every command; case matrices up to ~30 cells unless the scope asks for more.

{{foreground}}

**Push and PR.** You commit and push in your worktree; this brief grants that. Push over SSH: `git push -u git@github.com:szymdzum/browser-debugger-cli.git <BRANCH>`; rewriting a pushed branch (only for a rebase the orchestrator asked for): `git push --force-with-lease=<BRANCH>:<old sha> git@github.com:szymdzum/browser-debugger-cli.git <BRANCH>`. Open a **draft PR** (`gh pr create --draft --head <BRANCH> --repo szymdzum/browser-debugger-cli`) with a full body: what changed for users, before/after, verification, decisions, known limits, `Closes #<N>`. No AI attribution anywhere. **Return as soon as the draft PR is open**; if GitHub shows no `pull_request` run within 3 minutes of a push, say so instead of re-pushing.

{{forbidden}}

**Budget.** At most 80 tool calls; at the cap, stop and report what is left.

**Report.** What changed; decisions with reasons; the red commit (SHA and the failure line); before/after in two lines; test result lines; timing-sensitive smoke files; adjacent fixes; findings outside the scope with command and output. {{report-tail}} The **last line** is exactly `PR <url> HEAD <sha>`; a report without it counts as unfinished.
<!-- /brief -->

## Reviewer

Give the reviewer the diff's claims, the issue and the risks, never the implementer's reasoning. A finding it lists under **Not checked** that is on your risk list means you resume it for that item before the review counts.

<!-- brief:reviewer -->
Review commits `<BASE>..<HEAD>` of branch `<BRANCH>` (bdg, issue #<N>; the implementer's worktree is `../bdg-<N>`: don't modify it). `<BASE>` is the merge base with `origin/main` or the tip of the unmerged branch this PR builds on. Review exactly `<HEAD>`, even if the branch moves while you work. Your own worktree:
```
git -C <MAIN> worktree add /tmp/review-<N> <HEAD>
ln -s <MAIN>/node_modules /tmp/review-<N>/node_modules
```
Scratch files in `/tmp/review-<N>-work`; remove the worktree at the end (`git -C <MAIN> worktree remove --force /tmp/review-<N>`).

**The change claims** (issue: `gh issue view <N> --repo szymdzum/browser-debugger-cli --comments`):
- <3–8 bullets: what it claims to do, including design choices>

**Check carefully:**
- **Correctness:** each claim against the code; each acceptance criterion against the tests.
- **Failure and cleanup paths:** errors, timeouts, interrupts (Ctrl-C/SIGTERM), partial failures; every path releases what it acquired (listeners, sockets, temp files, flags).
- **Every entry path:** a validation or a new rule must hold on all paths that reach it, the start path (`bdg URL`) included.
- **Concurrency:** races between commands, between an event and the command waiting for it, between a switch or rollback and late events.
- **Resource bounds:** memory caps, output size (token cost for agent users), file sizes.
- **Security:** secrets (or their length or fragments) in output, logs or errors; page-side code built from interpolated strings; file writes (symlinks, permissions, atomicity); injection.
- **Contracts:** `--json` additive only; exit codes and defaults unchanged unless the PR marks them as changed.
- **Interaction with recent work:** <recently merged features this could break>.
- **Tests:** do they test the claims, deterministically (no fixed sleeps)? Any **tautological** expected value (computed the way the code computes it rather than from the issue or a known-good literal)? Did a later commit weaken a red assertion?
- **Docs and PR description** say exactly what the code does; `CHANGELOG.md` untouched.
- **Conventions (`CLAUDE.md`):** CommandRunner, `CommandError` or `{success, error}` never both, the `BdgResponse` envelope, semantic exit codes, centralized messages, option behavior keys `COMMAND:--flag`, TSDoc, no inline comments, no empty catch, ~30 lines per function.
- <change-specific risks; for parsing, selectors, validation or secrets a matrix of inputs × surfaces with the counts of wrong outcomes; for detection heuristics a false-positive matrix on scratch pages of your own>

**Run** in `/tmp/review-<N>`, every shell call starting with:
```
{{node}}
export BDG_TEST_SESSION_PARENT=/tmp/rv-<N>-t BDG_TEST_HOME_DIR=/tmp/rv-<N>-h BDG_SESSION_DIR=/tmp/rv-<N>
```
`npm run build`, <the targeted unit tests>, <one targeted smoke test>. Check cheap claims by hand (`node /tmp/review-<N>/dist/index.js …`).

**Red commit.** `git -C <MAIN> log --oneline <BASE>..<HEAD>`: the first commit is `test: …` and holds only tests, fixture pages and `not implemented` skeletons. Run its tests in a worktree of its own:
```
git -C <MAIN> worktree add /tmp/red-<N> <RED>
ln -s <MAIN>/node_modules /tmp/red-<N>/node_modules
npm --prefix /tmp/red-<N> run build    # only if the tests run against dist
(cd /tmp/red-<N> && npx tsx --test --test-concurrency=1 <the new test files>)
git -C <MAIN> worktree remove --force /tmp/red-<N>
```
They must fail on an assertion about the issue, not on a build or import error; quote the failure line. A missing or wrong-reason red commit is **blocking** (exempt: docs-only, refactors under existing tests, CI/tooling).

{{foreground}}

{{forbidden}}

**Budget.** At most <CAP> tool calls.

**Report.** The SHA you reviewed (`<HEAD>`), then findings as **blocking / should-fix / nit**, each with file:line and a concrete scenario (inputs → wrong outcome); report every finding you can support, uncertain ones marked as such. Mark each **adjacent** or **older code**:
{{findings}}
Then the matrix counts, what you checked and found fine, and under **Not checked** anything from the list above you skipped and why. {{report-tail}}
<!-- /brief -->

## Tester

Build the branch in its worktree first (`npm run build` in `../bdg-<N>`, Node pinned) and start the fixtures **from that worktree** (`cd ../bdg-<N> && npx tsx src/__testutils__/serveFixtures.ts & echo $! > /tmp/bdg-fixtures-<N>.pid`); pass the URLs it prints. Tasks are goals from the scenarios that touch the change's area (`scenarios.md`), never a description of the change.

<!-- brief:tester -->
You are a coding agent who has never used bdg, a CLI for debugging Chrome. Test it on realistic tasks and report what works, what is confusing, and any bugs. You are testing build `<HEAD>`; report that SHA as given (you have no git, don't try to confirm it).

**Setup.** Every shell call starts with:
```
{{node}}
export BDG_SESSION_DIR=/tmp/bdg-t-<N>-a
bdg() { node <MAIN>/../bdg-<N>/dist/index.js "$@"; }
```
Learn bdg the way a new user would: `bdg --help`, `bdg --help --json`, `<MAIN>/../bdg-<N>/.claude/skills/bdg/SKILL.md`. Read the source only to confirm a bug. To interrupt a command, run `node <MAIN>/../bdg-<N>/dist/index.js …` in the background with its PID in a file and send the signal to that PID (`kill -INT`), never to a shell function.

**Pages.** <URLS>. Scratch files in `/tmp/bdg-t-<N>-a-work`.

**Tasks** (goals, not steps):
1. <scenario Task line, or a goal that uses the new behaviour>
2. <a goal that combines it with existing features>
3. <edge case: interrupt, failure, odd input>
4. <a real site if one is reachable>

{{foreground}}

{{forbidden}}
- No git commands and no edits to any repository.
- Run `ls -A ~/Downloads` before and after; clean up at the end with `bdg stop`.

**Budget.** At most <CAP> tool calls.

**Report**, per task: result (works / partly / broken), ease 1–10, command counts (bdg, `dom eval`, screenshots), bugs (exact command, expected vs actual, exit code), friction, how you found the right command. Then the `~/Downloads` diff. {{report-tail}}
<!-- /brief -->

## Verifier

Runs after a fresh-agent round on everything about older code, and at session start as the sweep (then the findings are the selected issues, "re-run its recorded command"). Prepare its checkout yourself, since it runs no git: `git worktree add ../bdg-verify --detach origin/main && ln -s <main>/node_modules ../bdg-verify/node_modules && npm --prefix ../bdg-verify run build`; remove it after the report.

<!-- brief:verifier -->
Verify the findings below against bdg on `main` at `<HEAD>`, built for you at `<MAIN>/../bdg-verify`. Every shell call starts with:
```
{{node}}
export BDG_SESSION_DIR=/tmp/verify-<DATE>
bdg() { node <MAIN>/../bdg-verify/dist/index.js "$@"; }
```
Start the fixtures from that directory when a finding needs them (`cd <MAIN>/../bdg-verify && npx tsx src/__testutils__/serveFixtures.ts & echo $! > /tmp/bdg-verify-<N>-fixtures.pid`). Keep **one bdg session at a time**: other agents may be running smoke suites.

For each finding: run the reported command (or the closest that makes sense), paste the real output, and name the cause with file:line when a few minutes of reading find it. Classify it: **reproduced** (command, output, exit code), **not reproduced** (what happened instead), **by design** (where the docs or code say so), or **duplicate of** an open issue (`gh issue list --repo szymdzum/browser-debugger-cli --search "<words>"`). Group findings that share a root cause.

Findings:
1. <finding as reported, or "issue #N: re-run its recorded command">

**Sweep** (themed sessions only; delete otherwise). The theme is <theme>. Build pages under `/tmp/verify-<DATE>-pages` (serve with `python3 -m http.server <port> & echo $! > /tmp/bdg-verify-<N>-http.pid`) with <the theme's inputs>, run <the theme's commands, human and --json, files and daemon.log>, and grep every output for <the literal markers>. Report each hit as its own finding.

{{foreground}}

{{forbidden}}
- No git commands and no repository edits; `bdg stop` at the end.

**Budget.** At most 60 tool calls.

**Report.** The commit; one block per finding with classification, command, output, exit code and cause; then the groups. {{report-tail}}
<!-- /brief -->
