# Browser Debugger CLI (bdg) - Release Guide

## Current Status
- **Version:** 0.0.1-alpha.0
- **Latest Commit:** 03a7708 (feat: implement collector selector flags #7)
- **Branch:** main (up to date with origin)
- **Existing Releases:** None (first release)
- **GitHub Actions:** Release workflow configured

## Release Methods

### Method 1: Automated Release via GitHub Actions (Recommended)

The repository has a pre-configured release workflow that handles everything automatically.

#### Prerequisites
1. **NPM Token** (One-time setup)
   - Go to https://www.npmjs.com/settings/YOUR_USERNAME/tokens
   - Create a new "Automation" token (granular or classic)
   - Copy the token
   - Go to GitHub repo → Settings → Secrets and variables → Actions
   - Create new secret named `NPM_TOKEN` with the token value

2. **Permissions**
   - Must have write access to the repository
   - Workflow must have permission to create releases (usually enabled by default)

#### Steps to Release

1. **Navigate to GitHub Actions**
   ```
   https://github.com/szymdzum/browser-debugger-cli/actions/workflows/release.yml
   ```

2. **Trigger the Release Workflow**
   - Click "Run workflow"
   - Select branch: `main`
   - Choose version type:
     - `prerelease` → 0.0.1-alpha.0 → 0.0.1-alpha.1 (for testing)
     - `prepatch` → 0.0.1-alpha.0 → 0.0.2-alpha.0 (bug fixes)
     - `preminor` → 0.0.1-alpha.0 → 0.1.0-alpha.0 (new features)
     - `premajor` → 0.0.1-alpha.0 → 1.0.0-alpha.0 (breaking changes)
     - `patch` → 0.0.1-alpha.0 → 0.0.1 (first stable patch)
     - `minor` → 0.0.1-alpha.0 → 0.1.0 (first stable minor)
     - `major` → 0.0.1-alpha.0 → 1.0.0 (first stable major)
   - Set prerelease ID: `alpha` (or `beta`, `rc`)
   - Click "Run workflow"

3. **What Happens Automatically**
   - Runs quality checks (`npm run check:enhanced`)
   - Runs all tests (`npm test`)
   - Builds the package (`npm run build`)
   - Bumps version in package.json
   - Creates git commit for version bump
   - Creates and pushes git tag (e.g., `v0.0.1-alpha.1`)
   - Publishes to npm with appropriate tag (alpha/beta/latest)
   - Creates GitHub Release with installation instructions

4. **Verify the Release**
   ```bash
   # Check npm
   npm view browser-debugger-cli@alpha

   # Install and test
   npm install -g browser-debugger-cli@alpha
   bdg --version

   # Check GitHub
   # Visit: https://github.com/szymdzum/browser-debugger-cli/releases
   ```

### Method 2: Manual Release (Fallback)

If GitHub Actions aren't working or you prefer manual control:

#### Prerequisites
```bash
# 1. Ensure you're on main and up to date
git checkout main
git pull origin main

# 2. Ensure you're logged into npm
npm login

# 3. Verify authentication
npm whoami
```

#### Steps

1. **Run Quality Checks**
   ```bash
   npm run check:enhanced
   npm test
   npm run build
   ```

2. **Bump Version**
   ```bash
   # For alpha release
   npm version prerelease --preid=alpha
   # This creates: 0.0.1-alpha.1

   # For beta release
   npm version prerelease --preid=beta
   # This creates: 0.0.1-beta.0

   # For stable release
   npm version patch
   # This creates: 0.0.1
   ```

3. **Push Changes and Tag**
   ```bash
   git push origin main
   git push origin --tags
   ```

4. **Publish to npm**
   ```bash
   # For alpha/beta (use distribution tag)
   npm publish --tag alpha

   # For stable release (latest tag)
   npm publish
   ```

5. **Create GitHub Release**
   ```bash
   # Get the version
   VERSION=$(node -p "require('./package.json').version")

   # Create release via gh CLI
   gh release create "v$VERSION" \
     --title "v$VERSION" \
     --notes "Release v$VERSION

   ## Installation
   \`\`\`bash
   npm install -g browser-debugger-cli@$VERSION
   \`\`\`

   ## Changes
   See the [commit history](https://github.com/szymdzum/browser-debugger-cli/commits/v$VERSION) for details." \
     --prerelease
   ```

## Recommended First Release

Since this is the **first release** with significant new features, I recommend:

### Option A: Alpha Release for Testing
```
Version Type: prerelease
Prerelease ID: alpha
Result: v0.0.1-alpha.1
```

**Rationale:**
- Test the release process
- Allow early adopters to try new features
- Gather feedback before stable release
- Published with `@alpha` tag (won't affect `latest`)

**Installation:**
```bash
npm install -g browser-debugger-cli@alpha
```

### Option B: First Stable Minor Release
```
Version Type: minor
Result: v0.1.0
```

**Rationale:**
- All major features implemented and tested
- Collector selector flags working perfectly
- Code refactoring complete (~100 lines removed)
- Comprehensive test coverage
- Ready for production use

**Installation:**
```bash
npm install -g browser-debugger-cli
```

## Release Checklist

Before releasing, verify:

- [ ] All tests passing (`npm test`)
- [ ] Quality checks passing (`npm run check:enhanced`)
- [ ] Build successful (`npm run build`)
- [ ] README.md up to date
- [ ] CHANGELOG.md updated (if exists, or create one)
- [ ] All PRs merged to main
- [ ] No uncommitted changes
- [ ] Documentation reflects current features

## Post-Release

After successful release:

1. **Verify Installation**
   ```bash
   npx browser-debugger-cli@latest --version
   ```

2. **Test Installation**
   ```bash
   npm install -g browser-debugger-cli@latest
   bdg --help
   ```

3. **Update Documentation**
   - Update README.md with new version if needed
   - Update any version references

4. **Announce**
   - Create announcement in GitHub Discussions
   - Share in relevant communities
   - Update project website (if any)

## Troubleshooting

### NPM Publish Fails
```bash
# Check if you're logged in
npm whoami

# Check package name availability
npm view browser-debugger-cli

# Verify permissions
npm access ls-packages
```

### GitHub Release Fails
```bash
# Check if tag already exists
git tag -l

# Delete tag if needed
git tag -d v0.0.1-alpha.1
git push origin :refs/tags/v0.0.1-alpha.1
```

### Version Conflict
```bash
# Reset version in package.json if needed
git checkout package.json package-lock.json
```

## Version Strategy

Following semantic versioning with alpha prerelease:

- **0.0.x-alpha.x** - Early development, breaking changes possible
- **0.0.x-beta.x** - Feature complete, testing phase
- **0.0.x-rc.x** - Release candidate, final testing
- **0.1.0** - First stable release
- **0.1.x** - Patch releases (bug fixes)
- **0.x.0** - Minor releases (new features, backward compatible)
- **x.0.0** - Major releases (breaking changes)
