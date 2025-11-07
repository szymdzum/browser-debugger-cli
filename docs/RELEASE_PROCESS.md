# Release Process

Complete guide for creating and publishing releases for `browser-debugger-cli`.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Release Types](#release-types)
- [Release Checklist](#release-checklist)
- [Step-by-Step Process](#step-by-step-process)
- [Publishing to npm](#publishing-to-npm)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before creating a release, ensure you have:

1. **GitHub CLI installed and authenticated**
   ```bash
   gh auth status
   ```

2. **npm credentials configured**
   ```bash
   npm whoami
   ```

3. **All changes merged to main branch**
   ```bash
   git checkout main
   git pull origin main
   ```

4. **All tests passing**
   ```bash
   npm run check:enhanced
   ./tests/run-all-tests.sh
   ```

## Release Types

Follow [Semantic Versioning](https://semver.org/):

- **Patch (0.0.X)** - Bug fixes, documentation updates, refactoring
- **Minor (0.X.0)** - New features, non-breaking changes
- **Major (X.0.0)** - Breaking changes, major rewrites

**Current Status**: Alpha releases (0.x.x) - API may change

## Release Checklist

### Pre-Release

- [ ] All tests passing locally
- [ ] Code quality checks passing (`npm run check:enhanced`)
- [ ] CHANGELOG.md updated with new version section
- [ ] package.json version bumped
- [ ] No uncommitted changes
- [ ] Main branch is up-to-date with remote

### Release

- [ ] Version commit created
- [ ] Git tag created and pushed
- [ ] GitHub Release created with notes
- [ ] CI checks passing on release
- [ ] npm package published (if desired)

### Post-Release

- [ ] Release verified on GitHub
- [ ] npm package verified (if published)
- [ ] Documentation updated (if needed)
- [ ] Announcement made (if significant)

## Step-by-Step Process

### 1. Prepare the Release

Ensure you're on the main branch with latest changes:

```bash
git checkout main
git pull origin main
```

### 2. Update CHANGELOG.md

Move all items from the `## [Unreleased]` section into a new version section:

```markdown
## [Unreleased]

<!-- Empty for now - add here as you work -->

## [0.X.Y] - YYYY-MM-DD

### Added
- New feature descriptions

### Changed
- Modified behavior descriptions

### Fixed
- Bug fix descriptions

### Removed
- Removed feature descriptions

### Performance
- Performance improvement descriptions
```

**Guidelines**:
- Move ALL unreleased changes into the new version section
- Leave `## [Unreleased]` empty with a comment
- Use present tense ("Add feature" not "Added feature")
- Be specific and user-focused
- Include relevant PR/issue numbers
- Group changes by category (Added, Changed, Fixed, etc.)
- Update the date to current date (YYYY-MM-DD format)

### 3. Bump Version in package.json

Update the version number:

```bash
# Edit package.json manually or use npm version
npm version patch  # For 0.0.X
npm version minor  # For 0.X.0
npm version major  # For X.0.0
```

**Manual edit**:
```json
{
  "version": "0.X.Y"
}
```

### 4. Build with New Version

Compile the TypeScript to verify everything works:

```bash
npm run build
```

### 5. Commit Version Bump

Create a commit for the version change:

```bash
git add CHANGELOG.md package.json
git commit -m "chore: release vX.Y.Z"
```

**Note**: This follows [Conventional Commits](https://www.conventionalcommits.org/) format.

### 6. Create and Push Git Tag

Tag the release commit:

```bash
# Create tag
git tag v0.X.Y

# Push commit and tag
git push origin main --tags
```

**Important**: The tag must be pushed for the GitHub Release to work properly.

### 7. Create GitHub Release

Use GitHub CLI to create the release:

```bash
gh release create v0.X.Y \
  --title "v0.X.Y" \
  --notes "$(cat <<'EOF'
## Overview

Brief overview of the release.

## 🎯 Highlights

- Key feature 1
- Key feature 2
- Important fix

## 🔧 Changes

### Added
- New feature descriptions

### Changed
- Modified behavior descriptions

### Fixed
- Bug fix descriptions

## Installation

```bash
npm install -g browser-debugger-cli@alpha
```

**Full Changelog**: https://github.com/szymdzum/browser-debugger-cli/compare/v0.X.Y-1...v0.X.Y
EOF
)"
```

**Release Notes Tips**:
- **Title format**: Use only version tag (e.g., `v0.X.Y`), not descriptive text
- Start release notes with an overview
- Use emojis sparingly for visual hierarchy
- Include installation instructions
- Link to full changelog
- Highlight breaking changes prominently

### 8. Verify Release

Check that the release appears correctly:

```bash
# View release details
gh release view v0.X.Y

# Or visit GitHub
open https://github.com/szymdzum/browser-debugger-cli/releases/tag/v0.X.Y
```

**What to verify**:
- ✅ Release shows up in sidebar with "Latest" badge
- ✅ Release notes are formatted correctly
- ✅ Tag is linked to correct commit
- ✅ Date/time are correct

### 9. Verify Local Repository

Ensure your local repo is clean:

```bash
git status
git log --oneline -5
```

Expected output:
```
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean

d0f3893 (HEAD -> main, tag: v0.X.Y, origin/main, origin/HEAD) chore: release v0.X.Y
```

## Publishing to npm

**Note**: Currently configured to publish to npm with `alpha` tag.

### Manual Publish

```bash
# Build the package
npm run build

# Publish to npm (alpha tag)
npm publish --tag alpha

# Or publish as latest (for stable releases)
npm publish
```

### Verify npm Publication

```bash
# Check package info
npm info browser-debugger-cli@alpha

# View all versions
npm view browser-debugger-cli versions
```

### Installation

Users can install the alpha version:

```bash
npm install -g browser-debugger-cli@alpha
```

Or specific version:

```bash
npm install -g browser-debugger-cli@0.X.Y
```

## Release Workflow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Update CHANGELOG.md                                      │
│    Add new version section with changes                     │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Bump Version in package.json                             │
│    Update "version": "0.X.Y"                                │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Build Project                                            │
│    npm run build                                            │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Commit Changes                                           │
│    git commit -m "chore: release v0.X.Y"                    │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Create and Push Tag                                      │
│    git tag v0.X.Y                                           │
│    git push origin main --tags                              │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Create GitHub Release                                    │
│    gh release create v0.X.Y --title "..." --notes "..."     │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. (Optional) Publish to npm                                │
│    npm publish --tag alpha                                  │
└─────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Release Not Showing in GitHub Sidebar

**Problem**: Tag exists but release doesn't show up.

**Solution**:
```bash
# Ensure tag is pushed
git push origin --tags

# Create release from existing tag
gh release create v0.X.Y --title "..." --notes "..."
```

### Tag Already Exists

**Problem**: `fatal: tag 'v0.X.Y' already exists`

**Solution**:
```bash
# Delete local tag
git tag -d v0.X.Y

# Delete remote tag
git push origin :refs/tags/v0.X.Y

# Recreate tag
git tag v0.X.Y
git push origin --tags
```

### Version Mismatch

**Problem**: package.json version doesn't match tag.

**Solution**:
```bash
# Fix version in package.json
# Delete incorrect tag (see above)
# Amend commit
git add package.json
git commit --amend --no-edit
# Recreate tag
git tag v0.X.Y
git push origin main --tags --force-with-lease
```

### npm Publish Fails

**Problem**: `npm ERR! code E401` (authentication error)

**Solution**:
```bash
# Re-authenticate
npm login

# Verify credentials
npm whoami

# Try publishing again
npm publish --tag alpha
```

### npm README Not Updating

**Problem**: npm package page shows stale README from old version.

**Cause**: `publishConfig.tag` in package.json causes new versions to update only the specified tag (e.g., `alpha`), not `latest`. The npm website displays the README from the `latest` tag by default.

**Solution**:
```bash
# Option 1: Update the latest dist-tag manually
npm dist-tag add browser-debugger-cli@0.X.Y latest

# Option 2: Remove publishConfig.tag and republish
# Edit package.json - remove this section:
# "publishConfig": {
#   "tag": "alpha"
# }
# Then publish normally:
npm publish

# Verify both tags point to current version
npm view browser-debugger-cli dist-tags
# Should show: { latest: '0.X.Y', alpha: '0.X.Y' }
```

**Prevention**: For stable releases, remove `publishConfig.tag` from package.json before publishing to ensure the `latest` tag updates automatically.

### Release Notes Not Formatted

**Problem**: Release notes show as plain text, not Markdown.

**Solution**: Ensure you're using `--notes` with a heredoc:
```bash
gh release create v0.X.Y \
  --title "..." \
  --notes "$(cat <<'EOF'
# Markdown content here
EOF
)"
```

### CI Checks Failing After Release

**Problem**: GitHub Actions fail on release tag.

**Solution**:
```bash
# Check CI logs
gh run list --limit 5

# View specific run
gh run view <run-id>

# If needed, fix issues and re-tag
git tag -d v0.X.Y
git push origin :refs/tags/v0.X.Y
# Make fixes, commit, then retag
```

## Best Practices

### Do's ✅

- **Always update CHANGELOG.md** before releasing
- **Run all tests** before creating a release
- **Use semantic versioning** consistently
- **Write clear release notes** focused on user impact
- **Include installation instructions** in release notes
- **Link to full changelog** on GitHub
- **Tag releases immediately** after version commit
- **Verify release appears** on GitHub before announcing

### Don'ts ❌

- **Don't skip version bump** in package.json
- **Don't create releases from feature branches** (use main)
- **Don't include unrelated changes** in version commits
- **Don't delete releases** unless absolutely necessary
- **Don't reuse version numbers** (creates confusion)
- **Don't forget to push tags** (`--tags` flag)
- **Don't publish breaking changes** as patch versions

## Release Templates

### Patch Release Template

```markdown
## [0.X.Y] - YYYY-MM-DD

### Fixed
- Bug fix description
- Another bug fix

### Performance
- Performance improvement description
```

### Minor Release Template

```markdown
## [0.X.0] - YYYY-MM-DD

### Added
- New feature description
- Another new feature

### Changed
- Modified behavior description

### Fixed
- Bug fix description
```

### Major Release Template

```markdown
## [X.0.0] - YYYY-MM-DD

### Breaking Changes ⚠️
- **IMPORTANT**: Breaking change description
- Migration instructions

### Added
- New feature description

### Changed
- Modified behavior description

### Removed
- Removed feature description
```

## Quick Reference

```bash
# Complete release workflow (one-liner)
npm run check:enhanced && \
npm run build && \
git add CHANGELOG.md package.json && \
git commit -m "chore: release v0.X.Y" && \
git tag v0.X.Y && \
git push origin main --tags && \
gh release create v0.X.Y --title "v0.X.Y" --notes "Release notes here"

# View recent releases
gh release list

# View specific release
gh release view v0.X.Y

# Edit release notes
gh release edit v0.X.Y --notes "Updated notes"

# Delete release (use with caution)
gh release delete v0.X.Y
git tag -d v0.X.Y
git push origin :refs/tags/v0.X.Y
```

## Related Documentation

- [CHANGELOG.md](../CHANGELOG.md) - Version history
- [Semantic Versioning](https://semver.org/) - Version numbering guide
- [Keep a Changelog](https://keepachangelog.com/) - Changelog format guide
- [Conventional Commits](https://www.conventionalcommits.org/) - Commit message format

## Questions?

If you encounter issues not covered in this guide:
1. Check [GitHub Issues](https://github.com/szymdzum/browser-debugger-cli/issues)
2. Review [GitHub CLI docs](https://cli.github.com/manual/gh_release)
3. Review [npm publish docs](https://docs.npmjs.com/cli/v10/commands/npm-publish)
