# Chrome Inspector Evaluation and Integration Plan

Date: 2025-11-22
Owner: bdg maintainers
Status: Draft

**Repository:** https://github.com/devtoolcss/chrome-inspector

## Summary
chrome-inspector is a lightweight TypeScript library that exposes a DevTools-like programming interface over the Chrome DevTools Protocol (CDP).

This document captures a deep-dive analysis of its modules and recommends how bdg can adopt the most useful ideas with minimal risk. It also outlines an incremental roadmap and concrete implementation steps.

## Why It’s Relevant to bdg
- bdg already offers raw CDP plus human-friendly CLI wrappers. chrome-inspector complements this with a DOM-oriented API and style inspection.
- For agent workflows and interactive debugging, repeatedly querying CDP is slow and chatty. A DOM mirror enables fast, local queries with better ergonomics.
- Style cascade and computed styles are hard to reconstruct from scratch; chrome-inspector and @devtoolcss/parser provide mature parsing utilities.

## Compatibility: Raw CDP, Not Framework-Locked
chrome-inspector is NOT tied to Puppeteer/Playwright. It only needs a CDP client with:
- send(method, params?) => Promise<any>
- on(event, callback)
- off(event, callback)

bdg’s CDPConnection already provides compatible primitives. The only mismatch is our `on()` returns a cleanup function and `off()` takes a handler ID; a thin adapter solves this (see Integration section).

---

## Module-by-Module Analysis

### EventEmitter.ts
**Purpose:** Internal event system for Inspector class.

**Implementation:**
- `on(event: string, listener: Function): void` - Registers event listener. Stores listeners in Map keyed by event name.
- `off(event: string, listener: Function): void` - Removes specific listener by reference equality check.
- `emit(event: string, ...args: any[]): void` - Invokes all registered listeners for an event with provided arguments.

**Usage in Inspector:**
- Emits 'warning' events when DOM sync encounters missing nodes
- Re-emits CDP events after processing (DOM.setChildNodes, DOM.childNodeInserted, etc.)
- Allows users to observe Inspector internal state changes

**Design notes:** Simple implementation without Node.js EventEmitter dependency. Not exposed in public API.

---

### constants.ts
**Purpose:** W3C DOM node type constants for type checking during tree construction.

**Exports:**
```typescript
enum CDPNodeType {
  ELEMENT_NODE = 1,
  TEXT_NODE = 3,
  COMMENT_NODE = 8,
  DOCUMENT_NODE = 9,
  DOCUMENT_FRAGMENT_NODE = 11,
  // ... etc (12 total)
}
```

**Usage:** Switch statements in `buildNodeTree()` to determine which JSDOM constructor to use (createElement, createTextNode, createComment, etc.).

---

### types.ts
**Purpose:** CDP response type definitions that remain stable across protocol versions.

**Key Types:**

1. **GetMatchedStylesForNodeResponse**
   - `inlineStyle?` - Inline style attribute parsed
   - `matchedCSSRules?[]` - CSS rules matched to element (from stylesheets)
   - `inherited?[]` - Inherited styles from ancestors
   - `pseudoElements?[]` - Pseudo-element styles (::before, ::after, etc.)
   - `cssKeyframesRules?[]` - Animation keyframes
   - `[key: string]: any` - Flexible for new CDP fields

2. **GetComputedStyleForNodeResponse**
   - `computedStyle: { name: string; value: string }[]` - Final computed CSS properties
   - `extraFields: Object` - Reserved for future CDP additions

3. **CDPNode** (partial mirror of Protocol.DOM.Node)
   - `nodeId: number` - CDP's unique node identifier
   - `nodeType: number` - W3C node type (1=element, 3=text, etc.)
   - `localName: string` - Tag name (lowercase)
   - `attributes?: string[]` - Flat array [name1, value1, name2, value2, ...]
   - `children?: CDPNode[]` - Child nodes (may be incomplete from CDP)

4. **Device**
   - `width/height: number` - Viewport dimensions
   - `deviceScaleFactor: number` - For retina/HiDPI
   - `mobile: boolean` - Affects user-agent and touch events

**Design notes:** Uses index signatures to prevent breakage when CDP adds new fields. Minimal subset of devtools-protocol types.

---

### highlightConfig.ts
**Purpose:** Pre-configured visual styles for element highlighting overlay.

**Configuration includes:**
- **Box model colors:** content (blue), padding (green), border (yellow), margin (orange)
- **Grid layout:** row/column gaps, lines, and hatching (purple theme)
- **Flexbox layout:** container borders, item separators, distributed space visualization
- **Contrast algorithm:** 'aa' for WCAG AA compliance checks
- **Special colors:** event target zones, CSS shape-outside visualization

**Usage:** Passed to `Overlay.highlightNode` when `element.highlight()` is called. Matches DevTools default theme.

**Why hardcoded:** Simplifies API; users rarely need custom highlight colors. Could be extended to accept user overrides.

### InspectorDOM.ts
**Purpose:** Wrapper classes that expose a DOM-like API backed by CDP.

---

#### InspectorNode (Base Class)
**Properties:**
- `_docNode: Node` - The JSDOM mirror node
- `_cdpNode: CDPNode` - Original CDP node metadata
- `inspector: Inspector` - Reference to parent Inspector for CDP calls
- `objectId?: string` - Cached RemoteObjectId for Runtime operations

**Key Methods:**

1. **`static get(node: Node): InspectorNode`**
   - Retrieves InspectorNode wrapper from JSDOM node
   - Uses WeakMap for O(1) lookup without memory leaks
   - Throws if node not registered (safety check)

2. **`get tracked(): boolean`**
   - Validates element still exists in Inspector's nodeId map
   - Prevents operations on removed/stale nodes
   - Returns false if DOM was updated and this node was removed

3. **`protected async callFunctionOn(args: any[], functionDeclaration: string)`**
   - Executes JavaScript function in browser context on this node
   - Lazy-fetches RemoteObjectId via DOM.resolveNode on first use
   - Parses exception details and throws with line/column info
   - Used by all mutation methods (click, remove, scrollIntoView)

4. **`async remove(): Promise<void>`** (experimental)
   - Removes node from browser DOM via `this.remove()` in Runtime
   - Does not update mirror immediately (waits for DOM.childNodeRemoved event)

5. **`async highlight(): Promise<void>`**
   - Visual overlay highlight via Overlay.highlightNode
   - Convenience wrapper; calls `inspector.highlightNode(this)`

**Standard DOM Properties (read-only getters):**
- `nodeType, nodeName, nodeValue, textContent`
- `parentNode, childNodes, firstChild, lastChild`
- `nextSibling, previousSibling`
- `contains(other)` - Checks containment in JSDOM tree

---

#### InspectorElement (extends InspectorNode)
**Additional Properties:**
- `tagName, id, className` - Standard element properties
- `classList: DOMTokenList` - JSDOM's class list API
- `attributes: NamedNodeMap` - Live attribute collection
- `innerHTML, outerHTML` - Serialized HTML strings
- `children` - Element children only (excludes text nodes)

**Query Methods:**

1. **`querySelector(selector: string): InspectorElement | null`**
   - Queries against JSDOM mirror (fast, local)
   - Returns wrapped InspectorElement, not raw JSDOM node
   - Null if no match

2. **`querySelectorAll(selector: string): InspectorElement[]`**
   - Returns array of wrapped elements
   - Empty array if no matches

3. **`closest(selector: string): InspectorElement | null`**
   - Traverses up the tree in JSDOM
   - Returns first matching ancestor (or self)

4. **`matches(selector: string): boolean`**
   - Tests if this element matches selector

5. **`getAttribute(name: string): string | null`**
   - Retrieves attribute value from JSDOM

**Runtime Interaction Methods (experimental):**

1. **`async click(): Promise<void>`**
   - Executes `this.click()` via callFunctionOn
   - Triggers actual browser click (fires events, follows links)

2. **`async scrollIntoView(): Promise<void>`**
   - Scrolls element into viewport
   - Uses default scrollIntoView() behavior

**CDP-Specific Methods:**

1. **`async forcePseudoState(pseudoClasses: string[]): Promise<void>`**
   - Forces CSS pseudo-classes (:hover, :focus, :active, etc.)
   - Persists until cleared with empty array
   - Example: `el.forcePseudoState(['hover', 'focus'])`

2. **`async getMatchedStyles(options?: MatchedStylesOptions): Promise<ParsedCSS>`**
   - Fetches CSS cascade (inline, matched rules, inherited, pseudo-elements)
   - `{ raw: true }` returns raw CDP response
   - Default: parsed via @devtoolcss/parser into friendly structure
   - Includes source info (stylesheet URL, line numbers)

3. **`async getComputedStyle(options?: ComputedStyleOptions): Promise<Record<string, string>>`**
   - Fetches final computed styles
   - `{ raw: true }` returns array format from CDP
   - Default: converted to `{ property: value }` object

**Element Navigation (returns wrapped nodes):**
- `parentElement, nextElementSibling, previousElementSibling`
- `firstChild, lastChild` (may return InspectorNode for text nodes)

---

#### InspectorDocument (extends InspectorNode)
**Document-Level Accessors:**
- `get body(): InspectorElement | null` - <body> element
- `get head(): InspectorElement | null` - <head> element
- `get documentElement(): InspectorElement | null` - <html> element

**Query Methods:**

1. **`querySelector(selector: string): InspectorElement | null`**
   - Document-level CSS selector query
   - Delegates to JSDOM's document.querySelector

2. **`getElementById(id: string): InspectorElement | null`**
   - Fast ID lookup via JSDOM

3. **`getElementsByClassName(className: string): InspectorElement[]`**
   - Live collection converted to array snapshot

4. **`getElementsByTagName(tagName: string): InspectorElement[]`**
   - Case-insensitive tag search

5. **`queryXPath(xpath: string): InspectorNode | null`** (experimental)
   - XPath query with namespace resolver
   - Uses JSDOM's document.evaluate
   - Returns first match (XPathResult.FIRST_ORDERED_NODE_TYPE)

6. **`queryXPathAll(xpath: string): InspectorNode[]`** (experimental)
   - Returns all XPath matches
   - Snapshot mode (not live collection)

**Namespace Resolver:**
- Pre-configured for svg/xhtml namespaces
- Used by XPath queries automatically

**Safety:**
- `remove()` throws error (cannot remove document node)
- Prevents accidental document destruction

---

**Common Patterns:**
- WeakMap registry prevents memory leaks (JSDOM nodes can be GC'd)
- Tracked validation before every CDP operation
- Wrapper methods return other wrappers (never raw JSDOM nodes)
- Experimental methods documented as such (DOM mutations, XPath)

### Inspector.ts (Core)
**Purpose:** Main orchestrator for CDP lifecycle, DOM mirroring, and style operations.

---

#### Initialization & Factory Methods

**`static async fromCDPClient(client: CDPClient, options: InspectorOptions): Promise<Inspector>`**
- Factory pattern ensures fully-initialized Inspector before returning
- Steps:
  1. Creates Inspector instance
  2. Calls init() - enables CDP domains
  3. Calls initDOM() - fetches and builds DOM mirror
  4. Optionally sets $0 via XPath

**`static async fromChromeDebugger(chromeDebugger, tabId, options): Promise<Inspector>`**
- Chrome Extension adapter
- Wraps chrome.debugger.sendCommand in CDPClient interface
- Maintains listener map to support off() removal

**Constructor Options:**
- `documentImpl?: DOMImplementation` - JSDOM instance (required in Node.js)
- `eventTimeout?: number` - Timeout for event-driven operations (default 100ms)
- `$0XPath?: string` - Initial selected element
- `sync$0Enabled?: boolean` - Enable/disable $0 synchronization

---

#### DOM Mirror Construction

**`protected async initDOM(): Promise<void>`**
- Fetches complete DOM tree: `DOM.getDocument({ depth: -1 })`
- Clears existing mirror
- Calls buildNodeTree(root) recursively

**`protected buildNodeTree(cdpNode: CDPNode): Node | null`**
- Recursively constructs JSDOM tree from CDP nodes
- Switch by nodeType:
  - ELEMENT_NODE → createElement + setAttribute for each attribute
  - TEXT_NODE → createTextNode
  - COMMENT_NODE → createComment
  - DOCUMENT_NODE → createHTMLDocument, remove default <html>
- Creates InspectorNode/Element/Document wrapper
- Registers in nodeId map: `setMap(nodeId, inspectorNode)`
- Returns JSDOM node for parent to appendChild

**Node Map Operations:**
- `setMap(nodeId, node)` - Registers InspectorNode by CDP nodeId
- `deleteMap(nodeId, recursive=true)` - Removes node and descendants from map
- `getNodeByNodeId(nodeId)` - Lookup for tracked validation

---

#### DOM Synchronization (Event Handlers)

**`protected registerDOMHandlers(): void`**
- Subscribes to CDP DOM mutation events
- Sync handlers (immediate update):
  - `DOM.attributeModified` → update attributes[] array + setAttribute on JSDOM
  - `DOM.attributeRemoved` → remove from array + removeAttribute
  - `DOM.characterDataModified` → update nodeValue on text/comment nodes
  - `DOM.childNodeRemoved` → deleteMap + removeChild from JSDOM
- Async handlers (may fetch additional data):
  - `DOM.childNodeInserted` → calls onChildNodeInserted
  - `DOM.documentUpdated` → full re-init via initDOM

**`protected async onChildNodeInserted(params): Promise<void>`**
- Complex async path to handle incomplete child trees
- Flow:
  1. Check if inserted node has children but children array is undefined
  2. If so, call `getChildren(childCdpNode)` to fetch via DOM.requestChildNodes
  3. Build JSDOM subtree via buildNodeTree
  4. Find insertion point (after previousNodeId)
  5. Insert into both CDP children array and JSDOM via insertBefore
- Why async: CDP may return node without full subtree; must request explicitly

**`protected async getChildren(node: CDPNode): Promise<void>`**
- Sends DOM.requestChildNodes with depth: -1
- Awaits DOM.setChildNodes event (with timeout fallback)
- Populates node.children array
- Emits event after processing

---

#### $0 Synchronization

**`protected async registerBinding(): void`**
- Adds Runtime binding: `__chrome_inspector_send_$0_xpath`
- Chrome extension calls this binding when DevTools selection changes
- Handler calls `set$0ByXPath(xpath)` to update selectedNode

**`get $0(): InspectorNode | undefined`**
- Returns currently selected element (if tracked)
- Validates tracked status on access

**`set$0ByXPath(xpath: string): void`**
- Sets selectedNode via XPath lookup
- Used by sync extension

**`toggleSync$0(enable: boolean): void`**
- Enable/disable $0 updates from extension

---

#### CDP Domain Initialization

**`protected async init(): Promise<void>`**
- Enables required CDP domains:
  - `DOM.enable` - DOM tree access
  - `CSS.enable` - Style inspection
  - `Overlay.enable` - Visual highlights
  - `Runtime.enable` - JavaScript execution
- Registers DOM event handlers
- Registers Runtime binding for $0

---

#### Style Inspection Methods

**`async getMatchedStyles(element, options): Promise<ParsedCSS | GetMatchedStylesForNodeResponse>`**
- Validates element.tracked
- Sends CSS.getMatchedStylesForNode with element's nodeId
- Options:
  - `{ raw: true }` → returns raw CDP response
  - `{ raw: false, parseOptions }` → parses via @devtoolcss/parser
- Parsed format includes:
  - Selector lists, matched selectors
  - Properties with name/value/important/applied flags
  - Origin (user-agent, user, regular)
  - Source location (stylesheet URL, line, column)

**`async getComputedStyle(element, options): Promise<Record<string, string> | GetComputedStyleForNodeResponse>`**
- Validates element.tracked
- Sends CSS.getComputedStyleForNode
- Options:
  - `{ raw: true }` → returns `{ computedStyle: [{name, value}, ...] }`
  - Default → converts to object `{ 'property-name': 'value' }`

---

#### Element Operations

**`async highlightNode(node: InspectorNode): Promise<void>`**
- Validates node.tracked
- Sends Overlay.highlightNode with:
  - nodeId
  - predefined highlightConfig (box model colors, grid/flex visualization)

**`async hideHighlight(): Promise<void>`**
- Clears current highlight overlay
- Global operation (only one element highlighted at a time)

**`async forcePseudoState(element: InspectorElement, pseudoClasses: string[]): Promise<void>`**
- Validates element.tracked
- Sends CSS.forcePseudoState with nodeId + array of classes
- Pseudo-classes: 'hover', 'active', 'focus', 'focus-within', 'focus-visible', 'visited'
- Persists until cleared (pass empty array)

**`async setDevice(device: Device): Promise<void>`**
- Emulates device via Emulation.setDeviceMetricsOverride
- Sets width, height, deviceScaleFactor, mobile flag
- Affects viewport, user-agent, touch events

---

#### Legacy Forwarding Methods

**`querySelector/querySelectorAll/queryXPath/queryXPathAll`**
- Convenience wrappers that delegate to `this.document.*`
- Allows `inspector.querySelector('body')` instead of `inspector.document.querySelector('body')`

---

#### Event System

**Inherits from EventEmitter:**
- `on(event, listener)` - Subscribe to warnings or re-emitted CDP events
- `emit(event, ...args)` - Used internally
- `emitWarning(message)` - Emits 'warning' for sync issues (missing nodes, etc.)

**User-subscribable events:**
- 'warning' - Sync errors, missing nodes
- 'DOM.setChildNodes' - After processing DOM.requestChildNodes
- 'DOM.childNodeInserted' - After mirror update
- 'DOM.attributeModified', etc. - All DOM mutation events

---

**Critical Design Decisions:**
1. **depth: -1 strategy** - Fetch full tree upfront, avoid N queries
2. **Event-driven sync** - Mirrors live mutations instead of polling
3. **Async childNodeInserted** - Balance completeness vs. latency
4. **WeakMap registry** - Memory-safe bidirectional mapping
5. **tracked validation** - Fail fast on stale references

### NodeInspector.ts
**Purpose:** Node.js adapter for Inspector that provides JSDOM integration.

**Implementation:**
```typescript
class NodeInspector extends Inspector {
  static async fromCDPClient(client, options = {}) {
    if (!options.documentImpl) {
      await initDocumentImpl(); // Lazy-load jsdom
      options.documentImpl = documentImpl;
    }
    // Delegates to base Inspector constructor
  }
}
```

**Key Functions:**

1. **`async initDocumentImpl(): Promise<void>`**
   - Dynamic import of jsdom: `JSDOM = (await import('jsdom')).JSDOM`
   - Creates new JSDOM instance
   - Extracts `window.document.implementation`
   - Cached in module scope (only runs once)

**Why separate from base Inspector:**
- Browser environments have native `window.document.implementation`
- Node.js requires jsdom dependency (~2MB)
- Lazy import prevents loading jsdom in browser bundles
- Keeps base Inspector platform-agnostic

**Usage in bdg:**
- Worker process runs in Node.js → use NodeInspector
- Auto-detects environment and provides documentImpl

---

### index.ts / index.browser.ts / index.shared.ts
**Purpose:** Dual entry points for Node.js and browser environments.

**index.ts (Node.js - main export)**
```typescript
export * from "./index.shared.js";
export * from "./extensionPath.js";  // Node-only
export { NodeInspector as Inspector };  // JSDOM-enabled version
```

**index.browser.ts (Browser bundle)**
```typescript
export * from "./index.shared.js";
export { Inspector };  // Base version (no JSDOM)
```

**index.shared.ts (Common exports)**
```typescript
export * from "./constants.js";
export * from "./types.js";
export * from "./InspectorDOM.js";
export { ParsedCSS } from "@devtoolcss/parser";
```

**Package.json Configuration:**
```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "browser": "./dist/index.browser.js",  // Webpack/Rollup picks this
    "import": "./dist/index.js"             // Node.js picks this
  }
}
```

---

### extensionPath.ts
**Purpose:** Export filesystem path to bundled Chrome extension.

**Implementation:**
```typescript
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CHROME_INSPECTOR_SYNC_EXTENSION_PATH = 
  path.join(__dirname, 'extension');
```

**Extension Purpose:**
- Syncs DevTools-selected element ($0) to Inspector instance
- Sends XPath of selected element via Runtime binding
- Enables interactive debugging (click in DevTools → access in script)

**Usage:**
```typescript
import { CHROME_INSPECTOR_SYNC_EXTENSION_PATH } from 'chrome-inspector';

// Puppeteer
await puppeteer.launch({
  args: [`--load-extension=${CHROME_INSPECTOR_SYNC_EXTENSION_PATH}`]
});

// Playwright
await chromium.launchPersistentContext(userDataDir, {
  args: [`--load-extension=${CHROME_INSPECTOR_SYNC_EXTENSION_PATH}`]
});
```

**How it works:**
1. Extension content script observes DevTools
2. On selection change, computes XPath of $0
3. Calls Runtime binding: `__chrome_inspector_send_$0_xpath(xpath)`
4. Inspector receives binding event, updates `inspector.$0`

**bdg integration:**
- Optional enhancement for interactive debugging
- Not required for basic functionality

---

## Concepts to Reuse in bdg

### DOM Mirroring
- Maintain a JSDOM mirror of the target page to enable fast queries and stable element handles.
- Keep it in sync via DOM.* mutation events, request children as needed on insert, and refresh on documentUpdated.
- Benefits: drastic reduction in CDP chatter, instant selector queries, easier higher-level operations.
- Risks: memory usage on very large documents; sync correctness across frames/shadow DOM.

### Tracked Element Handles
- Provide handles with nodeId + metadata and a tracked check to fail fast on stale references.
- Improves error messages and reliability of multi-step workflows (query → operate later).

### Runtime.callFunctionOn Pattern
- Prefer callFunctionOn with RemoteObjectId over repeated selector-based Runtime.evaluate calls.
- Better performance and exceptions with stack info; avoids brittle re-query on every action.

### Style Inspection API
- Wrap CSS.getMatchedStylesForNode and CSS.getComputedStyleForNode with:
  - raw option for power users
  - parsed option via @devtoolcss/parser for immediate usability
- Enables CLI commands: computed style, matched rules, reverse style lookup.

### Pseudo-State Forcing & Overlay Highlight
- Force :hover/:focus/:active for screenshots and visual debugging.
- First-class CLI wrappers improve day-to-day debugging.

---

## Integration with bdg (Incremental)

### Adapter for Raw CDP (no Puppeteer/Playwright required)
A thin adapter bridges signature differences:

```ts
// src/integrations/chromeInspectorAdapter.ts
import { Inspector } from 'chrome-inspector';
import type { CDPConnection } from '@/connection/cdp.js';

export async function createInspector(cdp: CDPConnection) {
  const cleanupByCallback = new WeakMap<Function, () => void>();

  const client = {
    send: (method: string, params?: object) => cdp.send(method, params ?? {}),
    on: (event: string, callback: (data: any) => void) => {
      const cleanup = cdp.on(event, callback);
      cleanupByCallback.set(callback, cleanup);
    },
    off: (event: string, callback: (data: any) => void) => {
      const cleanup = cleanupByCallback.get(callback);
      if (cleanup) cleanup();
    },
  };

  return Inspector.fromCDPClient(client, {});
}
```

Use chrome-inspector only when mirror is enabled. Otherwise, stick to bdg’s raw CDP path for simplicity.

### Tier 1 (Low risk / High value)
1) Style inspection wrappers
- New module: src/telemetry/styles.ts
- Commands:
  - `bdg dom styles <selector>` → CSS.getComputedStyleForNode (object form)
  - `bdg dom matched-rules <selector>` → CSS.getMatchedStylesForNode (raw/parsed)

2) callFunctionOn-backed actions
- Refactor `bdg dom click`, `bdg dom highlight`, `bdg dom eval-on <selector> <fn>` to use RemoteObjectId + callFunctionOn.

3) Pseudo-state forcing
- `bdg dom pseudo <selector> --states hover,focus,active` → CSS.forcePseudoState

### Tier 2 (Medium effort)
4) Optional DOM Mirror Mode (`--cache`)
- Worker process maintains mirror; selectors resolve against JSDOM first.
- Validate tracked() then operate via nodeId/objectId.
- Fallback to live CDP when mirror is out-of-sync; emit warnings and auto-recover.

5) Element Handles
- Return structured handles from query commands; subsequent commands accept handles directly.
- Detect and report staleness (removed/changed document).

### Tier 3 (Future)
6) $0 Sync Extension (optional)
- Sync DevTools-selected element into bdg (helpful during interactive debugging).

7) Shadow DOM & frames support
- Incremental support in mirror with per-frame mirrors and composed tree helpers.

---

## CLI Additions (Proposed)
- `bdg dom styles <selector> [--raw]` -> computed styles as object or raw CDP
- `bdg dom matched-rules <selector> [--raw]` -> cascade rules (parsed via @devtoolcss/parser)
- `bdg dom pseudo <selector> --states <list>` -> force pseudo-classes
- `bdg dom highlight <selector>` -> visual overlay highlight
- `bdg dom query <selector> --json` -> return element handles (nodeId, xpath/css, timestamp)
- `bdg dom call <handle|selector> --fn 'function(){...}'` -> Runtime.callFunctionOn

---

## Risks & Mitigations
- Memory pressure on large pages: make mirror opt-in (`--cache`), expose `bdg status` memory stats.
- Sync correctness (races with rapid mutations): batch updates, debounce rebuilds, validate before operations (tracked).
- Frames and shadow DOM: start with main document; add per-frame mirrors; document limitations.
- CSP / sandbox edges: prefer CDP commands over injected scripts; handle exceptions from callFunctionOn with clear mapping to CLI errors.
- Protocol drift: keep devtools-protocol updated; optional raw mode for future-proofing.

---

## Milestones & Success Criteria

M1: Style APIs (1–2 weeks)
- Implement computed styles + matched rules (raw + parsed)
- CLI commands land with docs and tests
- Success: run on 3 real sites; outputs match DevTools

M2: callFunctionOn Actions (1 week)
- click/scrollIntoView/eval-on-selector using objectId
- Error messages upgraded with exception details
- Success: flaky selector-based actions reduced by >50%

M3: Pseudo-State + Highlight (0.5 week)
- hover/focus/active + Overlay highlight
- Success: visual debugging flows reproducible from CLI

M4: Optional DOM Mirror (2–3 weeks)
- Cache mode with event-driven sync; tracked handles
- Success: 3× speedup on query-heavy scripts; stable handle reuse across mutations

M5: Frames/Shadow DOM (stretch)
- Incremental support; clear docs on limitations

---

## Open Questions
- Should mirror be persisted between CLI invocations or only within daemon lifespan?
- What telemetry should we expose to help users trust the mirror (sync lag, missed events, memory)?
- Where to store element handles (per-session registry vs. pass-by-value JSON)?

---

## References
- chrome-inspector source: Inspector.ts, InspectorDOM.ts, NodeInspector.ts, highlightConfig.ts, types.ts
- CDP domains used: DOM, CSS, Runtime, Overlay, Accessibility (for a11y tree)
- Parsing: @devtoolcss/parser (for matched styles)
