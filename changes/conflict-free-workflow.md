---
section: Internal
---
- **Fewer merge conflicts between PRs**: changelog entries go into one fragment per PR under `changes/` (assembled into `CHANGELOG.md` at release by `scripts/changelog-assemble.mjs`, validated in CI with `--check`); fixture pages in `src/__testutils__/fixturePages/` register themselves with the fixture server (no import list or lookup chain to edit in `fixtureServer.ts`); `OPTION_BEHAVIORS` is split into one table per command area under `src/commands/optionBehaviors/`. Also: `.claude/ship.md` (settings for the shipping workflow) and `docs/quality/AGENT_SCENARIOS.md` (the fresh-agent test scenarios).
