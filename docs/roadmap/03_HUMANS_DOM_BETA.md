# 03: Humans DOM Beta

**Target Version**: v0.6.0  
**Timeline**: Weeks 6-12  
**Status**: 🔜 Planned

## Philosophy

Human-friendly commands deliver **visual value** that raw JSON cannot provide: annotated screenshots, accessibility summaries, layout overlays.

## Overview

Build visual debugging capabilities for human developers:
- **Element inspection** with structured reports
- **Visual overlays** for layout debugging (grid, flex, box model)
- **Accessibility quick checks** (ARIA, contrast, roles)
- **Annotated screenshots** for bug reporting

## Deliverables

### 1. `dom.inspect` - Structured Element Summary

**Purpose**: Get comprehensive element information in one command

**Command**: `bdg dom.inspect --selector <sel> [--include-screenshot]`

**Output**: Structured JSON with everything about an element

**Options**:
- `--selector <sel>` - CSS selector (required)
- `--include-screenshot` - Capture screenshot with element highlighted
- `--screenshot-path <path>` - Screenshot output path (default: auto-generated)

**Examples**:
```bash
# Basic inspection
bdg dom.inspect --selector '.error-message'

# With screenshot
bdg dom.inspect --selector '.error-message' --include-screenshot --screenshot-path error.png
```

**Output**:
```json
{
  "success": true,
  "data": {
    "selector": ".error-message",
    "found": true,
    "html": {
      "outerHTML": "<div class='error-message'>Invalid input</div>",
      "innerHTML": "Invalid input",
      "textContent": "Invalid input"
    },
    "attributes": {
      "class": "error-message",
      "id": "error-1",
      "data-severity": "high"
    },
    "box": {
      "x": 100,
      "y": 200,
      "width": 300,
      "height": 50,
      "top": 200,
      "left": 100,
      "right": 400,
      "bottom": 250
    },
    "computed": {
      "display": "block",
      "visibility": "visible",
      "opacity": "1",
      "color": "rgb(255, 0, 0)",
      "backgroundColor": "rgb(255, 255, 255)",
      "fontSize": "16px",
      "fontFamily": "Arial, sans-serif"
    },
    "accessibility": {
      "role": "alert",
      "name": "Invalid input",
      "description": "",
      "focusable": false,
      "hidden": false
    },
    "screenshot": "/path/to/error.png"
  }
}
```

**Implementation**:
- Use `DOM.getDocument`, `DOM.querySelector` to get node
- Use `Runtime.evaluate` to get HTML, attributes, bounding box
- Use `CSS.getComputedStyleForNode` for computed styles
- Use `Accessibility.getPartialAXTree` for a11y info
- Optionally capture screenshot with `DOM.highlightNode`

**Acceptance**:
- [ ] Returns all element data in one call
- [ ] Computed styles are accurate
- [ ] Accessibility info includes role and name
- [ ] Screenshot highlighting works
- [ ] Handles missing elements gracefully

---

### 2. `dom.report` - Visual Bug Report

**Purpose**: Generate portable report with element details and annotated screenshot

**Command**: `bdg dom.report --selector <sel> --out <file> [--format <json|md>]`

**Output**: Report file with element details + screenshot

**Options**:
- `--selector <sel>` - CSS selector (required)
- `--out <file>` - Output file path (required)
- `--format <json|md>` - Output format (default: json)
- `--title <text>` - Report title (optional)
- `--notes <text>` - Additional notes (optional)

**Examples**:
```bash
# JSON report
bdg dom.report --selector '.error' --out error-report.json

# Markdown report
bdg dom.report --selector '.error' --out error-report.md --format md --title "Login Error"
```

**Output** (JSON format):
```json
{
  "version": "0.6.0",
  "timestamp": "2025-11-06T12:00:00Z",
  "url": "https://example.com/login",
  "title": "Login Error",
  "element": {
    "selector": ".error",
    "html": "<div class='error'>Invalid password</div>",
    "box": { ... },
    "computed": { ... },
    "accessibility": { ... }
  },
  "screenshot": {
    "path": "error-report-screenshot.png",
    "width": 1920,
    "height": 1080,
    "format": "png"
  },
  "notes": "User reported seeing this after 3 failed login attempts"
}
```

**Output** (Markdown format):
```markdown
# Login Error

**URL**: https://example.com/login  
**Timestamp**: 2025-11-06 12:00:00 UTC

## Element Details

**Selector**: `.error`  
**Text**: Invalid password  
**Position**: 100x200, 300x50  
**Visibility**: visible

### Attributes
- `class`: error
- `role`: alert

### Computed Styles
- `color`: rgb(255, 0, 0)
- `backgroundColor`: rgb(255, 255, 255)
- `fontSize`: 16px

## Screenshot

![Error screenshot](error-report-screenshot.png)

## Notes
User reported seeing this after 3 failed login attempts
```

**Implementation**:
- Bundle `dom.inspect` output with screenshot
- Generate markdown or JSON output
- Save screenshot alongside report
- Use consistent naming (e.g., `report.json` + `report-screenshot.png`)

**Acceptance**:
- [ ] JSON reports are parseable
- [ ] Markdown reports are human-readable
- [ ] Screenshots are embedded/referenced correctly
- [ ] Reports work on two diverse sites
- [ ] Deterministic output (stable JSON ordering)

---

### 3. `overlay.grid` - CSS Grid/Flex Visualization

**Purpose**: Visualize CSS grid and flexbox layouts with overlays

**Command**: `bdg overlay.grid --selector <sel> [--type <grid|flex>] --out <file>`

**Output**: Screenshot with grid/flex lines overlaid

**Options**:
- `--selector <sel>` - CSS selector for container (required if not `--all`)
- `--all` - Show all grids/flexboxes on page
- `--type <grid|flex>` - Layout type (default: auto-detect)
- `--out <file>` - Output screenshot path (required)
- `--colors` - Color scheme for overlays (default: auto)

**Examples**:
```bash
# Visualize specific grid
bdg overlay.grid --selector '.container' --out grid-debug.png

# Show all grids on page
bdg overlay.grid --all --type grid --out all-grids.png

# Flexbox visualization
bdg overlay.grid --selector '.nav' --type flex --out flex-debug.png
```

**Output**:
```json
{
  "success": true,
  "data": {
    "screenshot": "/path/to/grid-debug.png",
    "elements": [
      {
        "selector": ".container",
        "type": "grid",
        "gridRows": 3,
        "gridColumns": 4,
        "box": { ... }
      }
    ]
  }
}
```

**Visual overlay** (in screenshot):
- Grid: Lines showing rows/columns, gaps highlighted
- Flex: Main axis, cross axis, item bounds
- Color-coded: Container (blue), gaps (purple), items (green)

**Implementation**:
- Use `Overlay.setShowGridOverlays` or `Overlay.setShowFlexOverlays`
- Capture screenshot with overlays enabled
- Disable overlays after capture
- Support multiple elements with `--all`

**Acceptance**:
- [ ] Grid overlays show rows/columns correctly
- [ ] Flex overlays show axes and items
- [ ] Works with nested grids/flexboxes
- [ ] Multiple elements rendered in same screenshot
- [ ] Colors are distinguishable

---

### 4. `dom.a11y` - Accessibility Quick Check

**Purpose**: Quick accessibility audit for an element or page

**Command**: `bdg dom.a11y [--selector <sel>] [--check <rule>]`

**Output**: Accessibility information and common issues

**Options**:
- `--selector <sel>` - Check specific element (default: whole page)
- `--check <rule>` - Run specific check (e.g., `color-contrast`, `aria-roles`)
- `--full` - Include full accessibility tree

**Examples**:
```bash
# Quick page audit
bdg dom.a11y

# Check specific element
bdg dom.a11y --selector 'button.submit'

# Check color contrast
bdg dom.a11y --check color-contrast

# Full accessibility tree
bdg dom.a11y --full
```

**Output**:
```json
{
  "success": true,
  "data": {
    "url": "https://example.com",
    "checks": {
      "colorContrast": {
        "passed": 15,
        "failed": 3,
        "issues": [
          {
            "selector": ".subtle-text",
            "ratio": 2.1,
            "required": 4.5,
            "severity": "serious"
          }
        ]
      },
      "ariaRoles": {
        "passed": 42,
        "failed": 1,
        "issues": [
          {
            "selector": "#nav",
            "issue": "Invalid role 'navbar'",
            "suggestion": "Use role='navigation'"
          }
        ]
      },
      "missingLabels": {
        "failed": 2,
        "issues": [
          {
            "selector": "input#email",
            "issue": "No associated label",
            "suggestion": "Add <label for='email'>"
          }
        ]
      }
    },
    "summary": {
      "total": 60,
      "passed": 57,
      "failed": 3,
      "score": 95
    }
  }
}
```

**Checks**:
- **Color contrast**: WCAG AA compliance (4.5:1 for normal text)
- **ARIA roles**: Valid role usage
- **Missing labels**: Form inputs without labels
- **Alt text**: Images without alt attributes
- **Keyboard navigation**: Focusable elements in tab order
- **Headings**: Proper heading hierarchy (h1-h6)

**Implementation**:
- Use `Accessibility.getFullAXTree` for page accessibility tree
- Parse tree and run heuristic checks
- Calculate contrast ratios using computed styles
- Validate ARIA roles against spec

**Acceptance**:
- [ ] Detects common a11y issues
- [ ] Color contrast calculations are accurate
- [ ] ARIA role validation works
- [ ] Reports include actionable suggestions
- [ ] Works on complex pages

---

### 5. Example Scripts: `examples/humans/`

**Scripts**:

#### 1. `element-report.sh`
Generate visual report for debugging:
```bash
#!/bin/bash
bdg start https://example.com
bdg dom.wait --selector '.error' --timeout 5000 || {
  echo "No errors found"
  exit 0
}
bdg dom.report --selector '.error' --out error-report.md --format md --title "Error Investigation"
echo "Report saved to error-report.md"
bdg stop
```

#### 2. `layout-debug.sh`
Visualize grid layout:
```bash
#!/bin/bash
bdg start https://example.com
bdg overlay.grid --selector '.main-container' --out layout.png
bdg overlay.grid --all --type flex --out all-flex.png
echo "Layout screenshots saved"
bdg stop
```

#### 3. `a11y-quick-check.sh`
Quick accessibility scan:
```bash
#!/bin/bash
bdg start https://example.com
bdg dom.a11y | jq '.data.summary'
bdg dom.a11y --check color-contrast | jq '.data.checks.colorContrast.issues'
bdg stop
```

#### 4. `compare-elements.sh`
Compare multiple elements:
```bash
#!/bin/bash
bdg start https://example.com
bdg dom.inspect --selector 'button.primary' > primary.json
bdg dom.inspect --selector 'button.secondary' > secondary.json
diff <(jq -S .data.computed < primary.json) <(jq -S .data.computed < secondary.json)
bdg stop
```

#### 5. `element-gallery.sh`
Generate gallery of all matching elements:
```bash
#!/bin/bash
bdg start https://example.com
SELECTORS=(".card" ".button" ".input")
for sel in "${SELECTORS[@]}"; do
  filename=$(echo "$sel" | sed 's/[^a-z]/-/g')
  bdg dom.report --selector "$sel" --out "gallery-$filename.json"
done
echo "Gallery reports generated"
bdg stop
```

**Acceptance**:
- [ ] All scripts run successfully
- [ ] Scripts demonstrate human debugging workflows
- [ ] Output is visual and useful
- [ ] Scripts include README with use cases

---

## Testing Strategy

### Visual Regression Tests
Compare screenshots with baselines:
```typescript
describe('overlay.grid', () => {
  it('renders grid overlay correctly', async () => {
    await page.goto('http://localhost:3000/grid-test.html');
    execSync('bdg overlay.grid --selector .grid --out test-grid.png');
    
    const diff = compareImages('test-grid.png', 'baseline-grid.png');
    expect(diff.percentage).toBeLessThan(1); // <1% difference
  });
});
```

### Accessibility Tests
Validate a11y checks against known issues:
```typescript
describe('dom.a11y', () => {
  it('detects low contrast text', async () => {
    await page.setContent(`
      <div style="color: #999; background: #fff;">Low contrast</div>
    `);
    const result = execSync('bdg dom.a11y --check color-contrast --json');
    expect(result.data.checks.colorContrast.failed).toBe(1);
  });
});
```

### Report Format Tests
Validate report structure:
```typescript
describe('dom.report', () => {
  it('generates valid markdown', async () => {
    execSync('bdg dom.report --selector h1 --out test.md --format md');
    const markdown = readFile('test.md');
    
    expect(markdown).toContain('# ');
    expect(markdown).toContain('**URL**:');
    expect(markdown).toContain('![');
  });
});
```

---

## Success Criteria

### Element Inspection (Week 7-8)
- [ ] `dom.inspect` returns all element data
- [ ] Computed styles accurate across browsers
- [ ] Accessibility info includes ARIA attributes
- [ ] Screenshot highlighting works

### Visual Reports (Week 9)
- [ ] `dom.report` generates JSON and Markdown
- [ ] Reports are portable and self-contained
- [ ] Screenshots are properly referenced
- [ ] Works on diverse sites

### Layout Overlays (Week 10)
- [ ] `overlay.grid` shows grid/flex overlays
- [ ] Multiple elements supported with `--all`
- [ ] Color coding is clear and distinguishable
- [ ] Works with nested layouts

### Accessibility (Week 11)
- [ ] `dom.a11y` detects common issues
- [ ] Contrast calculations are accurate
- [ ] ARIA validation against spec
- [ ] Actionable suggestions provided

### Examples & Documentation (Week 12)
- [ ] 5 example scripts demonstrate workflows
- [ ] Documentation includes screenshots
- [ ] All examples run in CI
- [ ] Human guide published

### Quality Gates
- [ ] `npm run check:enhanced` passes
- [ ] Visual regression tests passing
- [ ] Test coverage >80% for new code
- [ ] All TSDoc comments complete
- [ ] No breaking changes

---

## Implementation Order

### Week 6-7: Foundation
1. Research CDP methods for element inspection
2. Design output schema for `dom.inspect`
3. Prototype element querying and property extraction
4. Set up visual regression testing framework

### Week 7-8: `dom.inspect`
1. Implement element HTML and attribute extraction
2. Add bounding box calculation
3. Add computed styles via `CSS.getComputedStyleForNode`
4. Add accessibility info via `Accessibility.getPartialAXTree`
5. Add optional screenshot with highlighting
6. Write integration tests

### Week 9: `dom.report`
1. Design report schema (JSON and Markdown)
2. Implement report generation
3. Add screenshot bundling
4. Add markdown template
5. Test on diverse sites
6. Write integration tests

### Week 10: `overlay.grid`
1. Implement grid overlay using `Overlay.setShowGridOverlays`
2. Implement flex overlay using `Overlay.setShowFlexOverlays`
3. Add `--all` mode for multiple elements
4. Add color coding
5. Test with complex nested layouts
6. Write visual regression tests

### Week 11: `dom.a11y`
1. Implement accessibility tree retrieval
2. Build contrast ratio calculator
3. Add ARIA role validator
4. Add missing label detector
5. Add alt text checker
6. Format output with suggestions
7. Write integration tests

### Week 12: Examples & Polish
1. Write 5 human example scripts
2. Add scripts to CI
3. Create `docs/HUMAN_GUIDE.md`
4. Add screenshots to documentation
5. Final visual regression testing
6. Release v0.6.0

---

## Open Questions

### Pending
- ❓ Should `dom.inspect` include parent/children info?
- ❓ Report format: Support HTML output?
- ❓ Overlay colors: User-customizable or fixed?
- ❓ A11y checks: Which rules are most valuable?
- ❓ Should overlays persist across multiple screenshots?

### Decisions Needed
- Accessibility scoring: Use Lighthouse algorithm or custom?
- Report screenshots: Full page or element-only?
- Grid overlay: Show line numbers or just lines?

---

## Dependencies

**Required**:
- M1 and M2 completed
- CDP domains: DOM, CSS, Overlay, Accessibility
- Screenshot functionality from M1

**Blocked by**: None

---

## Next Steps After M3

1. Gather feedback on human-friendly commands
2. Identify missing debugging workflows
3. Plan M4: Community Preview and documentation site
4. Evaluate expanding to network and console human commands

---

## References

- [DOM domain (CDP)](https://chromedevtools.github.io/devtools-protocol/tot/DOM/)
- [CSS domain (CDP)](https://chromedevtools.github.io/devtools-protocol/tot/CSS/)
- [Overlay domain (CDP)](https://chromedevtools.github.io/devtools-protocol/tot/Overlay/)
- [Accessibility domain (CDP)](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Chrome DevTools Accessibility Features](https://developer.chrome.com/docs/devtools/accessibility/)
