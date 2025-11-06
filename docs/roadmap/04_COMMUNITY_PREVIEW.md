# 04: Community Preview

**Target Version**: v0.7.0  
**Timeline**: End of Month 3  
**Status**: 🔜 Planned

## Philosophy

Make the project discoverable, usable, and contributor-friendly. Focus on documentation, packaging, and community infrastructure.

## Overview

Prepare for public launch:
- **Documentation site** with searchable guides
- **Contributor infrastructure** (guide, architecture docs, issue templates)
- **Packaging and distribution** (npm, Homebrew, binaries)
- **Community outreach** (blog post, social media, Reddit)

## Goals

1. Make it easy for users to **discover and try** bdg
2. Make it easy for contributors to **understand and extend** bdg
3. Establish **feedback loops** for bug reports and feature requests
4. Build **community awareness** through content and outreach

## Deliverables

### 1. Documentation Site

**Platform**: Docusaurus or mkdocs

**Content Structure**:
```
docs/
├── index.md                  # Landing page
├── getting-started/
│   ├── installation.md       # Install via npm, Homebrew, binary
│   ├── quickstart.md         # First session in 5 minutes
│   └── concepts.md           # Core concepts (daemon, CDP, IPC)
├── guides/
│   ├── agents/
│   │   ├── overview.md       # Agent workflows introduction
│   │   ├── cdp-patterns.md   # Raw CDP patterns
│   │   ├── element-queries.md
│   │   ├── navigation.md
│   │   └── error-handling.md
│   └── humans/
│       ├── overview.md       # Human debugging workflows
│       ├── dom-inspection.md
│       ├── network-debugging.md
│       └── accessibility.md
├── reference/
│   ├── cli.md                # Complete CLI reference
│   ├── schema.md             # Output schema documentation
│   ├── exit-codes.md         # Semantic exit codes
│   └── cdp-methods.md        # CDP method coverage
├── examples/
│   ├── agents.md             # Agent example scripts
│   └── humans.md             # Human example scripts
└── contributing/
    ├── overview.md           # How to contribute
    ├── architecture.md       # System architecture
    └── development.md        # Development setup
```

**Features**:
- **Search**: Full-text search across all docs
- **Code blocks**: Syntax highlighting with copy button
- **Navigation**: Sidebar with breadcrumbs
- **Versioning**: Support multiple versions (v0.4, v0.5, v0.6, v0.7)
- **Dark mode**: Toggle between light/dark themes

**Deployment**:
- Host on GitHub Pages or Netlify
- Auto-deploy from `main` branch
- Custom domain: `docs.bdg.dev` (or similar)

**Acceptance**:
- [ ] Site deployed and accessible
- [ ] All guides migrated from markdown files
- [ ] Search works across all content
- [ ] Examples are runnable and tested
- [ ] Versioning configured for future releases

---

### 2. Contributor Guide

**File**: `CONTRIBUTING.md`

**Content**:
- **Getting started**: Clone, install, build, test
- **Development workflow**: Branch naming, commit messages, PR process
- **Adding commands**: Step-by-step guide with template
- **Testing**: How to write unit, integration, and contract tests
- **Documentation**: When and how to update docs
- **Code style**: TSDoc, KISS/DRY/YAGNI principles
- **Review process**: What to expect during code review

**Example section**:
```markdown
## Adding a New Command

1. **Choose command namespace**: `dom`, `net`, `console`, `page`, `target`, `perf`
2. **Create command file**: `src/commands/<namespace>.ts`
3. **Implement handler**: Use CommandRunner pattern
4. **Add IPC messages**: Update `src/ipc/types.ts` if needed
5. **Write tests**: Integration tests in `tests/integration/`
6. **Document**: Add to CLI reference and relevant guide
7. **Add examples**: Show usage in example scripts

See `src/commands/dom.ts` for reference implementation.
```

**Acceptance**:
- [ ] CONTRIBUTING.md published
- [ ] Step-by-step guides for common tasks
- [ ] Links to architecture docs
- [ ] Examples of good contributions

---

### 3. Architecture Documentation

**File**: `docs/ARCHITECTURE.md`

**Content**:
- **System overview**: Daemon + IPC + Worker + CDP
- **Component diagram**: Visual representation
- **Data flow**: Command → IPC → Worker → CDP → Response
- **Key modules**: Purpose and responsibilities
- **Design decisions**: Why daemon architecture, why IPC, why CDP
- **Extension points**: Where to add new features

**Diagrams**:
```
┌─────────────┐
│ CLI Command │
└──────┬──────┘
       │ Unix Socket
       ▼
┌─────────────┐      ┌────────────┐
│ IPC Daemon  │◄────►│   Worker   │
└─────────────┘      └─────┬──────┘
                           │ WebSocket
                           ▼
                     ┌────────────┐
                     │    CDP     │
                     └────────────┘
```

**Acceptance**:
- [ ] Architecture clearly explained
- [ ] Diagrams illustrate key concepts
- [ ] Design decisions documented
- [ ] Extension points identified

---

### 4. Issue Templates

**Templates**:

#### Bug Report
```yaml
name: Bug Report
description: Report a bug or unexpected behavior
labels: [bug]
body:
  - type: input
    id: version
    label: bdg version
    description: Output of `bdg --version`
    required: true
  - type: textarea
    id: command
    label: Command executed
    description: Full command with arguments
    required: true
  - type: textarea
    id: expected
    label: Expected behavior
    required: true
  - type: textarea
    id: actual
    label: Actual behavior
    required: true
  - type: textarea
    id: logs
    label: Error logs
    description: Output from command (use `--log-level debug` if possible)
```

#### Feature Request
```yaml
name: Feature Request
description: Suggest a new feature or enhancement
labels: [enhancement]
body:
  - type: textarea
    id: problem
    label: Problem description
    description: What problem does this solve?
    required: true
  - type: textarea
    id: solution
    label: Proposed solution
    description: How should it work?
    required: true
  - type: dropdown
    id: audience
    label: Primary audience
    options:
      - AI agents
      - Human developers
      - Both
```

#### CDP Method Request
```yaml
name: CDP Method Request
description: Request wrapping a specific CDP method
labels: [cdp, enhancement]
body:
  - type: input
    id: method
    label: CDP method
    description: e.g., Page.navigate, DOM.getDocument
    required: true
  - type: textarea
    id: usecase
    label: Use case
    description: Why do you need this?
    required: true
```

**Acceptance**:
- [ ] Issue templates configured
- [ ] Templates cover common cases
- [ ] Auto-labeling works

---

### 5. Distribution & Packaging

#### npm Package
**Already done**, but verify:
- [ ] Package published to npm registry
- [ ] `bdg` command installed globally
- [ ] README has install instructions
- [ ] Package.json has correct metadata

#### Homebrew Formula
**File**: `Formula/bdg.rb` (in separate tap repo)

```ruby
class Bdg < Formula
  desc "Browser debugger CLI - Chrome DevTools Protocol from terminal"
  homepage "https://github.com/szymdzum/browser-debugger-cli"
  url "https://github.com/szymdzum/browser-debugger-cli/archive/v0.7.0.tar.gz"
  sha256 "..."
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    system "#{bin}/bdg", "--version"
  end
end
```

**Installation**:
```bash
brew tap szymdzum/tap
brew install bdg
```

**Acceptance**:
- [ ] Homebrew formula created
- [ ] Formula tested on macOS
- [ ] Installation instructions in docs

#### Prebuilt Binaries (Optional)
Use `pkg` or `nexe` to create standalone binaries:
```bash
npm install -g pkg
pkg . --targets node18-macos-x64,node18-linux-x64,node18-win-x64 --output dist/bdg
```

**Distribution**:
- Attach binaries to GitHub releases
- Provide checksums for verification

**Acceptance** (optional for M4):
- [ ] Binaries built for macOS, Linux, Windows
- [ ] Binaries attached to GitHub release
- [ ] Installation instructions for binaries

---

### 6. Blog Post & Announcement

**Blog Post**: "Introducing bdg: Chrome DevTools Protocol from the Terminal"

**Content**:
- **Problem**: Debugging web apps from terminal is hard
- **Solution**: bdg exposes CDP as CLI commands
- **Two audiences**: AI agents (raw CDP) + humans (visual wrappers)
- **Examples**: Show 2-3 compelling workflows
- **Getting started**: Quick install and first command
- **Call to action**: Try it, give feedback, contribute

**Length**: 1000-1500 words with code examples and screenshots

**Distribution**:
- Personal blog or dev.to
- Hacker News (Show HN)
- Reddit (/r/programming, /r/webdev, /r/javascript)
- Twitter/X
- LinkedIn

**Acceptance**:
- [ ] Blog post written and published
- [ ] Posted to Hacker News
- [ ] Posted to Reddit
- [ ] Shared on social media
- [ ] Feedback collected

---

### 7. Community Infrastructure

#### GitHub Discussions
Enable Discussions for:
- **Q&A**: User questions
- **Feature requests**: Ideas and proposals
- **Show and tell**: User workflows and scripts
- **Development**: Contributor discussions

**Categories**:
- General
- Q&A
- Feature Requests
- Show and Tell
- Development

**Acceptance**:
- [ ] Discussions enabled
- [ ] Categories configured
- [ ] Pinned welcome post

#### Discord Server (Optional)
Consider creating Discord for:
- Real-time Q&A
- Contributor coordination
- Release announcements

**Channels**:
- #general
- #help
- #development
- #announcements

**Acceptance** (optional):
- [ ] Discord server created
- [ ] Invite link in README
- [ ] Channels configured

#### Feedback Collection
Set up methods to collect feedback:
- GitHub issues (bugs, features)
- GitHub discussions (questions, ideas)
- Anonymous feedback form (Google Forms)
- Usage analytics (opt-in, privacy-focused)

**Acceptance**:
- [ ] Multiple feedback channels available
- [ ] Feedback process documented
- [ ] Response time target set (<48h)

---

## Success Criteria

### Documentation (Week 13)
- [ ] Documentation site deployed
- [ ] All guides migrated and searchable
- [ ] Examples tested and runnable
- [ ] Versioning configured

### Contributors (Week 13-14)
- [ ] CONTRIBUTING.md published
- [ ] ARCHITECTURE.md complete with diagrams
- [ ] Issue templates configured
- [ ] CODE_OF_CONDUCT.md added

### Distribution (Week 14)
- [ ] npm package verified
- [ ] Homebrew formula published
- [ ] Installation docs updated
- [ ] Optional: Binaries for all platforms

### Community (Week 14-15)
- [ ] Blog post published
- [ ] Posted to HN, Reddit, social media
- [ ] GitHub Discussions enabled
- [ ] Feedback mechanisms in place

### Engagement Targets (by end of Month 3)
- [ ] 5+ external GitHub issues opened
- [ ] 1+ external PR merged
- [ ] 3+ blog posts or mentions
- [ ] 50+ GitHub stars
- [ ] 10+ active discussions

---

## Implementation Order

### Week 13: Documentation Site
1. Choose platform (Docusaurus vs mkdocs)
2. Set up project structure
3. Migrate existing docs to site
4. Add search functionality
5. Configure versioning
6. Deploy to hosting
7. Test on mobile and desktop

### Week 13-14: Contributor Infrastructure
1. Write CONTRIBUTING.md
2. Create ARCHITECTURE.md with diagrams
3. Set up issue templates
4. Add CODE_OF_CONDUCT.md
5. Create PR template
6. Document development workflow
7. Add "good first issue" labels

### Week 14: Distribution
1. Verify npm package setup
2. Create Homebrew formula
3. Test Homebrew installation
4. Update installation docs
5. Optional: Build binaries with pkg
6. Optional: Attach binaries to release

### Week 14-15: Community Launch
1. Write blog post draft
2. Create screenshots and demos
3. Review and edit blog post
4. Publish blog post
5. Post to Hacker News (Show HN)
6. Post to Reddit subreddits
7. Share on social media
8. Enable GitHub Discussions
9. Monitor and respond to feedback

---

## Open Questions

### Pending
- ❓ Documentation platform: Docusaurus or mkdocs?
- ❓ Custom domain: Buy domain or use github.io?
- ❓ Discord: Worth the overhead for early community?
- ❓ Analytics: Track usage (opt-in) or fully privacy-focused?
- ❓ Binaries: Bundle Node.js or require separate install?

### Decisions Needed
- Blog post: Personal blog or guest post on dev.to?
- Homebrew: Own tap or submit to homebrew-core?
- Outreach: Which communities to target first?

---

## Dependencies

**Required**:
- M1, M2, M3 completed (full feature set)
- All documentation up to date
- Examples tested in CI
- No critical bugs

**Blocked by**: M3 completion

---

## Risks & Mitigation

### Low Initial Engagement
**Risk**: Blog post and announcement don't get traction  
**Mitigation**: 
- Share in multiple communities
- Reach out to influencers for feedback
- Create compelling demos and screenshots
- Be patient, keep improving

### Contributor Onboarding Friction
**Risk**: Contributors struggle to get started  
**Mitigation**:
- Clear step-by-step guides
- Good first issues labeled and described
- Responsive to questions (<48h)
- Pair programming for first contributors

### Documentation Maintenance Burden
**Risk**: Docs fall out of sync with code  
**Mitigation**:
- Include doc updates in PR checklist
- Automate what's possible (CLI reference)
- Version docs alongside releases
- Regular doc review sprints

---

## Next Steps After M4

1. Monitor community feedback and engagement
2. Prioritize M5-M9 based on user requests
3. Iterate on documentation based on confusion points
4. Build contributor momentum with good first issues
5. Plan next major feature set (M5: Human-Layer DOM Complete)

---

## References

- [Docusaurus](https://docusaurus.io/)
- [mkdocs](https://www.mkdocs.org/)
- [GitHub Issue Forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- [Show HN Guidelines](https://news.ycombinator.com/showhn.html)
