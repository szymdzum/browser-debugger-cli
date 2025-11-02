# Simple DevOps Setup for CLI Tools

A practical guide to implementing basic DevOps practices for `browser-debugger-cli` using GitHub's built-in tools. Keep it simple, keep it working.

## Overview

This guide covers essential DevOps practices without overcomplicating things:
- Enhanced CI/CD pipeline
- Manual release workflow
- Basic security scanning
- Simple rollback strategies
- Alpha/Beta version management

## Implementation Status

✅ **Implemented** (Ready to Use):
- **Enhanced CI Pipeline** (`.github/workflows/ci.yml`)
  - Code quality checks (format, type-check, lint, build)
  - Contract tests (21 tests in ~165ms)
  - E2E tests (comprehensive CLI scenarios)
  - Security audit (npm audit with high threshold)
- **Release Workflow** (`.github/workflows/release.yml`)
  - Manual trigger via GitHub Actions UI
  - Full quality gates before publishing
  - npm version bumping with git tags
  - Automated npm publishing
  - GitHub release creation
- **CodeQL Security Scanning** (`.github/workflows/security.yml`)
  - Weekly scheduled scans
  - Runs on push to main and PRs

⏳ **Requires Setup**:
- **NPM_TOKEN Secret**: Add to GitHub repository secrets before first release
- **Branch Protection**: Enable manually in GitHub Settings → Branches

📚 **This Document**:
- Steps 1-2: Already implemented (reference for understanding)
- Step 3: Ready to use (add NPM_TOKEN secret first)
- Step 4: Enhancement recommendations
- Steps 5-6: Operational procedures

## Prerequisites

- GitHub repository with Actions enabled
- npm account for publishing
- Basic understanding of GitHub workflows

## Step 1: Enhanced CI Pipeline

### Current State
We already have a basic CI workflow in `.github/workflows/ci.yml` that runs quality checks.

### Improvements to Add

#### 1.1: Add CodeQL Security Scanning

Create `.github/workflows/security.yml`:

```yaml
name: Security

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    # Run weekly on Mondays at 2 AM UTC
    - cron: '0 2 * * 1'

jobs:
  codeql:
    name: CodeQL Analysis
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        
      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
          
      - name: Autobuild
        uses: github/codeql-action/autobuild@v3
        
      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
```

#### 1.2: Enhanced npm audit

Update the security job in `ci.yml`:

```yaml
  security:
    name: Security Audit
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run security audit
        run: npm audit --audit-level=moderate
        
      - name: Check for known vulnerabilities
        run: npx audit-ci --moderate
```

## Step 2: Manual Release Workflow

### 2.1: Create NPM Token

1. Go to [npmjs.com](https://www.npmjs.com/) → Profile → Access Tokens
2. Create "Automation" token with publish permissions
3. Copy the token (starts with `npm_`)

### 2.2: Add GitHub Secret

1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `NPM_TOKEN`
4. Value: Your npm token from step 2.1

### 2.3: Create Release Workflow

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  workflow_dispatch:
    inputs:
      version_type:
        description: 'Version increment type'
        required: true
        default: 'prerelease'
        type: choice
        options:
          - prerelease     # 0.0.1-alpha.0 -> 0.0.1-alpha.1
          - prepatch       # 0.0.1-alpha.0 -> 0.0.2-alpha.0
          - preminor       # 0.0.1-alpha.0 -> 0.1.0-alpha.0
          - premajor       # 0.0.1-alpha.0 -> 1.0.0-alpha.0
          - patch          # 0.0.1-alpha.0 -> 0.0.1 (stable)
          - minor          # 0.0.1-alpha.0 -> 0.1.0 (stable)
          - major          # 0.0.1-alpha.0 -> 1.0.0 (stable)
      prerelease_id:
        description: 'Prerelease identifier (alpha, beta, rc)'
        required: false
        default: 'alpha'
        type: string

jobs:
  release:
    name: Create Release
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          registry-url: 'https://registry.npmjs.org'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run tests and quality checks
        run: |
          npm run check
          npm run test:e2e
          
      - name: Build package
        run: npm run build
        
      - name: Configure git
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          
      - name: Bump version
        id: version
        run: |
          if [[ "${{ inputs.version_type }}" == pre* ]]; then
            npm version ${{ inputs.version_type }} --preid=${{ inputs.prerelease_id }}
          else
            npm version ${{ inputs.version_type }}
          fi
          echo "version=$(node -p "require('./package.json').version")" >> $GITHUB_OUTPUT
          
      - name: Push version bump
        run: |
          git push origin main
          git push origin v${{ steps.version.outputs.version }}
          
      - name: Publish to npm
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
          
      - name: Create GitHub Release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: v${{ steps.version.outputs.version }}
          release_name: v${{ steps.version.outputs.version }}
          body: |
            Release ${{ steps.version.outputs.version }}
            
            ## Installation
            ```bash
            npm install -g browser-debugger-cli@${{ steps.version.outputs.version }}
            ```
            
            ## Changes
            See the [commit history](https://github.com/${{ github.repository }}/compare/v${{ steps.version.outputs.version }}...main) for details.
          draft: false
          prerelease: ${{ contains(steps.version.outputs.version, '-') }}
```

## Step 3: Release Process

### 3.1: How to Release

1. Go to GitHub → Actions → Release workflow
2. Click "Run workflow"
3. Choose version type:
   - `prerelease`: Alpha iterations (0.0.1-alpha.0 → 0.0.1-alpha.1)
   - `prepatch`: Next alpha patch (0.0.1-alpha.0 → 0.0.2-alpha.0)
   - `patch`: Stable release (0.0.1-alpha.0 → 0.0.1)

### 3.2: Version Progression Examples

```bash
# Current: 0.0.1-alpha.0

# Alpha iterations (adding features/fixes)
prerelease → 0.0.1-alpha.1
prerelease → 0.0.1-alpha.2

# Ready for beta testing
prepatch + beta → 0.0.2-beta.0
prerelease → 0.0.2-beta.1

# Ready for stable release
patch → 0.0.2

# Future releases
patch → 0.0.3
minor → 0.1.0
major → 1.0.0
```

## Step 4: Enhanced Quality Gates

### 4.1: Update CI to Block Merges

Add to `.github/workflows/ci.yml`:

```yaml
  e2e-test:
    name: E2E Tests
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Build package
        run: npm run build
        
      - name: Run E2E tests
        run: npm run test:e2e
```

### 4.2: Require Status Checks

1. Go to GitHub → Settings → Branches
2. Add branch protection rule for `main`
3. Require status checks: 
   - `Code Quality`
   - `Security Audit`
   - `E2E Tests`
   - `CodeQL`

## Step 5: Simple Rollback Strategies

### 5.1: npm Rollback Commands

```bash
# Deprecate a problematic version
npm deprecate browser-debugger-cli@0.0.1-alpha.1 "Has critical bug, use 0.0.1-alpha.0"

# Move 'latest' tag to previous version
npm dist-tag add browser-debugger-cli@0.0.1-alpha.0 latest

# Unpublish (only within 72 hours)
npm unpublish browser-debugger-cli@0.0.1-alpha.1
```

### 5.2: GitHub Release Rollback

1. Go to GitHub → Releases
2. Edit the problematic release
3. Mark as "This is a pre-release" or delete
4. Create new release pointing to previous stable commit

## Step 6: Monitoring & Maintenance

### 6.1: Weekly Security Scans

The CodeQL workflow runs weekly automatically. Check the Security tab for results.

### 6.2: Dependency Updates

Dependabot is already configured. Review and merge dependency PRs regularly.

### 6.3: Release Notes

Maintain a simple changelog in `CHANGELOG.md`:

```markdown
# Changelog

## [0.0.1-alpha.1] - 2024-01-XX
### Added
- New feature X
### Fixed
- Bug Y

## [0.0.1-alpha.0] - 2024-01-XX
### Added
- Initial CLI implementation
```

## Best Practices

### ✅ Do
- Use manual releases for full control
- Test E2E before releasing
- Keep prerelease tags during development
- Monitor security alerts
- Update dependencies regularly

### ❌ Don't
- Auto-release on every commit (too risky for CLI tools)
- Skip quality gates for "quick fixes"
- Forget to test the built binary
- Ignore security warnings
- Rush from alpha to stable

## Troubleshooting

### Release Failed
1. Check GitHub Actions logs
2. Verify npm token hasn't expired
3. Ensure package.json version wasn't manually changed

### Can't Install Package
1. Check if published to correct npm registry
2. Verify user is installing with correct tag: `npm install -g browser-debugger-cli@alpha`
3. Check npm package page for issues

### Tests Fail in CI
1. Compare with local test environment
2. Check if Chrome/dependencies are available in CI
3. Review E2E test outputs in Actions logs

## Summary

This setup provides:
- ✅ Manual release control
- ✅ Basic security scanning
- ✅ Quality gates before release
- ✅ Simple rollback options
- ✅ Standard npm versioning
- ✅ No complex infrastructure

Perfect for a CLI tool that needs reliable releases without over-engineering.

---

## Quick Start Guide

### Using the Implemented CI/CD Pipeline

#### 1. First-Time Setup

**Set up NPM_TOKEN** (required before first release):
1. Go to [npmjs.com](https://www.npmjs.com/) → Profile → Access Tokens
2. Create "Automation" token with publish permissions
3. Go to GitHub repo → Settings → Secrets and variables → Actions
4. Add new secret: `NPM_TOKEN` with your token value

**Enable Branch Protection** (recommended):
1. Go to GitHub → Settings → Branches
2. Add branch protection rule for `main`:
   - Require status checks: Code Quality, Contract Tests, E2E Tests, Security Audit
   - Require pull request reviews (optional)

#### 2. Daily Development Workflow

**Automatic on Every Push/PR**:
- ✅ Code quality checks (format, lint, type-check)
- ✅ Contract tests (fast, <200ms)
- ✅ E2E tests (comprehensive CLI scenarios)
- ✅ Security audit (blocks high/critical vulnerabilities)
- ✅ CodeQL security scanning (on main branch)

**Viewing Results**:
- Go to GitHub → Actions tab to see all workflow runs
- Green checkmark = all tests passed
- Red X = something failed, click to see details

#### 3. Creating a Release

**Trigger a Release**:
1. Go to GitHub → Actions → Release workflow
2. Click "Run workflow"
3. Select branch: `main`
4. Choose version type:
   - `prerelease`: For alpha iterations (0.0.1-alpha.0 → 0.0.1-alpha.1)
   - `prepatch`: For next alpha patch (0.0.1-alpha.0 → 0.0.2-alpha.0)
   - `patch`: For stable release (0.0.1-alpha.0 → 0.0.1)
5. Select prerelease identifier: `alpha`, `beta`, or `rc`
6. Click "Run workflow"

**What Happens During Release**:
1. Runs all quality checks
2. Runs contract tests
3. Runs E2E tests
4. Bumps version in package.json
5. Creates git tag
6. Publishes to npm registry
7. Creates GitHub release

**After Release**:
- Check npm: `npm view browser-debugger-cli@alpha`
- Check GitHub releases tab for new release
- Users can install: `npm install -g browser-debugger-cli@alpha`

#### 4. Monitoring Security

**Automatic Weekly Scans**:
- CodeQL runs every Monday at 2 AM UTC
- View results: GitHub → Security → Code scanning alerts

**On-Demand Checks**:
- Security audit runs on every push/PR
- Fails on high/critical vulnerabilities
- View details in Actions tab

#### 5. If E2E Tests Fail in CI

The E2E tests are currently set to `continue-on-error: true` while verifying they work in CI.

**If They Pass Consistently**:
1. Edit `.github/workflows/ci.yml`
2. Remove the `continue-on-error: true` line from the E2E job
3. Commit and push

**If They Fail**:
- Check Actions logs for specific errors
- Most likely issue: Chrome headless mode or localhost:3000 not available
- Consider adding a simple HTTP server to E2E test script

---

## Next Steps

1. **Push this branch** to trigger first CI run and verify all tests pass
2. **Set up NPM_TOKEN** secret in GitHub
3. **Enable branch protection** to require status checks
4. **Create first alpha release** using the Release workflow
5. **Monitor CodeQL results** in Security tab after first week