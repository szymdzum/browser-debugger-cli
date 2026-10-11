---
name: ship
description: "bdg's shipping workflow: take verified issues from the queue to merged PRs with coding subagents (implementer, fresh reviewer, fresh-agent test before merge), with bdg's commands, gates, conventions and fresh-agent test scenarios. Use when the user asks to work through issues, run a session or wave, ship a feature end to end, run a fresh-agent test round or exploratory sweep, or says 'jedziemy w cyklu'."
---

# Ship (bdg)

You are the **orchestrator**: you turn issues into briefs, run the subagents, hold the gates, merge and report. You don't write feature code yourself.

Each PR gets three independent looks before it lands: tests the implementer wrote first, a **fresh reviewer** who never saw the implementation, and a **fresh-agent test** in which a **tester** uses the change as a new user would. Skip none of them for behaviour changes.

Files in this skill:
- [briefs.md](briefs.md): the implementer, reviewer and tester briefs. Read it before spawning any subagent.
- [scenarios.md](scenarios.md): how to run a fresh-agent test **round**, the report format, scenarios S01–S14 and the exploratory sweep. Read it before any fresh-agent test.

## Session start

- **Only verified issues go in.** Verified means **one command you have already run** that shows the user's exact symptom on `main`: a bdg invocation on a fixture page or real site, a test, or a script. It must be deterministic, or for timing bugs reproduce at a rate you can debug against (loop it, add load). Record the command and its output in the issue; it becomes the red commit's first test. Behaviour that can't be run (dead code, a wrong doc) may be confirmed with file:line instead. No command and no file:line: verify first or ask.
- **Themed sweep first.** A session has a theme (one root cause or one area: secrets, false success, visibility). Before the proposal, one verifier agent (verifier brief with its **sweep** block filled in; prepare `../bdg-verify` on current `main` as the verifier step under "Verification tiers" describes) re-runs the command of every open issue in the theme and sweeps the theme's surfaces for what the issues don't yet name. The proposal is built from its report: issues it couldn't reproduce get a `needs repro` comment and drop out; new symptoms join an existing issue or an umbrella issue (below), not a new issue each. Session E's secrets sweep before the proposal found the shape of the work the issues only hinted at.
- **Propose 4–6 issues** with one line each on why. Recommend one set; don't present a menu. A candidate you can't reproduce in a few minutes drops out of the proposal and gets a `needs repro` comment on the issue.
- **Show the balance.** The proposal states issues opened vs closed since the last session, and the session's target: close at least two issues for each one it files. At least half of every wave's PRs, rounded up, close issues that predate this session's sweep (bugs, not features; the polish sweep PR counts, it closes nit issues); a feature session (new behaviour, nothing closed) is the user's explicit choice, never the default. Since the skill went live it filed about two issues for each one it closed; the proposal is where that is corrected.
- **Polish sweep PR.** The proposal names one tier-1 PR for the wording nits of the queue: human-output text that no test asserts and no agent parses, no flag, no exit code, no default. A `--json` field, a hint a test asserts, or `--help --json` text is tier 2, not a sweep item. It runs last in the session, together with the docs PRs, one commit per nit.
- **Waves of 2–3 parallel implementers.** Issues touching the same files or output run in sequence (the second starts from the first's branch, or after it merges). Light, conflict-free changes first; docs last.
- **Ask for merge authority** as a yes/no question: "May I merge on my own once gates 1–8 hold, or do you want to OK each PR?" A bare "OK" is not an answer; ask again. It doesn't carry over to the next session.
- **Product decisions belong to the user:** changed defaults, contracts, exit codes, removed `--json` fields. Present options with a recommendation, then wait. A standing "pick the recommended option" **never** covers a contract change or a third fix round; each gets its own yes/no question.

## Per-PR checklist

Copy one per issue into your notes and tick it off:

```
#<N> <slug>
- [ ] Brief sent (briefs.md → Implementer), worktree ../bdg-<N>
- [ ] Implementer report: red commit (SHA, failure line), before/after evidence, draft PR opened
- [ ] Fresh review (briefs.md → Reviewer), red commit checked → findings back to the same implementer
- [ ] Second review, only if the fix commit is large or risky
- [ ] Fresh-agent test on the branch (briefs.md → Tester), findings fixed in the PR
- [ ] Gates 1–8 hold on the final head SHA
- [ ] Merged, main CI green, worktree and branch removed, fixture server (PID file) killed, issue updated
- [ ] Every finding about this change fixed in the PR (nits in the fix commit); adjacent older-code findings fixed as their own commit; every other finding about older code sent to the verifier (a wording nit: to the polish sweep)
```

### Implement

Spawn one implementer per issue with the implementer brief. Fill in scope, decisions and the files other agents are working on; the brief carries the rules (red commit first, no `CHANGELOG.md` edits, forbidden commands).

**Implementers run in the background**, so a finished one gets its review while the others still work (on the first plan, a wave of three held a ready PR for 40 minutes). Keep the user informed instead: one line at each step change (started, red commit, draft PR, report in), and `git status --short` of the worktree when asked. **Reviewers and testers run in the foreground**: they take 1–5 minutes and the next step waits on them. Every subagent gets a **fresh context** (`general-purpose` / `code-reviewer`, never a fork of this conversation).

**Models (token budget, decided 2026-10-11 after a session burned the monthly MAX quota):** `model: sonnet` for the reviewer, tester, verifier, themed sweep, Explore and tier 1–2 implementers; `model: opus` only for a tier 3 implementer; never the default (Fable). The orchestrator waits for CI, not the implementer: an implementer that polls CI for 20 minutes re-reads its whole context on every poll (one did 180 tool calls, 350 k tokens). Implementers run only the affected smoke files; the full suite is CI's job (asking for it locally doubled a refactor PR's cost). Subagent reports are capped at about 40 lines; the PR body carries the detail.

An implementer's report ends with one fixed line: `PR <url> HEAD <sha>`. No such line means the work isn't done. If an agent stops without it, don't wait: read the PR state yourself (`gh pr view`) and resume the agent with what's missing. You then wait for CI on that head with one background command (Commands below) and send the review in parallel; a push with no `pull_request` run after 3 minutes gets a close/reopen of the PR, not a dispatch (the required `CI OK` must come from a pull_request run).

### Review

When the implementer reports, spawn a fresh reviewer with the reviewer brief: the diff, the issue, and the risky areas of this change (races, failure and cleanup paths, leaks, security, contract changes, recently merged features it could break). Don't pass on the implementer's reasoning.

- Findings come back as **blocking / should-fix / nit** with file:line and a scenario. A review that lists an item from your risk list under "Not checked" is incomplete: resume the reviewer for that item before you send anything on.
- Send every finding to the **same implementer** (SendMessage, so it keeps its context): a test and a fix in the same commit (no red commit per finding), or an argued rejection. You decide disputes.
- **Adjacent fix rule.** A finding (from the reviewer, the tester or the implementer) about **older code** in the same file or function as the change, fixable in about 20 changed product lines plus its test, is fixed in the same PR as its own commit (`fix: <symptom> (#<N> adjacent)`) and listed in the PR body; unless it changes parsed output, a flag, an exit code or a default, which is the user's decision first. Everything else is reported to you (never filed by the agent) and goes to the verifier. Three PRs each filed the issue their reviewer found in the function they had just changed (#601 from #597, #599 from #587, #630 from #603); each then cost a full cycle.
- A **second review** only for large or risky fix commits (rollback, file handling, concurrency).
- Every report names the SHA it looked at. A fix commit invalidates only the evidence about what it changed: re-run the review or the tester for that part, not the whole cycle.
- **At most two fix rounds.** If findings remain after the second, stop and bring the blocker to the user: a third round needs an explicit yes, whatever standing approvals exist; the alternative is to file the remaining finding. Nits are fixed in the same commit as the should-fix items, never pushed on their own (every push is a full CI run).

### Fresh-agent test

The highest-yield step. Run it for every behaviour change (tier 2 and 3 below). Use the tester brief with the scenarios from `scenarios.md` that touch the change's area. Its findings follow the review's routing: about this change → the implementer; adjacent → the implementer as its own commit; older code → the verifier.

### Verification tiers

| Tier | What | Review | Fresh-agent test | Red commit |
|---|---|---|---|---|
| 1 docs / tooling / tiny fix (no change to output, flags, exit codes or timing) | docs, CI, refactor under existing tests, a typo in a message, the session's **polish sweep** (wording nits that change no parsed output, one PR, one commit per nit; anything that changes parsed output is tier 2) | fresh reviewer | no | no (the PR says why) |
| 2 behaviour change | new or changed output, flag, hint, default | fresh reviewer | yes | yes |
| 3 high risk | session lifecycle, Chrome launch, files on disk, concurrency, security, contracts, redaction or parsing rules | fresh reviewer + second review of the fix commit | yes, plus the interrupt scenario (S08) when relevant | yes, plus repeat=10 for timing; for redaction or parsing, the brief's **case matrix** (inputs × output surfaces) is the red commit's test table |

- Findings **about this change** go back to the implementer and are fixed **in the same PR**.
- Findings about **older code** are collected for the whole round. Then **one verifier agent** (verifier brief in `briefs.md`) reproduces them all on current `main` in one pass. **Only you file issues**, and you file **one umbrella issue per root cause**: the cause in the title, the symptoms as a checklist with the verifier's command and output each, the milestone set. A symptom of an already open issue goes into that issue as a comment. Session E filed five secrets issues from one sweep; one root cause, five cycles. Don't verify 15 findings by hand, and don't file unverified ones. The verifier runs no git commands, so you prepare its checkout: `git worktree add ../bdg-verify --detach origin/main && ln -s <main checkout>/node_modules ../bdg-verify/node_modules && npm --prefix ../bdg-verify run build`, and remove it after the report (`git worktree remove ../bdg-verify`).
- **Fresh base first.** If `main` merged changes to files this PR touches since the branch was created (`git -C ../bdg-<N> log --oneline HEAD..origin/main -- <files>`), the implementer rebases **before** the fresh-agent test; otherwise the tester reports bugs `main` already fixed.
- **For a fix that adds no new output or flag**, the tester gets the two scenarios closest to the change, not four tasks.
- **Start the fixtures from the worktree of the branch under test** (`npx tsx src/__testutils__/serveFixtures.ts` in `../bdg-<N>`), never from another worktree or the main checkout: a tester once got a page the branch had added from a server that didn't have it. Start it as `npx tsx src/__testutils__/serveFixtures.ts & echo $! > /tmp/bdg-fixtures-<N>.pid` and kill that PID when the tester reports (one server ran for 2.5 h after its round).

### Merge

When every gate below holds:

```bash
R=szymdzum/browser-debugger-cli
sha=$(gh pr view <n> --repo $R --json headRefOid -q .headRefOid)          # the SHA the gates were checked on
gh pr ready <n> --repo $R
gh pr merge <n> --repo $R --merge --match-head-commit $sha --subject "<PR title> (#<n>)"
m=$(gh pr view <n> --repo $R --json mergeCommit -q .mergeCommit.oid)
gh run list --repo $R --branch main --json headSha,name,status,conclusion -q ".[]|select(.headSha==\"$m\")"   # until done, macOS included
git -C ../bdg-<N> status --short                                          # anything modified or untracked that matters? look before you remove
git worktree remove ../bdg-<N> && git branch -D <branch>                  # no --force; GitHub deletes the remote branch
```

A red `main` is fixed before any new work. Merge when the latest completed `CI` run on `main`'s head (or an ancestor, with no failed run after it) is green (macOS when gate 5 requires it for this PR); an in-progress run of a merge that doesn't touch this PR's files is not a reason to wait (session E held an independent PR for a run that could not affect it). If it does touch them, wait for it and re-check gate 6. Close the issue, or comment with what's left, if the PR didn't.

## Gates

Merge only when **all** hold. If one fails, fix it; don't negotiate it.

1. **Review resolved.** Every blocking and should-fix finding fixed or rejected with a reason you accept; nits about this change fixed in the fix commit, nits about older code in the polish sweep or with the verifier.
2. **Fresh-agent test done** on the branch (features and behaviour changes), its findings about this change fixed in the PR.
3. **Red commit verified.** The first commit holds only the tests for the issue's reproduction and each **testable** acceptance criterion (plus fixtures and `not implemented` skeletons); the PR says which criteria are measurements or docs and how they were checked, and the reviewer ran them on it: they fail on an assertion about the issue, not a build or import error. Exempt: docs-only, pure refactors covered by existing tests, CI/tooling (the PR says which). Review-fix commits carry their test with the fix. Self-reported "it failed before" doesn't count.
4. **Timing-sensitive tests** passed the CI repeat dispatch with repeat ≥ 10 on Linux and macOS. CI or environment changes (browser, runner, tooling): the full smoke suite with repeat ≥ 3 on **Node 22 only** (`-f node=22`); the full Node matrix only when the change touches the Node runtime or `package.json` engines.
5. **CI on the final head commit** (`gh pr view <n> --json headRefOid` matches what you checked; never `--watch`), in three classes:
   - **required:** `CI OK` passed (it aggregates changes, build, quality, contract tests and Linux smoke; Security and macOS are outside it);
   - **additionally required for this PR:** macOS smoke when the PR touches timing-sensitive paths, the repeat dispatch for tier 3 timing changes, Security Audit for dependency changes;
   - **accepted exceptions:** a failing job counts as an exception only with an issue number for the known flake and a passing re-run of that job; name both in the merge summary.
6. **Mergeable on current `main`** (`gh pr view <n> --json mergeable`; `UNKNOWN` right after a push means re-check), **and tested against it**: when `main` has merged changes to the PR's files since its last rebase, either the implementer rebases and re-runs, or you run a merge-check yourself: `tree=$(git merge-tree --write-tree origin/main <branch>)` (a conflict exits non-zero), then `git worktree add /tmp/mc-<N> $tree`, link `node_modules`, `npm run check`, the affected unit and smoke files, remove the worktree. After any rebase: typecheck and the affected tests re-run, no conflict markers.
7. **Docs match the behaviour:** `docs/CLI_REFERENCE.md`, help text, `.claude/skills/bdg/SKILL.md`, option behaviors. `CHANGELOG.md` untouched; the PR description says what changed for users and marks changed defaults, contracts and breaking changes.
8. **No leftovers:** no temp files in the repo, no stray agent processes, nothing **new** in `~/.bdg` or `~/Downloads` (compare with the snapshot taken before the agents ran).

## Keep the books

- **Roadmap #466:** one update at the end of the session (done / new / moved), not after every merge; re-read the body right before editing, GitHub ticks tasklist items on its own.
- **Fix or file:** every finding from any step is fixed now or filed as a verified issue. Never only "out of scope" in a PR body or summary.
- **Only the orchestrator files issues.** Implementers, reviewers and testers report findings in their report; you send them through the verifier and file umbrella issues. An implementer once filed an issue without a repro (#630 from #603), which the next session had to verify again.
- **Reporting:** one line at each step change (agent started, report in, review sent back, test started), a summary at merges, real problems and decisions. Don't relay every background notification or stale watcher.
- **Releases** only when the user decides (`docs/RELEASE_PROCESS.md`), never at the end of a session by default.
- **Retro at session end,** in a few lines: what merged and was filed, what slowed the session, what was unnecessary, one or two process changes. Agreed changes go into this skill (on a branch, as a PR); memory keeps only the reasons.

## Recurring traps

- **Shared registries** conflict between parallel PRs. Fixture pages: a new module in `src/__testutils__/fixturePages/` exporting `ROUTES`, never an edit to `fixtureServer.ts`. Option behaviors: the area table in `src/commands/optionBehaviors/<area>.ts`.
- **A rebase after the agent's last test run:** re-run typecheck and the affected tests before merging.
- **A new test that passed on its first run** is at best a regression test. Ask what it would have caught; the report must say.
- **"Flaky" can be a real bug.** Root-cause a flake before calling it one; several were product bugs or tests asserting wrong timing.
- **A report without the final `PR … HEAD …` line** is not done. Read the PR state yourself and resume the agent.
- **CodeQL or linters on test fixtures** (e.g. a variable named `SECRET`): rename, don't suppress. An open CodeQL alert on `main` gets an issue the day it appears; six sat there without one until the session D retro.

## Project settings

### Repo
- `gh --repo szymdzum/browser-debugger-cli`, default branch `main`.
- Merge commits, subject `<PR title> (#N)`. Required check: `CI OK`.
- Push over SSH: `git push -u git@github.com:szymdzum/browser-debugger-cli.git <branch>`. After a push to the URL, `gh pr create` needs `--head <branch>` (the branch isn't tracked under the `origin` name).
- The implementer opens a draft PR with the full body; you add the review summary and mark it ready.
- Roadmap: #466. Milestones: "Next: hardening", "Next: agent gaps", "1.0".

### Environment
- Node: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"` at the start of every shell call (no `.nvmrc`; the default Node may be too new).
- Worktrees: `git worktree add ../bdg-<N> -b <type>/<slug> origin/main`, then `ln -s <main checkout>/node_modules ../bdg-<N>/node_modules`. Each builds its own `dist`; never rebuild one other agents use.
- Tests: `BDG_TEST_SESSION_PARENT=/tmp/bt-<N>` and `BDG_TEST_HOME_DIR=/tmp/bt-<N>-h`, **one pair per worktree**: each test process gets its own session dir under the parent (removed on exit), in a short path an agent can tell apart from other agents'. Not `BDG_TEST_SESSION_DIR`: that is one fixed dir shared by every test process of the run (#576). Manual sessions: `BDG_SESSION_DIR=/tmp/...`.
- `node_modules` is a symlink to the main checkout: never `npm install` through it; a PR that changes `package-lock.json` runs its own `npm ci` in the worktree instead.

### Commands
- Check `npm run check` (release: `npm run check:enhanced`), unit `npm test`, build `npm run build`.
- Smoke, one file: `npx tsx --test --test-concurrency=1 src/__tests__/smoke/<file>.smoke.test.ts`. Integration: `./tests/run-all-tests.sh --integration`.
- CI repeat (Linux and macOS): `gh workflow run ci.yml --repo szymdzum/browser-debugger-cli --ref <branch> -f smoke_files='<space-separated paths>' -f repeat=10 -f node=22`. `node` picks the one Node version of the smoke jobs (22, 24 or 26; push and nightly run all three). No brace globs, no `debug=true` (#510).
- You (not subagents) run long suites in the background with a one-line status and a timeout; never block silently for minutes.
- Wait for CI, the one way (background, `timeout` ≥ 1800000 ms). Wait for each expected **workflow by name**, because the PR workflows (`CI`, `Security`) are created at different moments and a loop over "all runs of the commit" can end when the first is done and the second doesn't exist yet:
  ```bash
  R=szymdzum/browser-debugger-cli; sha=<full sha>            # PR head or merge commit
  for wf in CI Security; do      # a PR based on another PR's branch gets no Security run (it triggers on base main only): wait for CI alone
    until [ "$(gh run list --repo $R --commit $sha --workflow $wf --json status -q '.[0].status')" = completed ]; do sleep 60; done
  done
  gh run list --repo $R --commit $sha --json name,conclusion -q '.[]|"\(.name) \(.conclusion)"'
  ```
  For a PR also run `gh pr checks <n>` once at the end (it lists the jobs; it doesn't wait).

### Forbidden
- `git stash`; `git commit --no-verify` or any other hook bypass; broad `pkill`/`killall`/`pkill -P`. Kill only a PID read from a file the process wrote at start (this file names `/tmp/bdg-fixtures-<N>.pid` for the tester's fixture server; the briefs name `/tmp/bdg-impl-<N>-<name>.pid`, `/tmp/bdg-review-<N>-<name>.pid`, `/tmp/bdg-t-<N>-<agent>-<name>.pid`, `/tmp/bdg-verify-fixtures.pid`), never one remembered or looked up with `ps`/`lsof`: an implementer killed two PIDs from memory and one belonged to another agent's session. A stray bdg process without a PID file is ended with `bdg stop` / `bdg cleanup --force` in its `BDG_SESSION_DIR`, or brought to the user.
- Touching `~/.bdg`, other worktrees or the main checkout from an agent; leaving files in `~/Downloads`.
- Committing in the main checkout without being asked (implementers commit and push in their own worktree; their brief grants that); AI attribution; relaying an npm OTP through chat; releasing unless the user decides.
