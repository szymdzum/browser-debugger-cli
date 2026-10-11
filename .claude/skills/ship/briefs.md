# Brief templates

Self-contained prompts for the subagents. Fill in the `<…>` parts and send the text below the `---` line. Each brief repeats the rules the agent must follow, because the agent sees nothing but its brief and the repo.

## Contents
- Implementer brief (`general-purpose` agent, own worktree, opens a draft PR)
- Reviewer brief (fresh `code-reviewer` agent, diff only)
- Tester brief (fresh `general-purpose` agent, the fresh-agent test on the PR branch)
- Verifier brief (fresh `general-purpose` agent, reproduces a round's older-code findings on `main`)

## Implementer brief
Fill in the `<…>` parts; the rest is bdg's settings already. Keep it self-contained: the implementer has no context beyond this text and the repo. Spawn it as a `general-purpose` agent with `model: sonnet` (tier 1–2) or `model: opus` (tier 3).

---

Implement issue `<#N>` in bdg (github.com/szymdzum/browser-debugger-cli). Read the issue (`gh issue view <N> --repo szymdzum/browser-debugger-cli`), then `CLAUDE.md`. Also read the code it touches: `<files and modules worth reading first>`.

**Worktree.** The main checkout is `<main checkout>` (`git rev-parse --show-toplevel` there); don't edit it, not even its `.tmp/`. Make your own worktree:
```
git fetch origin
git worktree add ../bdg-<N> -b <fix|feat|chore>/<slug> origin/main
ln -s <main checkout>/node_modules ../bdg-<N>/node_modules
```
Build only in your worktree. If another branch you depend on hasn't merged yet, base the worktree on that branch and rebase onto `main` before the final push.

**Scope** (the issue's acceptance criteria, plus):
- `<concrete expectations>`
- `<decisions you must make and justify, and the options to choose between>`
- Contracts: `--json` output in the `BdgResponse` envelope, additive only; exit codes from `src/utils/exitCodes.ts`; messages centralized (`src/ui/messages`, `src/errors/messages.ts`); CommandError or `{success, error}`, never both. Removing a `--json` field or changing an exit code is not yours to decide: stop and report it as a decision.
- Page-side code (anything `Runtime.evaluate` or `callFunctionOn` runs) gets its parameters as function arguments, never as `${…}` or `JSON.stringify` interpolated into the source (CodeQL `js/bad-code-sanitization`); the page returns keys or data, Node builds the messages.
- Secrets: no message, warning, hint or `--json` field carries a secret's value, a fragment of it, or its length (`expectedLength`-style fields included).
- Update the docs that describe this behaviour: `docs/CLI_REFERENCE.md`, help text, `.claude/skills/bdg/SKILL.md`, and the area table in `src/commands/optionBehaviors/<area>.ts` for non-obvious flags.
- Don't edit `CHANGELOG.md`. The PR description is the changelog source: say what changed for users, and mark changed defaults, contracts and breaking changes (with what to do).
- New fixture pages go in a new module in `src/__testutils__/fixturePages/`; don't edit `fixtureServer.ts`.
- **Adjacent findings.** A bug you (or your reviewer) find in the same file or function you are changing, fixable in about 20 changed product lines plus its test, is fixed in this PR as its own commit (`fix: <symptom> (#<N> adjacent)`) and listed in the PR body; not if the fix changes parsed output (`--json` fields, text a test asserts), a flag, an exit code or a default (report that as a decision). Anything else goes in your report under findings; **don't open issues**, the orchestrator verifies and files them.

**Tests**
- **Red commit first.** Turn the issue's reproduction (the command recorded in the issue) and each **testable** acceptance criterion into one failing test (a criterion that is a measurement or a doc change gets no test; say so and how you checked it), and commit those alone, before any fix: `test: reproduce #<N>` (bug) or `test: specify #<N>` (feature). The commit holds tests, fixture pages and empty skeletons (below), no working product code.
- Only those tests go in the red commit. The rest of the testing is vertical: one test, then the code that passes it, in the same later commit. Don't write the whole suite up front.
- Run them on that commit. They must fail **for the right reason**: an assertion about the issue, or the CLI's real output (unknown flag, wrong result). Not a build error or a missing import; for a new command or flag, drive the CLI or an existing entry point so the test fails on behaviour.
- A unit test for a new module or function may import it if the red commit also adds its **empty skeleton** (the signature, throwing `not implemented`); the next commit fills it in. Otherwise drive the CLI.
- Then fix in later commits. Don't weaken the red commit's assertions in the fix; if a test was wrong, fix it in a separate commit and say why in your report.
- A test that passed on its first run is a regression test: say in your report what it protects against. Tests added after the fix are welcome when you say why (a case the review raised, a mutation check that showed a gap).
- No red commit for docs-only changes, pure refactors covered by existing tests, or CI/tooling changes; say which applies.
- Tests must be deterministic. Wait for an observable event (a log line, a request, a DOM change, a file), never a fixed sleep. If anything is timing-sensitive, dispatch `gh workflow run ci.yml --repo szymdzum/browser-debugger-cli --ref <branch> -f smoke_files='<space-separated paths>' -f repeat=10 -f node=22` (no brace globs, no `debug=true`) and report the run ID.
- Collect before/after evidence: real command output or a measurement on a fixture page (`npx tsx src/__testutils__/serveFixtures.ts`) or a real site.
- `<redaction or parsing changes only, delete otherwise: the case matrix, inputs (names, header/field/URL shapes) × output surfaces (human, --json, file, log); every cell is a row of the red commit's table test, and the report gives the counts>`

**Verify**
- Environment, at the start of every shell call: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" BDG_TEST_SESSION_PARENT=/tmp/bt-<N> BDG_TEST_HOME_DIR=/tmp/bt-<N>-h` (yours alone; other agents have their own; each test process gets its own session dir under the parent), `BDG_SESSION_DIR=/tmp/bdg-<N>-manual` for manual runs. `node_modules` is a symlink to the main checkout: don't `npm install` through it; if your change touches `package-lock.json`, run `npm ci` in your worktree instead of the symlink.
- Run `npm run check`, `npm test`, `npm run build`, and the affected smoke files (`npx tsx --test --test-concurrency=1 src/__tests__/smoke/<file>.smoke.test.ts`). CI runs the full smoke suite; don't run it locally. Run every suite in the **foreground** (a background run is lost when your turn ends; the report must contain its exit line).
- You commit and push in your worktree; this brief grants that. Push over SSH: `git push -u git@github.com:szymdzum/browser-debugger-cli.git <branch>`. If you must rewrite a pushed branch, use `git push --force-with-lease=<branch>:<old sha> git@github.com:szymdzum/browser-debugger-cli.git <branch>` (plain `--force-with-lease` refuses on a URL remote); after a review, force-push only for a rebase the orchestrator asked for (say so in the PR).
- Open a **draft PR** (`gh pr create --draft --head <branch> --repo szymdzum/browser-debugger-cli`; `--head` is needed after a push to the SSH URL) with a full body: what changed for users, before/after, verification with run IDs, decisions you made, and known limits. Link the issue (`Closes #N`).
- **Return as soon as the draft PR is open.** Don't wait for or poll CI (the orchestrator does); if GitHub shows no `pull_request` run within 3 minutes of your push, say so in the report instead of dispatching one. Your report's **last line** is exactly `PR <url> HEAD <sha>`; a report without it is treated as unfinished.
- No AI attribution in commits or the PR.

**Rules**
- No `git stash`. The stash list is shared across worktrees.
- No `git commit --no-verify`, `--no-gpg-sign` or any other hook bypass. If a hook fails, fix what it reports.
- No `pkill`, `killall` or `pkill -P`. Every background process you start writes its PID to a file at start (`cmd & echo $! > /tmp/bdg-impl-<N>-<name>.pid`); kill only a PID read back from such a file, never one from memory or from `ps`/`lsof`.
- Never touch `~/.bdg`, other worktrees, or the main checkout (including its `.tmp/`). Nothing may land in `~/Downloads`.
- Don't open GitHub issues. Report findings; the orchestrator files them.
- Other agents are working in parallel on `<their areas and files>`. Stay out of those, and keep your edits to shared files (registries, docs) minimal and additive.

**Budget.** At most 80 tool calls; at the cap, stop and report what is left. No background processes except the fixture server (PID file); no monitors or self-notifications; every test run in the foreground with its output cut: `npm test 2>&1 | tail -20`, `npm run check 2>&1 | tail -15`, smoke `… 2>&1 | grep -E '^# (pass|fail)|^not ok'`. Read a file once; don't re-run a suite that already passed.

**Report** (at most ~40 lines; the detail lives in the PR body). What changed, decisions with reasons, the red commit (SHA and the failure line it produced), before/after evidence in two lines, test exit lines, adjacent fixes made, and any finding outside your scope with its command and output (I'll verify and file it).

## Reviewer brief
The reviewer must be a **fresh agent** that hasn't seen the implementation discussion: spawn it as a `code-reviewer` agent with `model: sonnet` (read-only tools plus Bash). Give it the diff, the issue, and the risky areas. Don't give it the implementer's reasoning.

---

Review commits `<base sha>..<head sha>` of branch `<branch>` (bdg; the implementer's worktree is `../bdg-<N>`, don't modify it). `<base sha>` is the merge base with `origin/main`, or the tip of the unmerged branch this PR builds on, so you don't review someone else's change. Work in a worktree of your own:
```
git -C ../bdg-<N> worktree add /tmp/review-<N> <head sha>
ln -s <main checkout>/node_modules /tmp/review-<N>/node_modules
```
Scratch files go in `/tmp/review-<N>-work`. Remove the worktree at the end (`git -C ../bdg-<N> worktree remove --force /tmp/review-<N>`).

**Context.** Issue `<#N>` (`gh issue view <N> --repo szymdzum/browser-debugger-cli`). The change:
- `<3–8 bullets: what it claims to do, including design choices>`

**Check carefully:**
- **Correctness:** check each claim against the code, and each acceptance criterion against the tests.
- **Failure and cleanup paths:** errors, timeouts, interrupts (Ctrl-C/SIGTERM), partial failures. Does every path release what it acquired (listeners, sockets, temp files, flags)?
- **Concurrency:** races between concurrent commands, between an event and the command that waits for it, and between a switch or rollback and late events.
- **Resource bounds:** memory caps, output size (including token cost for agent users), file sizes.
- **Security:** secrets in output, logs or errors, including a secret's length or a fragment; page-side code built from interpolated strings; file writes (symlinks, permissions, atomicity); injection; prototype pollution.
- **Contracts:** is the `--json` shape additive only? Exit codes, changed defaults (does the PR description mark them as changed?), backwards compatibility.
- **Interaction with recent work:** `<recently merged features this could break>`.
- **Tests:** do they test the claim? Does the red commit cover the issue's reproduction and each testable acceptance criterion (the PR names the rest)? Are they deterministic (no fixed sleeps)? Did a later commit weaken an assertion from the red commit? Any **tautological** test, whose expected value is computed the way the code computes it instead of coming from the issue, a worked example or a known-good literal?
- **Docs and PR description:** do `docs/CLI_REFERENCE.md`, help text, the bdg skill and the PR description say exactly what the code does? `CHANGELOG.md` must not be edited.
- **Conventions (CLAUDE.md):** CommandRunner, CommandError or `{success, error}` never both, the `BdgResponse` envelope, semantic exit codes, centralized messages, option behavior keys `<command>:--flag`, TSDoc, no inline comments, no empty catch, ~30 lines per function.
- `<change-specific risky questions; for input parsing, selectors or secret handling, ask for a sweep over a matrix of inputs and report the counts, e.g. "every form field type × every fill path">`

**Run** in `/tmp/review-<N>` with `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" BDG_TEST_SESSION_PARENT=/tmp/rv-<N>-t BDG_TEST_HOME_DIR=/tmp/rv-<N>-h BDG_SESSION_DIR=/tmp/rv-<N>`: `npm run build`, `<the targeted unit tests>` and `<one targeted smoke test>`. If a claim is cheap to check by hand (`node /tmp/review-<N>/dist/index.js …`), do it.

**Check the red commit.** `git -C ../bdg-<N> log --oneline <base>..HEAD` (`<base>`: `origin/main`, or the unmerged branch this one builds on): the first commit of this PR is `test: …` and holds only tests, fixture pages and `not implemented` skeletons. Run its tests on that commit, in a worktree of your own:
```
git -C ../bdg-<N> worktree add /tmp/red-<N> <red sha>
ln -s <main checkout>/node_modules /tmp/red-<N>/node_modules
npm --prefix /tmp/red-<N> run build    # only if the tests run against dist
(cd /tmp/red-<N> && npx tsx --test --test-concurrency=1 <the new test files>)
git -C ../bdg-<N> worktree remove --force /tmp/red-<N>
```
They must fail on an assertion about the issue (or the CLI's real output), not on a build or import error. A missing or wrong-reason red commit is **blocking**, unless the change is docs-only, a pure refactor or CI/tooling. Quote the failure line in your report.

**Budget.** At most 25 tool calls; cut test output as above (`| tail -20`, `grep -E '^# (pass|fail)|^not ok'`).

**Rules:** no `git stash`; no `pkill`/`killall`; a background process you start writes its PID to `/tmp/bdg-review-<N>-<name>.pid` and you kill only what you read back from there; don't touch `~/.bdg`, the worktree, or the main checkout (including its `.tmp/`); don't open GitHub issues. Run tests in the foreground.

**Report.** The SHA you reviewed, then findings as **blocking / should-fix / nit**, each with file:line and a concrete scenario (inputs → wrong outcome). Mark a finding **adjacent** when it is in the same file or function as the change and fixable in about 20 changed product lines plus its test without changing parsed output, flags, exit codes or defaults (the implementer fixes it in this PR); mark it **older code** when it predates the change and sits elsewhere (the orchestrator verifies and files it). Also list what you checked and found fine, and under **Not checked** anything from the list above you skipped and why (the orchestrator will resume you for it). Keep it short.

## Tester brief
Run this on the **PR branch before merging**. The tester is a fresh `general-purpose` agent with `model: sonnet` playing a real user. It gets tasks, not a description of the diff: use the **Task** lines of the scenarios that touch the change's area (`scenarios.md`), plus a task for the new behaviour if no scenario covers it yet (then add it as a scenario). Its findings about this change are fixed in the same PR; findings about older code go to the orchestrator, who sends them through the verifier and files them.

Build the branch first in its worktree (`npm run build` in `../bdg-<N>`, Node pinned), and start the fixtures **from that same worktree** if the tasks need them (`cd ../bdg-<N> && npx tsx src/__testutils__/serveFixtures.ts`): a server started elsewhere serves another branch's pages.

---

You are a coding agent who has never used bdg, a CLI for debugging Chrome. Test it on realistic tasks and report what works, what is confusing, and any bugs.

**Setup.** At the start of every shell call:
```
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"
export BDG_SESSION_DIR=/tmp/bdg-t-<N>-<agent>
bdg() { node <absolute path to ../bdg-<N>>/dist/index.js "$@"; }
```
- Never touch `~/.bdg`.
- Learn the tool the way a new user would: `bdg --help`, `bdg --help --json`, `.claude/skills/bdg/SKILL.md`. Don't read the source unless you need to confirm a bug.
- To interrupt a command, send SIGINT to its `node` PID (`kill -INT <pid>`), not to the shell function.

**Pages.** `<fixture URLs or real sites the tasks need>`. Put scratch files in `/tmp/bdg-t-<N>-<agent>-work`.

**Tasks.** Goals, not steps:
1. `<scenario Task line, or a goal that uses the new behaviour>`
2. `<goal that combines it with existing features>`
3. `<edge case: interrupt, failure, odd input>`
4. `<a real-world site if one is reachable>`

**Budget.** At most 40 tool calls; save long outputs to files under your scratch dir and `grep` them instead of reading them whole.

**Rules:**
- No `pkill`/`killall`. A background process you start writes its PID to `/tmp/bdg-t-<N>-<agent>-<name>.pid`; kill only PIDs read back from those files.
- No git commands, no repo edits (the main checkout and its `.tmp/` included), no GitHub issues: report bugs, the orchestrator files them.
- Clean up at the end: `bdg stop`, kill your own PIDs.
- Run `ls -A ~/Downloads` before and after; nothing may appear there.

**Report** the build you tested (`<head sha>`, given here), then per task, in the scenario report format: result (works / partly / broken), ease 1–10, command counts (bdg, `dom eval`, screenshots), bugs (exact command, expected vs actual output, exit code), friction, and how you discovered the right command. Then the `~/Downloads` diff.

Be concise.

## Verifier brief
After a fresh-agent round, one agent reproduces every finding about older code on current `main`, so issues are filed only for what really happens. The same brief, with the **Sweep** block filled in, runs the themed sweep at session start (then "Findings" lists the theme's open issues by number). Spawn it as a `general-purpose` agent with `model: sonnet`, in the foreground.

---

Verify the findings below against bdg on `main` at commit `<sha>`, checked out and built for you at `<absolute path of the verify worktree>` (`export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"`, `bdg() { node <absolute path of the verify worktree>/dist/index.js "$@"; }`, `BDG_SESSION_DIR=/tmp/verify-<date>`). Start the fixtures from that directory when a finding needs them (`cd <absolute path of the verify worktree> && npx tsx src/__testutils__/serveFixtures.ts & echo $! > /tmp/bdg-verify-fixtures.pid`) and kill only the PID read back from that file at the end. Keep **one bdg session at a time**: other agents may be running smoke suites on this machine.

For each finding: run the reported command (or the closest one that makes sense), paste the real output, and, when a few minutes of reading find it, name the cause with file:line. Classify it: **reproduced** (with the exact command, output and exit code), **not reproduced** (what happened instead), **by design** (where the docs or code say so, file:line), or **duplicate of** another finding or an open issue (`gh issue list --repo szymdzum/browser-debugger-cli --search "<words>"`). Group findings that share one root cause.

Findings:
1. `<finding as the tester wrote it, or "issue #N: re-run its recorded command">`
2. `<…>`

**Sweep** (themed sessions only; delete otherwise). The theme is `<theme>`. Build a page (or a few, under `/tmp/verify-<date>-pages`, served with `cd /tmp/verify-<date>-pages && python3 -m http.server <port> & echo $! > /tmp/bdg-verify-http.pid`) with `<the inputs the theme is about, e.g. secret-named fields, labels, URLs with tokens>`, run `<the commands and surfaces of the theme, human and --json, files and daemon.log>`, and grep every output for `<the literal markers>`. Report each hit as a finding of its own: command, output line, exit code, cause with file:line when a few minutes find it, and which listed finding (if any) shares its root cause.

**Budget.** At most 60 tool calls; one command per finding where possible, outputs cut to the lines that matter.

**Rules:** no git commands, no repo edits, no GitHub issues (the orchestrator files them), no `pkill`/`killall`, don't touch `~/.bdg` or `~/Downloads`; `bdg stop` at the end.

**Report.** The commit given above; one block per finding with the classification, command, output, exit code and (when found) the cause with file:line; then the groups. Be concise.
