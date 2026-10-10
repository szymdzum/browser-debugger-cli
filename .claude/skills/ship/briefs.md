# Brief templates

Self-contained prompts for the subagents. Fill in the `<…>` parts and send the text below the `---` line. Each brief repeats the rules the agent must follow, because the agent sees nothing but its brief and the repo.

## Contents
- Implementer brief (`general-purpose` agent, own worktree, opens a draft PR)
- Reviewer brief (fresh `code-reviewer` agent, diff only)
- Tester brief (fresh `general-purpose` agent, the fresh-agent test on the PR branch)

## Implementer brief
Fill in the `<…>` parts; the rest is bdg's settings already. Keep it self-contained: the implementer has no context beyond this text and the repo. Spawn it as a `general-purpose` agent.

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
- Contracts: `--json` output in the `BdgResponse` envelope, additive only; exit codes from `src/utils/exitCodes.ts`; messages centralized (`src/ui/messages`, `src/errors/messages.ts`); CommandError or `{success, error}`, never both.
- Update the docs that describe this behaviour: `docs/CLI_REFERENCE.md`, help text, `.claude/skills/bdg/SKILL.md`, and the area table in `src/commands/optionBehaviors/<area>.ts` for non-obvious flags.
- Don't edit `CHANGELOG.md`. The PR description is the changelog source: say what changed for users, and mark changed defaults, contracts and breaking changes (with what to do).
- New fixture pages go in a new module in `src/__testutils__/fixturePages/`; don't edit `fixtureServer.ts`.

**Tests**
- Write a failing test first, then the fix. Report which tests failed before the change.
- Tests must be deterministic. Wait for an observable event (a log line, a request, a DOM change, a file), never a fixed sleep. If anything is timing-sensitive, dispatch `gh workflow run ci.yml --repo szymdzum/browser-debugger-cli --ref <branch> -f smoke_files='<space-separated paths>' -f repeat=10` (no brace globs, no `debug=true`) and report the run ID.
- Collect before/after evidence: real command output or a measurement on a fixture page (`npx tsx src/__testutils__/serveFixtures.ts`) or a real site.

**Verify**
- Environment, at the start of every shell call: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"`, `BDG_TEST_SESSION_DIR` and `BDG_TEST_HOME_DIR` under `/tmp` (short paths), `BDG_SESSION_DIR=/tmp/...` for manual runs.
- Run `npm run check`, `npm test`, `npm run build`, and the affected smoke files (`npx tsx --test --test-concurrency=1 src/__tests__/smoke/<file>.smoke.test.ts`). CI runs the full smoke suite. Run every suite in the **foreground** (a background run is lost when your turn ends; the report must contain its exit line).
- Push over SSH: `git push -u git@github.com:szymdzum/browser-debugger-cli.git <branch>`.
- Open a **draft PR** (`gh pr create --draft --head <branch> --repo szymdzum/browser-debugger-cli`; `--head` is needed after a push to the SSH URL) with a full body: what changed for users, before/after, verification with run IDs, decisions you made, and known limits. Link the issue (`Closes #N`).
- **Don't return before the draft PR is open.** An interim report ("waiting for tests", "waiting for CI") is not a result; finish the checks first.
- No AI attribution in commits or the PR.

**Rules**
- No `git stash`. The stash list is shared across worktrees.
- No `pkill`, `killall` or `pkill -P`. Kill only PIDs you started.
- Never touch `~/.bdg`, other worktrees, or the main checkout (including its `.tmp/`). Nothing may land in `~/Downloads`.
- Other agents are working in parallel on `<their areas and files>`. Stay out of those, and keep your edits to shared files (registries, docs) minimal and additive.

**Report.** What changed, decisions with reasons, before/after evidence, test and CI results with run IDs, the commit hash, the PR URL, and any finding outside your scope (I'll file it).

## Reviewer brief
The reviewer must be a **fresh agent** that hasn't seen the implementation discussion: spawn it as a `code-reviewer` agent (read-only tools plus Bash). Give it the diff, the issue, and the risky areas. Don't give it the implementer's reasoning.

---

Review `<branch>` in the worktree `../bdg-<N>` (bdg). Diff it against `origin/main`, and don't modify the worktree. Put scratch files in `/tmp/review-<N>`.

**Context.** Issue `<#N>` (`gh issue view <N> --repo szymdzum/browser-debugger-cli`). The change:
- `<3–8 bullets: what it claims to do, including design choices>`

**Check carefully:**
- **Correctness:** check each claim against the code, and each acceptance criterion against the tests.
- **Failure and cleanup paths:** errors, timeouts, interrupts (Ctrl-C/SIGTERM), partial failures. Does every path release what it acquired (listeners, sockets, temp files, flags)?
- **Concurrency:** races between concurrent commands, between an event and the command that waits for it, and between a switch or rollback and late events.
- **Resource bounds:** memory caps, output size (including token cost for agent users), file sizes.
- **Security:** secrets in output, logs or errors; file writes (symlinks, permissions, atomicity); injection; prototype pollution.
- **Contracts:** is the `--json` shape additive only? Exit codes, changed defaults (does the PR description mark them as changed?), backwards compatibility.
- **Interaction with recent work:** `<recently merged features this could break>`.
- **Tests:** do they test the claim? Would they fail on the old code? Are they deterministic (no fixed sleeps)?
- **Docs and PR description:** do `docs/CLI_REFERENCE.md`, help text, the bdg skill and the PR description say exactly what the code does? `CHANGELOG.md` must not be edited.
- **Conventions (CLAUDE.md):** CommandRunner, CommandError or `{success, error}` never both, the `BdgResponse` envelope, semantic exit codes, centralized messages, option behavior keys `<command>:--flag`, TSDoc, no inline comments, no empty catch, ~30 lines per function.
- `<change-specific risky questions>`

**Run** with `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"` and `BDG_TEST_SESSION_DIR`/`BDG_TEST_HOME_DIR`/`BDG_SESSION_DIR` under `/tmp`: `npm run build`, `<the targeted unit tests>` and `<one targeted smoke test>`. If a claim is cheap to check by hand (`node ../bdg-<N>/dist/index.js …`), do it.

**Rules:** no `git stash`; no `pkill`/`killall`; don't touch `~/.bdg`, the worktree, or the main checkout (including its `.tmp/`). Run tests in the foreground.

**Report.** Findings as **blocking / should-fix / nit**, each with file:line and a concrete scenario (inputs → wrong outcome). Also list what you checked and found fine. Keep it short.

## Tester brief
Run this on the **PR branch before merging**. The tester is a fresh `general-purpose` agent playing a real user. It gets tasks, not a description of the diff: use the **Task** lines of the scenarios that touch the change's area (`scenarios.md`), plus a task for the new behaviour if no scenario covers it yet (then add it as a scenario). Its findings about this change are fixed in the same PR; findings about older code become new issues.

Build the branch first in its worktree (`npm run build` in `../bdg-<N>`, Node pinned), and start the fixtures if the tasks need them (`npx tsx src/__testutils__/serveFixtures.ts`).

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

**Rules:**
- No `pkill`/`killall`; kill only PIDs you started.
- No git commands and no repo edits (the main checkout and its `.tmp/` included).
- Clean up at the end: `bdg stop`, kill your own PIDs.
- Run `ls -A ~/Downloads` before and after; nothing may appear there.

**Report**, per task, in the scenario report format: result (works / partly / broken), ease 1–10, command counts (bdg, `dom eval`, screenshots), bugs (exact command, expected vs actual output, exit code), friction, and how you discovered the right command. Then the `~/Downloads` diff.

Be concise.
