# Agent UX Issues

Issues identified during comprehensive UX testing across 5 real-world sites (Hacker News, CodePen, Amazon, MDN, Reddit) in two testing sessions.

## Critical Issues

### 1. ~~Buffer Overflow on Large Pages~~ ✅ FIXED

**Status**: Fixed in current branch

**Verification**:
```bash
bdg "https://www.amazon.com/s?k=echo+dot"
bdg dom click "h2.a-size-medium" --index 2
bdg dom screenshot /tmp/amazon.png
# Now works! Captured 18.8 MB screenshot (36613px tall page)
```

**Fix**: Buffer size increased or chunking implemented to handle large screenshots.

---

### 2. ~~`bdg dom click` Command Unreliable~~ ✅ FIXED

**Status**: Fixed in current branch

**Verification**:
```bash
bdg https://news.ycombinator.com
bdg dom query ".subtext a"
bdg dom click ".subtext a" --index 4   # Now works!
# ✓ Element Clicked, navigates to comments page

bdg dom click 0                        # NEW! Direct index support
# ✓ Element Clicked, uses cached selector from last query
```

**Fixes**:
1. Click command now works reliably across different sites
2. **NEW**: Accepts direct numeric index from query results (0-based)
3. Help text updated to document `<selectorOrIndex>` argument

---

### 3. ~~Index Inconsistency Between Commands~~ ✅ FIXED

**Status**: Fixed in current branch

**New Behavior**:
```bash
bdg dom query ".subtext a"      # Shows [0], [1], [2], [3]...
bdg dom get 0                   # Works (0-based) ✓
bdg dom a11y describe 0         # Works (0-based) ✓
bdg dom click 0                 # NOW WORKS! (0-based) ✓
bdg dom click ".subtext a" --index 4  # Still works (1-based for selector)
```

**Design**:
- **Direct index argument**: 0-based (matches query output)
- **`--index` flag with selector**: 1-based (human-friendly "first", "second", etc.)

This is documented in `bdg dom click --help`:
```
Arguments:
  selectorOrIndex  CSS selector or numeric index from query results (0-based)
Options:
  --index <n>      Element index if selector matches multiple (1-based)
```

---

### 4. ~~`bdg dom get` Semantic Output Too Minimal~~ ✅ FIXED

**Status**: Fixed in current branch

**Fix**: Now includes DOM context (tag, classes, text preview) when a11y name is missing via `getDomContext()` helper and `formatSemanticNodeWithContext()` formatter.

**New Output**:
```bash
bdg dom get 0
# Now returns: [Article] <article.ContentGridItem-module_root...> "Open in Editor3D CSS..."
```

---

### 5. ~~`bdg dom a11y describe` Not Useful~~ ✅ FIXED

**Status**: Fixed in current branch

**Fix**: Now uses `formatA11yNodeWithContext()` which includes DOM context (tag, classes, text preview) as fallback when a11y name/description is missing.

**New Output**:
```bash
bdg dom a11y describe 0
# Now returns:
# Accessibility Node: row
# ──────────────────────────────────────────────────
# Tag:          <tr>
# Classes:      athing submission
# Text Preview: 1.Olmo 3: Charting a path through...
# Node ID:      525
# DOM Node ID:  525
```

**Note**: Output is now consistently useful across sites, even when a11y properties are sparse.

---

## High Priority Issues

### 6. `--type` Filter Confusion When No Matches (NEW)

**Severity**: High (misleading output)

**Symptoms**:
- When `--type` filter matches nothing, shows different data type without indication
- User thinks filter worked but sees unrelated data

**Reproduction**:
```bash
bdg https://developer.mozilla.org/...
bdg peek --type Stylesheet    # No stylesheets in preview window
# Output shows CONSOLE messages instead, with no indication filter failed
```

**Expected**: Clear message like "No Stylesheet requests found. Showing all data."

---

### 7. `bdg dom a11y` Subcommand Not Discoverable (NEW)

**Severity**: Medium (requires help lookup)

**Symptoms**:
- `bdg dom a11y "nav"` fails with "unknown command 'nav'"
- Must use `bdg dom a11y query "role:navigation"` or `bdg dom a11y describe <index>`
- Subcommand structure not obvious from parent help

**Reproduction**:
```bash
bdg dom a11y "nav"           # FAILS - unknown command
bdg dom a11y --help          # Shows: tree, query, describe subcommands
bdg dom a11y query "role:navigation"  # Works
```

**Impact**: Agents try intuitive syntax first, fail, then need to read help.

---

### 8. Headless Mode Blocked by Bot Detection

**Severity**: High (limits automation scenarios)

**Affected Sites**:
- CodePen (Cloudflare Turnstile)
- Reddit (www.reddit.com bot detection)

**Symptoms**:
- 403 responses with "Verify you are human" pages
- Cloudflare challenge pages

**Workarounds**:
- Remove `--headless` flag (requires display)
- Use alternative URLs (old.reddit.com instead of www.reddit.com)

---

### 9. URL Parameters Require Shell Quoting

**Severity**: Medium (friction for common operations)

**Symptoms**:
- URLs with `?` or `&` cause shell glob expansion errors
- Not immediately obvious to users

**Workaround**:
```bash
bdg "https://www.amazon.com/s?k=echo+dot"  # Quote the URL
```

---

## Medium Priority Issues

### 10. Console Command Inconsistent Naming

**Severity**: Low (naming inconsistency)

**Current**: `bdg console` (no subcommand structure)
**Expected**: `bdg console query`, `bdg console filter` etc. (matches `bdg dom *`, `bdg network *`)

---

### 11. No Aliases for Common Operations

**Severity**: Low (ergonomics improvement)

**Suggested Aliases**:
| Current | Suggested Alias | Reason |
|---------|-----------------|--------|
| `bdg dom query` | `bdg find` | Most frequent command |
| `bdg dom eval` | `bdg js` | Shorter for repetitive use |
| `bdg network getCookies` | `bdg cookies` | Common operation |

---

### 12. No Network Idle Wait (NEW)

**Severity**: Medium (required for SPAs)

**Symptoms**:
- No built-in way to wait for network activity to settle
- Must use `sleep` commands as workaround
- SPAs require waiting after navigation for content to load

**Current Workaround**:
```bash
bdg dom click "a" --index 1
sleep 2                        # Manual wait
bdg dom query "..."            # Now check for content
```

**Expected**: `bdg wait --network-idle` or similar command.

---

## Documentation Gaps

### Sites Known to Block Automation

Should document:
- **Cloudflare-protected sites**: CodePen, many e-commerce sites
- **Reddit**: www.reddit.com blocks, old.reddit.com works
- **General SPA sites**: May require waiting for JS execution

### Workaround Patterns

Should document prominently:
```bash
# Click workaround (MOST COMMON ISSUE)
bdg dom eval "document.querySelectorAll('selector')[INDEX].click()"

# Navigation workaround
bdg dom eval "location.href = 'https://example.com/page'"

# Wait for element (no native support)
sleep 2  # or: bdg dom eval "new Promise(r => setTimeout(r, 2000))"

# Get element by query index
bdg dom query "selector"       # Note the [N] index
bdg dom get N                  # Use that index here (0-based)
```

---

## What Works Well

For reference, these patterns worked excellently across all tests:

1. **`bdg dom query <selector>`** - Semantic output with text previews is outstanding
2. **`bdg dom a11y query "role:button"`** - Found 168 buttons with names on Reddit
3. **`bdg peek --type X,Y`** - Network filtering by resource type (when matches exist)
4. **`bdg peek --verbose`** - Full URLs and MIME types very helpful
5. **`bdg network getCookies`** - Reliable cookie extraction with full attributes
6. **`bdg network har`** - Clean HAR export, works with jq for post-processing
7. **`bdg dom screenshot`** - Reliable (except buffer overflow on huge pages)
8. **`bdg dom get <index> --raw`** - Raw HTML extraction always works
9. **`bdg dom eval`** - Reliable workaround for interactions
10. **Session startup hints** - Command suggestions help discoverability

---

## Test Coverage

### Set 1 (Initial Testing)
| Site | Type | Outcome |
|------|------|---------|
| Hacker News | Static/Server-rendered | Works well (click workaround needed) |
| CodePen | SPA + Cloudflare | Headless blocked, normal mode works |
| Amazon | Complex E-commerce | Works with complex selectors |
| MDN | Partial SPA | Works well |
| Reddit (old) | Server-rendered | Works perfectly |
| Reddit (www) | SPA + Bot detection | Blocked |

### Set 2 (Headed Mode Testing)
| Site | Type | Outcome |
|------|------|---------|
| Hacker News | Static | Works well; click now works directly |
| CodePen | SPA | Works; CSS modules make selectors unpredictable |
| Amazon | E-commerce | Works now; 18.8MB screenshot captured successfully |
| MDN | Documentation | Works well; many elements (428 code blocks) |
| Reddit (www) | SPA | Works in headed mode; click now works directly |

### Set 3 (P0 Verification Testing)
| Issue | Test | Result |
|-------|------|--------|
| Buffer overflow | Amazon product screenshot (18.8MB) | ✅ PASS |
| Click reliability | HN comments link, CodePen title link | ✅ PASS |
| Index consistency | `bdg dom click 0` after query | ✅ PASS |

---

## Recommended Priority

1. ~~**P0**: Fix buffer overflow on large pages~~ ✅ FIXED
2. ~~**P0**: Fix `bdg dom click` command reliability~~ ✅ FIXED
3. ~~**P0**: Unify index handling (0-based everywhere, accept index directly)~~ ✅ FIXED
4. **P1**: Improve `--type` filter feedback when no matches
5. ~~**P1**: Improve `bdg dom a11y describe` output consistency~~ ✅ FIXED
6. **P1**: Document headless mode limitations and workarounds
7. **P2**: Add network idle wait command
8. **P2**: Add command aliases
9. ~~**P2**: Improve error messages with actionable suggestions~~ (less urgent now that click works)

## Fixed Issues (Current Branch)

- ✅ **#1**: Buffer overflow fixed - 18.8MB Amazon screenshot now works
- ✅ **#2**: `bdg dom click` now works reliably + accepts direct index argument
- ✅ **#3**: Index consistency - `dom click 0` now works (0-based, matches query output)
- ✅ **#4**: `bdg dom get` now includes DOM context when a11y name is missing
- ✅ **#5**: `bdg dom a11y describe` now shows tag, classes, and text preview as fallback
