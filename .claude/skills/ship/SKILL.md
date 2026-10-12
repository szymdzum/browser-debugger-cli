---
name: ship
description: "bdg's shipping workflow: take verified issues from the queue to merged PRs with coding subagents (implementer, fresh reviewer, fresh-agent test before merge), with bdg's commands, gates, conventions and fresh-agent test scenarios. Use when the user asks to work through issues, run a session or wave, ship a feature end to end, run a fresh-agent test round or exploratory sweep, or says 'jedziemy w cyklu'."
---

# Ship (bdg)

You are the **orchestrator**: you choose the issues, write the briefs, judge the reports, route the findings, and merge. You don't write feature code. Everything mechanical goes through the script, so your attention stays on judgment:

```bash
ship() { node "$(git rev-parse --show-toplevel)/.claude/skills/ship/scripts/ship.mjs" "$@"; }   # ship help
```

Each PR gets three independent looks before it lands, none of which sees the author's reasoning: **tests written first** that fail before the fix (the red commit), a **fresh reviewer** with the diff and the issue only, and a **fresh-agent test** in which a new agent uses the change as bdg's real users (coding agents) would. Skip none of them for behaviour changes.

Files:
- [briefs.md](briefs.md): the four briefs and their shared blocks; render them with `ship brief`. Read before spawning any subagent.
- [scenarios.md](scenarios.md): fresh-agent test rounds, the report format, scenarios S01–S15, the exploratory sweep. Read before any fresh-agent test.
- [log.md](log.md): one row per merged PR (`ship log`); the retro's data.
- [scripts/ship.mjs](scripts/ship.mjs): the commands below; its tests run in `npm test`.

## Session start

- `ship snapshot` (gate 8 compares against it).
- **Only verified issues go in.** Verified means **one command you have already run** that shows the symptom on `main`: a bdg invocation on a fixture page or a real site, a test, or a script; deterministic, or for timing bugs reproducing at a rate you can debug against. Record the command and output on the issue; it becomes the red commit's first test. Behaviour that can't be run (dead code, a wrong doc) may be confirmed with file:line. Neither: verify first or ask.
- **Themed sweep first.** A session has a theme (one root cause or one area). One verifier (verifier brief, **Sweep** block filled in) re-runs every open issue of the theme on `main` and sweeps the theme's surfaces for symptoms the issues don't name. Issues it can't reproduce get a `needs repro` comment and drop out; new symptoms join an existing issue or an umbrella issue.
- **A pick by the user** (named issues, or a mix such as "one hard, two medium, two easy") replaces the theme: the verifier re-runs the picked issues' commands instead of a sweep, and the polish sweep PR is optional.
- **Propose 4–6 issues**, one line each on why; recommend one set, no menu. Show the **balance**: issues opened vs closed since the last session (from `log.md` and the tracker), and the target of at least two closed for each one filed. At least half of a wave's PRs close issues that predate the session; a feature-only session is the user's explicit choice.
- **Polish sweep PR** (themed sessions): one tier-1 PR, last in the session, one commit per wording nit of the queue: human-output text that no test asserts and no agent parses. A `--json` field, an asserted hint or `--help --json` text is tier 2, not a sweep item.
- **Waves of at most 2 parallel implementers.** Issues touching the same files or output run in sequence. Light, conflict-free changes first; docs last.
- **Ask for merge authority** as a yes/no question: "May I merge on my own once the gates hold, or do you want to OK each PR?" A bare "OK" is not an answer. It doesn't carry over to the next session.
- **Product decisions belong to the user:** changed defaults, contracts, exit codes, removed `--json` fields. Options with a recommendation, then wait. A standing "pick the recommended option" never covers a contract change or a third fix round.

## Per PR

```
#<N> <slug>  tier <1|2|3>
- [ ] Implementer: ship brief implementer N=<N> BRANCH=<type>/<slug> → fill scope → spawn (background)
- [ ] Report ends with `PR <url> HEAD <sha>`; ship ci-wait <pr> (background)
- [ ] Reviewer: ship brief reviewer … → findings to the same implementer; Not-checked risks resumed
- [ ] Tester (tier 2–3): ship brief tester … → findings routed
- [ ] Fix rounds ≤ 2; the reviewer re-checks each fix commit (SendMessage to the same reviewer)
- [ ] Tier 3: second review of the fix commit; ship repeat for timing; optional ship codex-review
- [ ] ship gates <pr> --tier=N [--macos] [--timing --repeat=<id>] (timing PRs: always --timing); ship merge-check when it says the base changed the PR's files; ship merge <pr> (same flags)
- [ ] ship ci-wait <merge sha> --push; ship log <pr> …; issue closed or commented
```

### Implement

Render the implementer brief, fill in scope, decisions and the other agents' files, and spawn it in the **background** (models and caps: the table in `briefs.md`). Every subagent starts from a fresh context (`general-purpose` with its brief), never a fork of this conversation. Name 5–8 files to read first yourself, from the issue and memory; no Explore agent for a file map. Keep the user informed with one line per step change (started, red commit, draft PR, report in).

An implementer's report ends with `PR <url> HEAD <sha>`. Without that line the work isn't done: read the PR (`gh pr view`) and resume the agent with what's missing. Then `ship ci-wait <pr>` in the background (one per PR; it exits `superseded` when the head moves, so an old waiter never answers for a new push). A push with no `pull_request` run after 3 minutes gets a close/reopen of the PR, not a dispatch: the required `CI OK` must come from a `pull_request` run.

### Review

Render the reviewer brief with the claims of the change and its risks (races, failure and cleanup paths, leaks, security, contracts, recently merged features it could break); never the implementer's reasoning. Reviewers and testers run in the **foreground**.

- Findings come back as **blocking / should-fix / nit** with file:line and a scenario. **A risk from your list under "Not checked" means you resume the reviewer for it** before sending anything on; a review with open risks is not a review.
- Send every finding to the **same implementer** (SendMessage, so it keeps its context): test and fix in one commit, or an argued rejection; you decide disputes. Nits about the change go into the same commit, never pushed alone (every push is a full CI run).
- **Each fix commit is re-checked by the same reviewer** (SendMessage with the new SHA and the findings it addressed): cheaper than a new review and still not the author. Tier 3 adds a fresh second reviewer on the fix commit.
- **At most two fix rounds.** Findings left after the second go to the user: a third round needs an explicit yes; the alternative is to file them.
- Findings about **older code** follow the findings block in `briefs.md`: adjacent ones are fixed in the PR as their own commit; the rest go to the verifier.

### Fresh-agent test

The highest-yield step: bdg's users are agents, so the tester doesn't play the user, it is one. Run it for every tier 2–3 change with the scenarios of `scenarios.md` that touch the change's area (a fix with no new output or flag: the two closest scenarios, cap 20). Before it, the branch must contain the `main` changes to its files (`ship gates` names them), or the tester reports bugs `main` already fixed. Its findings are routed like the reviewer's.

### Tiers

| Tier | What | Review | Fresh-agent test | Red commit |
|---|---|---|---|---|
| 1 | docs, CI, tooling, refactors under existing tests, a message typo, the polish sweep (nothing parsed, no flag, exit code, default or timing changes) | reviewer | no | no (the PR says why) |
| 2 | behaviour change: new or changed output, flag, hint, default | reviewer | yes | yes |
| 3 | session lifecycle, Chrome launch, files on disk, concurrency, security, contracts, redaction or parsing | reviewer, plus a fresh second reviewer on the fix commit; `ship codex-review` optional (another model family, read-only; findings routed like the reviewer's) | yes, plus the interrupt scenario (S08) when relevant | yes; timing: `ship repeat` on the final head; redaction or parsing: the brief's case matrix is the red commit's table test |

After a round, **one verifier** reproduces all older-code findings on current `main` in one pass. **Only you file issues**, one umbrella per root cause (cause in the title, symptoms as a checklist with the verifier's command and output, milestone set); a symptom of an open issue becomes a comment on it.

## Gates

Merge only when all hold on the head SHA you merge. `ship gates <pr> --tier=N` checks the mechanical ones (M); you judge the rest (J). `ship merge <pr>` with the same flags runs the gates, merges with `--match-head-commit`, and removes the worktree if nothing is uncommitted and the branch once `main` contains it. For a PR built on another PR's branch, everything is checked against that base branch.

1. **J Review resolved:** every blocking and should-fix finding fixed or rejected with a reason you accept, re-checked on its fix commit; Not-checked risks resumed.
2. **J Fresh-agent test done** (tier 2–3), its findings about the change fixed.
3. **M+J Red commit:** the first commit is `test: …` (M); the reviewer ran it and it failed on an assertion about the issue (J). Exempt: tier 1.
4. **M Repeat run** passed on the final head (`--repeat=<id>`; `--timing` makes a missing one fail). Tier 3 timing: Linux and macOS, repeat ≥ 10; CI or environment changes: the full smoke suite with repeat ≥ 3 on Node 22 only, the full Node matrix only for the Node runtime or `engines`).
5. **M CI on the head, and `main` green:** the latest decided CI run on `main` succeeded (an in-progress run is named: wait for it only when its merge touched this PR's files, then re-run gate 6); on the head, `CI OK` (it aggregates build, quality, contract tests and Linux smoke); macOS smoke when the PR touches timing-sensitive paths (`--macos`); Security for PRs into `main`. A failing job counts as an accepted exception only with the known flake's issue number and a passing re-run; name both in the merge summary.
6. **M Mergeable and tested against current `main`:** when `main` changed the PR's files since its base, `ship merge-check <pr> <affected tests>` passed on that `main` and head, or the implementer rebased and re-ran.
7. **J Docs match** (`docs/CLI_REFERENCE.md`, help, `.claude/skills/bdg/SKILL.md`, option behaviors), **M** `CHANGELOG.md` untouched; the PR description marks changed defaults, contracts and breaking changes.
8. **M No leftovers:** nothing new in `~/.bdg` or `~/Downloads` since `ship snapshot`, no live process from this PR's PID files, no temporary worktree of it; `ship leftovers` checks the whole session at the end.

A red `main` is fixed before any new work. After a merge, `ship ci-wait <merge sha> --push`; a `cancelled` run there means a later push superseded it: its result is the later commit's.

## Keep the books

- **`ship log <pr>`** after each merge (rows accumulate in the main checkout's `log.md`; the session's retro PR commits them): tier, review findings as `blocking/should-fix/nit`, tester bugs, fix rounds, implementer model, subagent tokens, a note. When a bug is later found in a merged change, add it under **Escaped** in `log.md`.
- **Roadmap #466:** one update at the session end (done / new / moved); re-read the body right before editing.
- **Fix or file:** every finding from any step is fixed now or filed as a verified issue; never only "out of scope".
- **Reporting:** one line per step change, a summary at merges, real problems and decisions; don't relay interim notifications.
- **Releases** only when the user decides (`docs/RELEASE_PROCESS.md`).
- **One conversation per session:** start the next in a fresh conversation with the roadmap, `log.md` and the memory notes.
- **Retro at the end**, from `log.md`: what merged and was filed, what slowed the session, and for each rule or step that cost time, whether removing it would have changed an outcome (the log shows which steps found what). Remove what never catches anything; add a rule only for a failure that happened. Agreed changes go into this skill as a PR.

## Recurring traps

- **Shared registries** conflict between parallel PRs: fixture pages go in a new module in `src/__testutils__/fixturePages/`, option behaviors in their area table.
- **Heuristics pass their own fixtures.** For any detection heuristic (action effects, press or cover checks), reviewers build false-positive matrices on scratch pages; fixture-only tests passed every broken version so far.
- **"Flaky" can be a real bug.** Root-cause a flake before calling it one.
- **CodeQL or linters on test fixtures** (a variable named `SECRET`): rename, don't suppress. An open CodeQL alert on `main` gets an issue the day it appears.

## Project settings

- Repo `szymdzum/browser-debugger-cli`, default branch `main`, merge commits with subject `<PR title> (#N)`, required check `CI OK`. Push over SSH (`git@github.com:szymdzum/browser-debugger-cli.git`); after a push to the URL, `gh pr create` needs `--head <branch>`. Implementers open draft PRs; `ship merge` marks them ready.
- Milestones: "Next: hardening", "Next: agent gaps", "1.0".
- Node: v22.15.0, pinned in every shell call (the default Node may be too new); the briefs carry the line, `ship` pins it for its own runs.
- Commands: `npm run check`, `npm test`, `npm run build`; one smoke file `npx tsx --test --test-concurrency=1 src/__tests__/smoke/<file>.smoke.test.ts`; integration `./tests/run-all-tests.sh --integration`. Only affected smoke files locally; the full suite is CI's job. Long suites you run yourself go in the background with a one-line status.
- Forbidden for you as for every agent (the forbidden block in `briefs.md`): `git stash`, hook bypasses, broad `pkill`/`killall`, killing a PID not read from a file its process wrote, touching `~/.bdg`, committing in the main checkout unless asked, AI attribution, relaying an npm OTP, releasing unless the user decides.
