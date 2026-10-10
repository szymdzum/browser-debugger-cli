# Release Process

How to release `browser-debugger-cli`. The version bump and CHANGELOG go through a pull request; publishing the GitHub release for the new tag starts the [Release workflow](../.github/workflows/release.yml), which publishes to npm with **npm Trusted Publishing** (OIDC): no npm token and no one-time password.

## Table of Contents

- [One-Time Setup](#one-time-setup)
- [CI Gate](#ci-gate)
- [Release Types](#release-types)
- [Step-by-Step Process](#step-by-step-process)
- [Prereleases](#prereleases)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)
- [Release Templates](#release-templates)

## One-Time Setup

1. **Trusted Publisher on npm** (package owner, on npmjs.com): package `browser-debugger-cli` → **Settings** → **Trusted Publisher** → **GitHub Actions**:
   - Organization or user: `szymdzum`
   - Repository: `browser-debugger-cli`
   - Workflow filename: `release.yml`
   - Environment: leave empty
2. Optional, recommended once a release went through the workflow: in the same settings set **Publishing access** to "Require two-factor authentication and disallow tokens". Trusted Publishing keeps working; no token can publish.
3. GitHub CLI authenticated locally (`gh auth status`).

No `NPM_TOKEN` secret is needed.

## CI Gate

Branch protection on `main` requires one status check, exactly `CI OK` (job `ci-ok` in [ci.yml](../.github/workflows/ci.yml)), with "Do not allow bypassing the above settings" on, so admins can't merge past it either (`enforce_admins`). The setting is applied by hand, and only once a `ci.yml` with the `CI OK` job is on `main`; before that, PRs would wait for a check that never reports.

- **CI OK** passes when Build, Code Quality, Contract Tests (Node 22/24/26) and Smoke Tests all succeeded or were skipped, and fails when any of them failed or was cancelled. Matrix changes don't touch the protection settings.
- A docs-only PR (only `*.md`, `docs/**`, `.gitignore`, `LICENSE`) skips those jobs and still gets a green **CI OK**.
- PRs run smoke on Node 22; `main` and the nightly run use Node 22/24/26, plus macOS smoke (Node 22, Google Chrome), which is not part of **CI OK**.
- macOS smoke can be run on any branch by hand, to investigate macOS-only failures: `gh workflow run ci.yml --ref <branch> -f name_pattern="<test name>" -f repeat=5 -f node=22 -f debug=true`. Session logs are uploaded as the `smoke-logs-macos` artifact.
- The security audit (`npm audit`) is report-only: it is not part of **CI OK**, so a new advisory doesn't block unrelated merges.
- The Release workflow refuses a tag unless the `CI OK` job passed in a CI run from a push to `main` for the tagged commit (the audit and macOS smoke don't count). Two merges in quick succession can leave the middle commit without a push run (a queued run is replaced by the newer one), so tag the head of `main`.

## Release Types

Follow [Semantic Versioning](https://semver.org/). While the version is `0.x`, a breaking change bumps the minor version (`0.8.0` → `0.9.0`); fixes bump the patch version.

## Step-by-Step Process

### 1. Release pull request

On a branch from an up-to-date `main`:

1. **CHANGELOG.md**: write the new version's section from the PRs merged since the last tag. PRs don't edit `CHANGELOG.md`; their descriptions are the source.
   ```bash
   gh pr list --repo szymdzum/browser-debugger-cli --state merged --base main \
     --search "merged:>=$(git log -1 --format=%cs v0.PREV)" --limit 200 --json number,title,body
   ```
   Move anything under `## [Unreleased]` into `## [0.X.Y] - YYYY-MM-DD`, add one user-facing entry per change (with the PR or issue number), in the order Breaking, Added, Changed, Fixed, Security, Internal, and leave an empty `## [Unreleased]` above it. Changed defaults or contracts go under Changed; breaking entries say what to do. Skip PRs users won't notice (docs-only, test-only) unless they matter to contributors (Internal). Skip PRs that already have an entry under `## [Unreleased]` (up to #569, PRs wrote their own), and PRs merged on the tag's day before the tag (`merged:>=` matches the whole day).
2. **Version**: set `"version": "0.X.Y"` in `package.json` and in the two root entries of `package-lock.json` (or `npm version 0.X.Y --no-git-tag-version`).
3. **README.md**: update if commands, requirements or install instructions changed.
4. Check locally:
   ```bash
   npm run check:enhanced
   npm run build && node dist/index.js --version   # prints 0.X.Y
   npm test
   npm run test:smoke
   ./tests/run-all-tests.sh --integration
   ```
5. Commit `chore: release v0.X.Y`, open the PR, wait for green CI, merge.

### 2. Tag and GitHub release

```bash
git checkout main && git pull
git tag v0.X.Y
git push origin v0.X.Y
gh release create v0.X.Y --title "v0.X.Y" --notes-file release-notes.md --latest
```

Release notes: an overview, highlights, **breaking changes with what to do**, thanks to contributors, the install command (`npm install -g browser-debugger-cli`) and the compare link (`.../compare/v0.PREV...v0.X.Y`).

### 3. npm publish (automatic)

Publishing the release starts the **Release** workflow. It checks out the tag, verifies the tag matches `package.json` and that `CI OK` passed on the tagged commit (a push run on `main`), runs the quality checks, contract tests and build, then runs `npm publish --provenance`. Follow it with:

```bash
gh run list --workflow release.yml --limit 1
gh run watch <run-id>
```

To publish an existing tag again (e.g. the workflow failed before publishing), run it by hand:

```bash
gh workflow run release.yml -f tag=v0.X.Y
```

### 4. Verify

```bash
npm view browser-debugger-cli dist-tags        # latest: '0.X.Y'
npm view browser-debugger-cli@0.X.Y dist.attestations   # provenance present
gh release view v0.X.Y
```

Then update the [wiki](https://github.com/szymdzum/browser-debugger-cli/wiki) if commands changed.

## Prereleases

Versions with a suffix (`0.9.0-beta.0`) are published to the `next` dist-tag, so `npm install browser-debugger-cli` keeps installing the latest stable version. Create their GitHub release with `--prerelease`. Users install them with `npm install -g browser-debugger-cli@next`.

The old `alpha` dist-tag is no longer updated by the workflow (Trusted Publishing covers `npm publish` only). Moving or removing it needs the owner's login with 2FA:

```bash
npm dist-tag add browser-debugger-cli@0.X.Y alpha   # or: npm dist-tag rm browser-debugger-cli alpha
```

## Troubleshooting

### Workflow fails with "Tag vX does not match package.json version"

The tag points at a commit whose `package.json` has another version (usually: tagged before the release PR was merged). Delete and recreate the tag on the release commit, then run the workflow by hand:

```bash
git push origin :refs/tags/v0.X.Y && git tag -d v0.X.Y
git tag v0.X.Y <release-commit> && git push origin v0.X.Y
gh workflow run release.yml -f tag=v0.X.Y
```

### npm publish fails with 403 or ENEEDAUTH in the workflow

Trusted Publishing is not set up or does not match: check the Trusted Publisher settings on npmjs.com (owner `szymdzum`, repository `browser-debugger-cli`, workflow `release.yml`), and that the workflow has `id-token: write` and runs npm 11.5.1+.

### Publishing by hand (fallback)

Only if the workflow cannot be used. The account has 2FA for writes, so npm asks for a one-time password:

```bash
npm whoami                 # the package owner
npm publish                # enter the current 6-digit code when asked
```

Use a fresh code from the authenticator entry for npm. Several wrong codes in a row get the account rate limited (`E429 rate limited otp`) for a while; wait before trying again.

### Release notes need a fix

```bash
gh release edit v0.X.Y --notes-file release-notes.md
```

Editing a published release does not start the workflow again.

## Best Practices

- Release from `main` only, after the release PR's CI is green
- Keep the CHANGELOG user-focused; put breaking changes under `Breaking` and say what to do
- Between releases, PRs never edit `CHANGELOG.md`, so they don't conflict with each other; the release PR writes it from their descriptions
- Never reuse a version number; npm does not allow republishing a version
- Thank contributors in the release notes, including those whose ideas shipped through other PRs
- Don't publish breaking changes as a patch version

## Release Templates

The assemble script writes the version section; it looks like this:

```markdown
## [0.X.0] - YYYY-MM-DD

### Breaking

- **What changed** (#N): what to do instead

### Added

- **New feature** (#N): description

### Changed

- **Modified behavior** (#N): description

### Fixed

- **Bug fix** (#N): description

### Internal

- **Tests, CI, refactors** (#N): description
```

## Related Documentation

- [CHANGELOG.md](../CHANGELOG.md) - Version history
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) - OIDC publishing from GitHub Actions
- [Semantic Versioning](https://semver.org/) - Version numbering guide
- [Keep a Changelog](https://keepachangelog.com/) - Changelog format guide
