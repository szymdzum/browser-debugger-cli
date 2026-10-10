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

- **Only verified issues go in:** reproduced, or confirmed in the code with file:line. Verify first or ask.
- **Propose 4–6 issues** with one line each on why. Recommend one set; don't present a menu.
- **Waves of 2–3 parallel implementers.** Issues touching the same files or output run in sequence (the second starts from the first's branch, or after it merges). Light, conflict-free changes first; docs last.
- **Ask for merge authority:** merge on green, or the user's OK per PR. It doesn't carry over to the next session.
- **Product decisions belong to the user:** changed defaults, contracts, exit codes. Present options with a recommendation, then wait.

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
- [ ] Merged, main CI green, worktree and branch removed, issue and roadmap updated
- [ ] Every finding fixed or filed
```

### Implement

Spawn one implementer per issue with the implementer brief. Fill in scope, decisions and the files other agents are working on; the brief carries the rules (red commit first, no `CHANGELOG.md` edits, forbidden commands).

Run subagents in the **foreground** (`run_in_background: false`), so the user sees them work; between steps give the user one line on what is happening and where (`git status --short` in the agent's worktree is enough). Background runs are for your own CI polls only.

### Review

When the implementer reports, spawn a fresh reviewer with the reviewer brief: the diff, the issue, and the risky areas of this change (races, failure and cleanup paths, leaks, security, contract changes, recently merged features it could break). Don't pass on the implementer's reasoning.

- Findings come back as **blocking / should-fix / nit** with file:line and a scenario.
- Send every finding to the **same implementer** (SendMessage, so it keeps its context): a test and a fix in the same commit (no red commit per finding), or an argued rejection. You decide disputes.
- A **second review** only for large or risky fix commits (rollback, file handling, concurrency).

### Fresh-agent test

The highest-yield step. Run it for every feature or behaviour change; skip it only for tiny fixes and docs. Use the tester brief with the scenarios from `scenarios.md` that touch the change's area.

- Findings **about this change** go back to the implementer and are fixed **in the same PR**.
- Findings about **older code** become a verified issue in the right milestone.

### Merge

When every gate below holds:

```bash
gh pr ready <n> --repo szymdzum/browser-debugger-cli
gh pr merge <n> --repo szymdzum/browser-debugger-cli --merge --subject "<PR title> (#<n>)"
gh run list --repo szymdzum/browser-debugger-cli --branch main --limit 3   # until the push run is done, macOS included
git worktree remove --force ../bdg-<N> && git branch -D <branch>          # GitHub deletes the remote branch
```

A red `main` is fixed before any new work. Close the issue, or comment with what's left, if the PR didn't.

## Gates

Merge only when **all** hold. If one fails, fix it; don't negotiate it.

1. **Review resolved.** Every blocking and should-fix finding fixed or rejected with a reason you accept; nits fixed or filed.
2. **Fresh-agent test done** on the branch (features and behaviour changes), its findings about this change fixed in the PR.
3. **Red commit verified.** The first commit holds only the new tests and fixtures, and the reviewer ran them on it: they fail on an assertion about the issue, not a build or import error. Exempt: docs-only, pure refactors covered by existing tests, CI/tooling (the PR says which). Review-fix commits carry their test with the fix. Self-reported "it failed before" doesn't count.
4. **Timing-sensitive tests** passed the CI repeat dispatch with repeat ≥ 10 on Linux and macOS. CI or environment changes (browser, runner, tooling): the full smoke suite with repeat ≥ 3.
5. **`CI OK` green on the final head commit:** `gh pr checks <n>` with no `fail` or `pending` line (never `--watch`), and the head SHA matches what you checked (`gh pr view <n> --json headRefOid`). macOS smoke runs on timing-sensitive PRs; it isn't part of `CI OK` but must be green or a known, filed flake.
6. **Mergeable on current `main`** (`gh pr view <n> --json mergeable`; `UNKNOWN` right after a push means re-check). After a rebase: typecheck and the affected tests re-run, no conflict markers.
7. **Docs match the behaviour:** `docs/CLI_REFERENCE.md`, help text, `.claude/skills/bdg/SKILL.md`, option behaviors. `CHANGELOG.md` untouched; the PR description says what changed for users and marks changed defaults, contracts and breaking changes.
8. **No leftovers:** no temp files in the repo, no stray agent processes, nothing in `~/.bdg` or `~/Downloads`.

## Keep the books

- **After each merge:** update roadmap #466 (done / new / moved).
- **Fix or file:** every finding from any step is fixed now or filed as a verified issue. Never only "out of scope" in a PR body or summary.
- **Reporting:** one line at each step change (agent started, report in, review sent back, test started), a summary at merges, real problems and decisions. Don't relay every background notification or stale watcher.
- **Releases** only when the user decides (`docs/RELEASE_PROCESS.md`), never at the end of a session by default.
- **Retro at session end,** in a few lines: what merged and was filed, what slowed the session, what was unnecessary, one or two process changes. Agreed changes go into this skill (on a branch, as a PR); memory keeps only the reasons.

## Recurring traps

- **Shared registries** conflict between parallel PRs. Fixture pages: a new module in `src/__testutils__/fixturePages/` exporting `ROUTES`, never an edit to `fixtureServer.ts`. Option behaviors: the area table in `src/commands/optionBehaviors/<area>.ts`.
- **A rebase after the agent's last test run:** re-run typecheck and the affected tests before merging.
- **A new test that passed on its first run** tests nothing yet. Ask what it would have caught.
- **"Flaky" can be a real bug.** Root-cause a flake before calling it one; several were product bugs or tests asserting wrong timing.
- **Interim "waiting for CI" reports** are not done. Wait for the final report.
- **CodeQL or linters on test fixtures** (e.g. a variable named `SECRET`): rename, don't suppress.

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
- Tests: `BDG_TEST_SESSION_DIR` and `BDG_TEST_HOME_DIR` under `/tmp` (socket paths are too long otherwise). Manual sessions: `BDG_SESSION_DIR=/tmp/...`.

### Commands
- Check `npm run check` (release: `npm run check:enhanced`), unit `npm test`, build `npm run build`.
- Smoke, one file: `npx tsx --test --test-concurrency=1 src/__tests__/smoke/<file>.smoke.test.ts`. Integration: `./tests/run-all-tests.sh --integration`.
- CI repeat (Linux and macOS): `gh workflow run ci.yml --repo szymdzum/browser-debugger-cli --ref <branch> -f smoke_files='<space-separated paths>' -f repeat=10`. No brace globs, no `debug=true` (#510).
- Run long suites in the background with a one-line status; never block silently for minutes.

### Forbidden
- `git stash`; broad `pkill`/`killall`/`pkill -P` (kill only PIDs you started).
- Touching `~/.bdg`, other worktrees or the main checkout from an agent; leaving files in `~/Downloads`.
- Committing without being asked; AI attribution; relaying an npm OTP through chat; releasing unless the user decides.
