# DOM Feature Plan

## Overview

Visual DOM inspection commands for `bdg`, designed with a **selector-first UX** that hides CDP's nodeId complexity while remaining composable and agent-friendly.

---

## The Problem with NodeIds

CDP uses `nodeId` (Chrome's internal element IDs) for all DOM operations. This creates UX friction:

```bash
# Raw CDP workflow (awkward!)
$ bdg cdp DOM.getDocument
{ "root": { "nodeId": 1 } }

$ bdg cdp DOM.querySelectorAll --nodeId=1 --selector=".error"
{ "nodeIds": [45, 67, 89] }

$ bdg cdp Overlay.highlightNode --nodeId=45
# User has to manually track and copy nodeIds
```

**Users shouldn't need to know about nodeIds.**

---

## How NodeIds Work (Background)

### Chrome assigns IDs automatically

```html
<div id="app">          <!-- nodeId: 5 -->
  <button>Click</button>  <!-- nodeId: 6 -->
  <div class="error">     <!-- nodeId: 7 -->
    Invalid input
  </div>
</div>
```

### You get nodeIds by querying

```bash
# 1. Get document root (nodeId: 1)
DOM.getDocument → { nodeId: 1 }

# 2. Query from root
DOM.querySelectorAll(nodeId: 1, selector: ".error") → [7, 12, 45]

# 3. Use nodeIds for operations
DOM.getOuterHTML(nodeId: 7) → "<div class='error'>..."
Overlay.highlightNode(nodeId: 7) → Visual overlay in browser
```

### NodeIds are session-specific

Each CDP session generates new nodeIds. They're temporary pointers, not stable references.

---

## Solution: Selector-First UX

Commands accept **CSS selectors** directly. NodeIds are hidden implementation details.

```bash
# Simple: work with selectors
bdg dom highlight ".error"           # Highlight all matches
bdg dom get ".error"                  # Get first match

# Advanced: use indices when needed
bdg dom query ".error"
[1] Invalid email
[2] Required field
bdg dom highlight 1                   # Highlight element #1

# Power users: nodeIds for composition
bdg dom query ".error" --json | jq -r '.nodes[0].nodeId' | xargs bdg dom highlight --node-id
```

---

## The 3 DOM Commands

### 1. `bdg dom query <selector>` - Search

Find elements by CSS selector, return numbered list.

```bash
# Basic usage
$ bdg dom query ".error"
Found 3 elements matching ".error":
  [1] <div class="error">Invalid email</div>
  [2] <span class="error">Required field</span>
  [3] <div class="error">Connection failed</div>

# JSON output (agent-friendly)
$ bdg dom query ".error" --json
{
  "selector": ".error",
  "count": 3,
  "nodes": [
    {
      "index": 1,
      "nodeId": 45,
      "tag": "div",
      "classes": ["error"],
      "preview": "Invalid email"
    },
    {
      "index": 2,
      "nodeId": 67,
      "tag": "span",
      "classes": ["error"],
      "preview": "Required field"
    },
    {
      "index": 3,
      "nodeId": 89,
      "tag": "div",
      "classes": ["error"],
      "preview": "Connection failed"
    }
  ]
}
```

**Caching:**
Results saved to `~/.bdg/last-query.json` so other commands can reference indices.

**CDP methods:**
- `DOM.getDocument` - Get root node
- `DOM.querySelectorAll` - Find matches
- `DOM.describeNode` - Get node metadata
- `DOM.getOuterHTML` - Get preview HTML

---

### 2. `bdg dom highlight <selector|index>` - Visual Debugging

Highlight elements in the browser with visual overlay.

```bash
# Highlight by selector (all matches)
$ bdg dom highlight ".error"
✓ Highlighted 3 elements matching ".error"

# Highlight specific match
$ bdg dom highlight ".error" --first
✓ Highlighted first element matching ".error"

$ bdg dom highlight ".error" --nth 2
✓ Highlighted element #2 matching ".error"

# Highlight by index from last query
$ bdg dom query "button"
[1] Submit
[2] Cancel

$ bdg dom highlight 1
✓ Highlighted element #1 (Submit button)

# Custom colors
$ bdg dom highlight ".error" --color red --opacity 0.7
✓ Highlighted with red overlay (70% opacity)

# Direct nodeId (for advanced users)
$ bdg dom highlight --node-id 45
✓ Highlighted node 45
```

**Why this is unique:**
- Visual feedback in the actual browser
- Can't easily do this in DevTools manually
- Perfect for demos and screenshots
- Great for agents: "show me the element with the issue"

**CDP methods:**
- `Overlay.highlightNode` - Show visual overlay
- Customizable: color, opacity, border, padding

---

### 3. `bdg dom get <selector|index>` - Get Details

Get full HTML, attributes, and metadata for elements.

```bash
# Get by selector (first match)
$ bdg dom get ".error"
<div class="error validation-error" data-field="email">
  Invalid email format
</div>

# Get specific match
$ bdg dom get ".error" --nth 2
<span class="error">Required field</span>

# Get all matches
$ bdg dom get ".error" --all
[1] <div class="error">Invalid email</div>
[2] <span class="error">Required field</span>
[3] <div class="error">Connection failed</div>

# Get by index from last query
$ bdg dom query "button"
[1] Submit
[2] Cancel

$ bdg dom get 2
<button type="button" class="btn-cancel">Cancel</button>

# JSON output (full details)
$ bdg dom get ".error" --json
{
  "nodeId": 45,
  "tag": "div",
  "attributes": {
    "class": "error validation-error",
    "data-field": "email"
  },
  "outerHTML": "<div class=\"error validation-error\" data-field=\"email\">Invalid email format</div>",
  "textContent": "Invalid email format"
}
```

**CDP methods:**
- `DOM.getOuterHTML` - Full HTML
- `DOM.getAttributes` - All attributes
- `DOM.describeNode` - Node metadata

---

## Workflow Examples

### Example 1: Find and Highlight Errors

```bash
# Start session
bdg localhost:3000

# Find errors
bdg dom query ".error"
[1] Invalid email
[2] Required field
[3] Connection failed

# Highlight them all
bdg dom highlight ".error"
✓ Highlighted 3 elements

# Or highlight just one
bdg dom highlight 2
✓ Highlighted element #2
```

### Example 2: Debug Form Validation

```bash
# Find all form inputs
bdg dom query "input[type=email]"
[1] <input type="email" name="email">

# Get full details
bdg dom get 1 --json
{
  "attributes": {
    "type": "email",
    "name": "email",
    "required": "true",
    "aria-invalid": "true"
  }
}

# Highlight the invalid field
bdg dom highlight 1 --color red
```

### Example 3: Agent Workflow

```bash
# Agent investigates UI issues

# 1. Find error elements
bdg dom query ".error" --json > errors.json

# 2. Parse and highlight each
cat errors.json | jq -r '.nodes[] | .nodeId' | \
  xargs -I {} bdg dom highlight --node-id {}

# 3. Get details for first error
cat errors.json | jq -r '.nodes[0].nodeId' | \
  xargs -I {} bdg dom get --node-id {} --json

# 4. Report findings
cat errors.json | jq -r '.nodes[] | "- \(.preview)"'
```

### Example 4: Compose with Other Commands

```bash
# Find slow requests and highlight related error elements
bdg network slow --threshold 1000 --json | \
  jq -r '.requests[] | .url | match("/api/(.+)") | .captures[0].string' | \
  xargs -I {} bdg dom query "[data-resource='{}']" --json | \
  jq -r '.nodes[] | .nodeId' | \
  xargs -I {} bdg dom highlight --node-id {}
```

---

## Implementation Details

### Session Cache

Commands that reference indices need a cache:

```json
// ~/.bdg/last-query.json
{
  "selector": ".error",
  "timestamp": "2025-11-04T12:00:00.000Z",
  "sessionId": "abc123",
  "nodes": [
    { "index": 1, "nodeId": 45, "preview": "Invalid email" },
    { "index": 2, "nodeId": 67, "preview": "Required field" },
    { "index": 3, "nodeId": 89, "preview": "Connection failed" }
  ]
}
```

**Behavior:**
- `bdg dom query` writes cache
- `bdg dom highlight 1` reads cache, looks up nodeId for index 1
- Cache invalidated on session change
- Cache expires after 5 minutes

### Command Signatures

```typescript
// src/cli/collectors/dom.ts

interface DomQueryOptions {
  json?: boolean;
}

interface DomHighlightOptions {
  first?: boolean;
  nth?: number;
  nodeId?: number;  // Advanced: direct nodeId
  color?: string;   // red, blue, green, yellow
  opacity?: number; // 0.0 - 1.0
  json?: boolean;
}

interface DomGetOptions {
  all?: boolean;
  nth?: number;
  nodeId?: number;  // Advanced: direct nodeId
  json?: boolean;
}

function handleDomQuery(selector: string, options: DomQueryOptions): Promise<void>
function handleDomHighlight(selectorOrIndex: string, options: DomHighlightOptions): Promise<void>
function handleDomGet(selectorOrIndex: string, options: DomGetOptions): Promise<void>
```

### Argument Parsing

Commands accept either selector or index:

```typescript
function parseSelectorOrIndex(arg: string): { type: 'selector' | 'index', value: string | number } {
  // If arg is a number, it's an index
  if (/^\d+$/.test(arg)) {
    return { type: 'index', value: parseInt(arg) };
  }

  // Otherwise it's a selector
  return { type: 'selector', value: arg };
}
```

**Usage:**
```typescript
const { type, value } = parseSelectorOrIndex(selectorOrIndex);

if (type === 'index') {
  // Look up nodeId from cache
  const cache = readQueryCache();
  const node = cache.nodes.find(n => n.index === value);
  const nodeId = node.nodeId;
} else {
  // Query by selector
  const nodeIds = await queryBySelector(value);
}
```

---

## File Structure

```
src/cli/
├── collectors/
│   ├── dom.ts                 # DOM command group
│   │   ├── makeDomCommand()   # Command builder
│   │   ├── showDomMenu()      # Menu when no args
│   │   ├── handleDomQuery()   # Query implementation
│   │   ├── handleDomHighlight() # Highlight implementation
│   │   └── handleDomGet()     # Get implementation
│   │
│   └── helpers/
│       ├── domCache.ts        # Query cache read/write
│       ├── domQuery.ts        # CDP query logic
│       └── selectorParser.ts # Parse selector vs index
```

---

## Menu System

```bash
$ bdg dom

DOM Inspector:
  bdg dom query <selector>     Find elements by CSS selector
  bdg dom highlight <sel|idx>  Highlight elements in browser
  bdg dom get <sel|idx>        Get full HTML and attributes

Arguments:
  <selector>  CSS selector (e.g., ".error", "#app", "button")
  <idx>       Index from last query (e.g., 1, 2, 3)

Options:
  --first           Target first match only
  --nth <n>         Target nth match
  --all             Target all matches
  --node-id <id>    Use nodeId directly (advanced)
  --json            Output as JSON

Examples:
  bdg dom query ".error"
  bdg dom highlight ".error" --first
  bdg dom highlight 1 --color red
  bdg dom get ".error" --json

Advanced:
  Use 'bdg cdp DOM.<method>' for full CDP access
  See: https://chromedevtools.github.io/devtools-protocol/tot/DOM/
```

---

## Agent-Friendly Design

### Structured Input
```bash
# Selectors and indices are both parseable
bdg dom query ".error"
bdg dom highlight 1
```

### Structured Output
```bash
# JSON everywhere
bdg dom query ".error" --json
bdg dom get ".error" --json
```

### Semantic Exit Codes
```
0   - Success
85  - Invalid selector syntax (INVALID_ARGUMENT)
90  - No active session (NO_SESSION)
92  - Element not found (RESOURCE_NOT_FOUND)
106 - CDP error (CDP_ERROR)
```

### Composability
```bash
# Pipe to jq, grep, awk
bdg dom query ".error" --json | jq -r '.nodes[] | .preview'

# Chain with xargs
bdg dom query ".error" --json | \
  jq -r '.nodes[] | .nodeId' | \
  xargs -I {} bdg dom get --node-id {} --json
```

---

## Phase 1: MVP Implementation

**Goal:** Get the 3 core commands working

### Tasks

1. **Infrastructure**
   - [ ] Create `src/cli/collectors/dom.ts`
   - [ ] Create `src/cli/helpers/domCache.ts`
   - [ ] Add cache file handling (`~/.bdg/last-query.json`)

2. **Commands**
   - [ ] Implement `bdg dom query <selector>`
     - [ ] CDP: `DOM.getDocument` + `DOM.querySelectorAll`
     - [ ] Human output: numbered list
     - [ ] JSON output: full node details
     - [ ] Write to cache

   - [ ] Implement `bdg dom highlight <selector|index>`
     - [ ] Parse selector vs index
     - [ ] Support `--first`, `--nth`, `--all`
     - [ ] CDP: `Overlay.highlightNode`
     - [ ] Support `--color`, `--opacity`

   - [ ] Implement `bdg dom get <selector|index>`
     - [ ] Parse selector vs index
     - [ ] Support `--nth`, `--all`
     - [ ] CDP: `DOM.getOuterHTML` + `DOM.getAttributes`
     - [ ] Human output: pretty HTML
     - [ ] JSON output: full details

3. **Menu**
   - [ ] Show menu when `bdg dom` called with no args
   - [ ] Include examples and usage

4. **Testing**
   - [ ] Test query with various selectors
   - [ ] Test highlight with colors/opacity
   - [ ] Test cache read/write
   - [ ] Test selector vs index parsing

---

## Future Enhancements

### Phase 2: Advanced Features

- [ ] **Tree view**: `bdg dom tree <selector>` - Show DOM tree structure
- [ ] **Diff**: `bdg dom diff <file>` - Compare with saved snapshot
- [ ] **Save**: `bdg dom save <file>` - Save DOM to file
- [ ] **Attributes**: `bdg dom attrs <selector>` - List all attributes
- [ ] **Classes**: `bdg dom classes <selector>` - List all classes
- [ ] **XPath**: `bdg dom xpath <xpath>` - Query by XPath

### Phase 3: Interactive Features

- [ ] **Screenshot**: `bdg dom screenshot <selector>` - Capture element screenshot
- [ ] **Scroll**: `bdg dom scroll <selector>` - Scroll element into view
- [ ] **Click**: `bdg dom click <selector>` - Simulate click
- [ ] **Type**: `bdg dom type <selector> <text>` - Simulate typing

### Phase 4: Analysis

- [ ] **Stats**: `bdg dom stats` - DOM statistics (nodes, depth, etc.)
- [ ] **Accessibility**: `bdg dom a11y <selector>` - Accessibility audit
- [ ] **Performance**: `bdg dom perf` - DOM performance metrics

---

## Success Metrics

### User Experience
- [ ] Can find elements without knowing nodeIds
- [ ] Can use indices from query results
- [ ] Visual feedback (highlight) works reliably
- [ ] Menu helps users discover commands

### Agent Friendliness
- [ ] All commands support `--json`
- [ ] Exit codes are semantic
- [ ] Output is composable (pipes work)
- [ ] NodeIds accessible for advanced users

### Performance
- [ ] Commands execute in < 200ms (local DOM)
- [ ] Cache reads/writes are fast
- [ ] Highlight is instant (visual feedback)

---

## References

- **CDP DOM Domain**: https://chromedevtools.github.io/devtools-protocol/tot/DOM/
- **CDP Overlay Domain**: https://chromedevtools.github.io/devtools-protocol/tot/Overlay/
- **Agent-Friendly Design**: `docs/AGENT_FRIENDLY_TOOLS.md`
- **Collector-Centric UX**: `docs/COLLECTOR_CENTRIC_UX.md`
