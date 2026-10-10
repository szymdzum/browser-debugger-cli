# Shipping settings (bdg)

The `ship-issues` skill reads this file. Human contributors: see CLAUDE.md and docs/quality/TEST_GUIDE.md.

## Repo
- Remote: github.com/szymdzum/browser-debugger-cli (`gh --repo szymdzum/browser-debugger-cli`)
- Default branch: main
- Merge style: merge commit, subject `<PR title> (#N)`
- Push: over SSH, `git push -u git@github.com:szymdzum/browser-debugger-cli.git <branch>`. HTTPS pushes can fail.
- Who merges: ask the user at the start of each session
- Who opens the PR: the implementer, as a draft with a full body (what changed, why, verification with CI run IDs); it goes ready for review once the gates pass

## Environment
- Runtime pin: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"`. The repo has no .nvmrc, and the default Node may be too new.
- Worktree deps: `ln -s <main checkout>/node_modules ../bdg-<N>/node_modules`, then build in the worktree. Never rebuild a dist shared with other agents.
- Test env: `BDG_TEST_SESSION_DIR` and `BDG_TEST_HOME_DIR` under /tmp. Socket paths are too long otherwise.
- Manual sessions: `BDG_SESSION_DIR=/tmp/...`. Never use `~/.bdg`.

## Commands
- Check: `npm run check` (release: `npm run check:enhanced`)
- Unit: `npm test`
- Build: `npm run build`
- Smoke, one file: `npx tsx --test --test-concurrency=1 src/__tests__/smoke/<file>.smoke.test.ts`
- Integration: `./tests/run-all-tests.sh --integration`
- CI repeat: `gh workflow run ci.yml --repo szymdzum/browser-debugger-cli --ref <branch> -f smoke_files='<space-separated paths>' -f repeat=10`. Don't use brace globs, and don't use `debug=true` (#510).
- PR checks: `gh pr checks <n>`. Don't use `--watch`.

## Gates
- Required check: `CI OK`. macOS smoke runs on PRs that touch timing-sensitive paths. It isn't part of CI OK, but it must be green or a known, filed flake.
- Timing-sensitive tests: repeat=10 on Linux and macOS before merge (docs/quality/TEST_GUIDE.md).
- CI or environment changes (browser, runner, tooling): dispatch the full smoke suite with repeat ≥ 3 before merge.
- After merge, watch main's push run, including macOS.

## Changelog
- One fragment per PR: `changes/<issue>-<slug>.md` with front matter `section: Breaking|Added|Changed|Fixed|Security|Internal` and the entry as a list item. Never edit `CHANGELOG.md` in a feature PR. Format: `changes/README.md`.
- Changed defaults or contracts go under Changed; Breaking says what to do.
- Validate locally: `node scripts/changelog-assemble.mjs --check` (CI runs it in Code Quality).
- Release PR only: `node scripts/changelog-assemble.mjs --version 0.X.Y` moves the fragments and `## [Unreleased]` into the version section (docs/RELEASE_PROCESS.md).

## Conflict-prone files (avoid shared edit points)
- Fixture pages: a new module in `src/__testutils__/fixturePages/` exporting `ROUTES`; don't edit `fixtureServer.ts` for static pages.
- Option behaviors: the area table in `src/commands/optionBehaviors/<area>.ts`, not a shared list.

## Forbidden
- `git stash`: the user's stashes live in the shared list.
- Broad `pkill`/`killall`/`pkill -P`.
- Touching `~/.bdg`.
- Leaving test downloads in `~/Downloads`.
- Committing without being asked.
- AI attribution.
- Relaying an npm OTP through chat.
- Releasing unless the user decides.

## Conventions to quote in briefs (CLAUDE.md)
- CommandRunner. Throw CommandError or return `{success, error}`, never both.
- The BdgResponse JSON envelope. Exit codes from `src/utils/exitCodes.ts`.
- Centralized messages in `src/ui/messages` and `src/errors/messages.ts`.
- OPTION_BEHAVIORS keys are `<last command name>:--long-flag` (a test enforces this).
- TSDoc on all functions. No inline comments. About 30 lines per function. No empty catch.
- Update `docs/CLI_REFERENCE.md` and `.claude/skills/bdg/SKILL.md` when behaviour changes.

## Tracking
- Roadmap: #466. Milestones: "Next: hardening", "Next: agent gaps", "1.0".
- Fix or file: every finding is fixed now or filed as a verified issue.

## Fresh-agent test setup
- Run the branch build with `node <worktree>/dist/index.js` and `BDG_SESSION_DIR=/tmp/...`. Send SIGINT to the node PID directly, not through a shell function.
- Scenarios: docs/quality/AGENT_SCENARIOS.md.
- Protected dir: diff `~/Downloads` before and after.
