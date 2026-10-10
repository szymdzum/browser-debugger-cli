# Changelog fragments

Every PR with a user-visible or notable internal change adds **one file** here instead of editing `CHANGELOG.md`. Two PRs never edit the same lines, so they don't conflict over the changelog. At release time `scripts/changelog-assemble.mjs` moves the fragments into `CHANGELOG.md` and deletes them.

## Format

`changes/<issue>-<slug>.md`, e.g. `changes/454-auth-state.md`:

```markdown
---
section: Added
---
- **Save and load browser auth state** (#454): what was wrong or missing, what bdg does now, what to do.
```

- `section` is one of `Breaking`, `Added`, `Changed`, `Fixed`, `Security`, `Internal` (written in that order). Changed defaults or contracts go under `Changed`; a change that needs users to act goes under `Breaking` and says what to do.
- The body is the entry exactly as it should appear in the changelog: one or more list items, sub-items allowed. Write it like the existing entries: a bold title, the issue or PR number, then the details.
- One fragment per PR. A PR that changes several things in one area can use one entry with sub-items; unrelated changes in one PR can use two fragments.
- Fragments are assembled in file name order, after the entries already under `## [Unreleased]`.
- Docs-only or test-only PRs that users won't notice need no fragment.

## Commands

```bash
node scripts/changelog-assemble.mjs --check                 # validate (CI runs this on every PR)
node scripts/changelog-assemble.mjs                         # move fragments under ## [Unreleased]
node scripts/changelog-assemble.mjs --version 0.X.Y         # release: ## [Unreleased] becomes ## [0.X.Y] - <today>
node scripts/changelog-assemble.mjs --version 0.X.Y --date 2026-10-11
```

`--check` fails when a fragment has no front matter, an unknown field, a section that isn't one of the six, an empty body, or a body that isn't a list item.
