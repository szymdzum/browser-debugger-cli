# Agent Form Automation: Node IDs, Accessibility & Navigation

Date: 2025-11-22
Status: Reference Guide

## Executive Summary

This document consolidates strategies for **agent-driven form automation** with bdg, covering:
1. **Node ID Management** - Stable element references across navigation
2. **Accessibility-First Targeting** - Using a11y tree for robust element selection
3. **React/Framework Compatibility** - Synthetic event handling
4. **Form Filling Patterns** - Complete workflows with error handling

---

## The Agent Form Automation Problem

When LLMs automate web forms, they face challenges traditional test frameworks avoid:

**Challenge 1: Element Selection**
- CSS selectors break when DOM changes
- XPath is brittle to layout shifts
- Dynamic IDs (`input_12345678`) are unpredictable

**Challenge 2: Framework Event Systems**
- React/Vue don't detect direct value assignment
- Need to dispatch synthetic events properly

**Challenge 3: Navigation & Staleness**
- nodeId becomes invalid after navigation
- No clear signal when element reference is stale
- Multi-step forms require re-querying

**Challenge 4: Error Recovery**
- Form validation triggers dynamic error messages
- Submit buttons may become disabled
- Need to detect and report failures to agent

---

## bdg's Current Solutions

### 1. Node ID Management

**What bdg provides:**

```typescript
// src/commands/dom/helpers.ts
export async function queryDOMElements(selector: string): Promise<DomQueryResult> {
  const doc = await callCDP('DOM.getDocument', {});
  const queryResult = await callCDP('DOM.querySelectorAll', {
    nodeId: doc.root.nodeId,
    selector,
  });
  
  return {
    selector,
    count: queryResult.nodeIds.length,
    nodes: queryResult.nodeIds.map((nodeId, index) => ({
      index,
      nodeId,
      tag, classes, preview  // Enriched metadata
    }))
  };
}
```

**Key insight:** nodeId is stable within a document lifecycle but invalidated on:
- Navigation (page reload, SPA route change)
- `documentUpdated` CDP event
- Element removal from DOM

**Usage pattern:**
```bash
# Query returns nodeIds
bdg dom query "input[name='email']" --json
# { "nodes": [{ "nodeId": 42, "tag": "input", ... }] }

# Use nodeId for subsequent operations (same page load only)
bdg dom fill --node-id 42 "test@example.com"
```

---

### 2. Accessibility-First Element Targeting

**Why accessibility tree:**
- **Stable:** Role + accessible name change less often than CSS structure
- **Semantic:** Describes element purpose, not implementation
- **Agent-friendly:** "Click the Submit button" → `role:button, name:Submit`

**What bdg provides:**

```typescript
// src/telemetry/a11y.ts
export async function collectA11yTree(): Promise<A11yTree> {
  await callCDP('Accessibility.enable', {});
  const response = await callCDP('Accessibility.getFullAXTree', {});
  
  return buildTreeFromRawNodes(response.nodes);
}

export function queryA11yTree(tree: A11yTree, pattern: A11yQueryPattern) {
  // Matches by role, name, description (case-insensitive)
}
```

**A11y Node Structure:**
```typescript
interface A11yNode {
  nodeId: string;           // CDP nodeId
  role: string;             // 'button', 'textbox', 'combobox', etc.
  name?: string;            // Accessible name (label, aria-label, text)
  description?: string;     // aria-describedby
  value?: string;           // Current value for inputs
  focusable?: boolean;
  focused?: boolean;
  disabled?: boolean;
  required?: boolean;
  backendDOMNodeId?: number;  // Maps to DOM nodeId
}
```

**Usage pattern:**
```bash
# Query by role + name (semantic, not CSS)
bdg dom a11y query role=textbox name="Email"
# Returns: { nodeId: "42", role: "textbox", name: "Email Address", focusable: true }

# Map a11y nodeId → DOM nodeId → fill
bdg dom fill --a11y-node-id 42 "test@example.com"
```

**Advantages for agents:**
- Natural language → a11y pattern mapping
- "Fill the email field" → `{role: "textbox", name: /email/i}`
- Less sensitive to CSS refactors

---

### 3. React-Compatible Form Filling

**The React problem:**
```javascript
// ❌ This doesn't work in React apps
document.querySelector('input[name="email"]').value = 'test@example.com';
// React doesn't see the change, form validation doesn't trigger
```

**bdg's solution:** Dispatch synthetic events that React listens for.

```typescript
// src/commands/dom/reactEventHelpers.ts
export const REACT_FILL_SCRIPT = `
(function(selector, value, options) {
  const el = document.querySelector(selector);
  
  // 1. Use native property setter (bypasses React tracking)
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  nativeSetter.call(el, value);
  
  // 2. Dispatch events React listens for
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  
  // 3. Trigger focus/blur for validation
  el.focus();
  el.blur();
  
  return { success: true, value: el.value };
})
`;
```

**What it handles:**
- ✅ React 16+, 17, 18
- ✅ Vue 2, 3
- ✅ Angular
- ✅ Vanilla JS
- ✅ Input types: text, email, password, number, tel
- ✅ Textarea
- ✅ Select dropdowns
- ✅ Checkboxes, radio buttons
- ✅ ContentEditable divs
- ❌ File inputs (requires `DOM.setFileInputFiles`)

**Usage:**
```bash
# Fill with React event dispatch
bdg dom fill "input[name='email']" "test@example.com"

# Multiple matches → use index
bdg dom fill "input[type='text']" "value" --index 2

# Checkbox/radio
bdg dom fill "input[name='subscribe']" "true"
```

---

### 4. Click Element with Visibility Detection

**The visibility problem:**
```html
<!-- Multiple buttons, only one visible -->
<button class="submit" style="display:none">Submit</button>
<button class="submit">Submit</button>  <!-- This one! -->
```

**bdg's solution:** Prioritize visible elements.

```typescript
// src/commands/dom/reactEventHelpers.ts
export const CLICK_ELEMENT_SCRIPT = `
(function(selector, index) {
  const allMatches = document.querySelectorAll(selector);
  
  if (!index && allMatches.length > 1) {
    // Find first visible element
    for (const candidate of allMatches) {
      const style = window.getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      
      const isVisible = (
        rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        parseFloat(style.opacity) > 0
      );
      
      if (isVisible) {
        el = candidate;
        break;
      }
    }
  }
  
  el.click();
  return { success: true, elementType: el.tagName };
})
`;
```

**Usage:**
```bash
# Clicks first visible match
bdg dom click "button.submit"

# Explicit index if needed
bdg dom click "button" --index 3
```

---

### 5. Key Press Support

**For special interactions:**

```bash
# Press Enter to submit (common pattern)
bdg dom press-key "input.search" "Enter"

# Tab navigation
bdg dom press-key "input" "Tab" --times 3

# Modifiers
bdg dom press-key "input" "a" --modifiers ctrl  # Ctrl+A (select all)
bdg dom press-key "input" "v" --modifiers ctrl  # Ctrl+V (paste)
```

**Supported keys:**
- Enter, Tab, Escape, Space
- Backspace, Delete
- ArrowUp/Down/Left/Right
- Home, End, PageUp, PageDown
- F1-F12
- a-z, 0-9
- Modifiers: shift, ctrl, alt, meta

---

### 6. Post-Action Stability Waiting

**The problem:** Form submissions trigger:
- AJAX requests
- React state updates
- DOM re-renders
- Redirects

**bdg's solution:** Lightweight stability check.

```typescript
// src/commands/dom/formFillHelpers.ts
export async function waitForActionStability(cdp: CDPConnection) {
  // Wait for network to be idle for 150ms
  // Timeout after 2s to avoid hanging
  
  while (Date.now() < deadline) {
    if (activeRequests === 0 && idleTime >= 150) {
      return;  // Stable!
    }
    await delay(50);
  }
}
```

**Usage in automation:**
```bash
# Fill + wait automatically
bdg dom fill "input[name='email']" "test@example.com" --wait

# Click + wait for navigation
bdg dom click "button[type='submit']" --wait
```

---

## Patterns for Agents

### Pattern 1: Semantic Query → Fill

**Agent prompt:**
> "Fill the email field with test@example.com"

**Workflow:**
```bash
# Step 1: Find element by semantics (a11y tree)
bdg dom a11y query role=textbox name="Email" --json
# Returns: { backendDOMNodeId: 42 }

# Step 2: Fill using DOM nodeId
bdg dom fill --node-id 42 "test@example.com"

# Step 3: Verify (read back value)
bdg dom get --node-id 42 --json | jq '.value'
```

**Why this works:**
- Role + name is stable across refactors
- Less prone to CSS class changes
- Mirrors how screen readers navigate

---

### Pattern 2: Multi-Step Form with Navigation

**Challenge:** nodeIds invalidate on page change.

**Solution:** Re-query after each navigation.

```bash
# Page 1: Personal info
bdg dom fill "input[name='name']" "John Doe"
bdg dom fill "input[name='email']" "john@example.com"
bdg dom click "button.next" --wait

# Page 2: Payment (NEW DOM, re-query)
bdg dom fill "input[name='card']" "4111111111111111"
bdg dom fill "input[name='cvv']" "123"
bdg dom click "button.submit" --wait

# Page 3: Confirmation (check for success)
bdg dom query ".success-message"
```

**Key insight:** Never reuse nodeIds across navigation. Always re-query.

---

### Pattern 3: Error Detection & Recovery

**Challenge:** Form validation failures need to be reported to agent.

**Workflow:**
```bash
# Attempt fill
bdg dom fill "input[name='email']" "invalid-email"

# Check for validation errors
bdg dom query ".error-message" --json
# If found: { count: 1, nodes: [{ preview: "Please enter a valid email" }] }

# Report to agent → retry with valid input
bdg dom fill "input[name='email']" "valid@example.com"

# Verify error cleared
bdg dom query ".error-message" --json
# { count: 0 }
```

---

### Pattern 4: Dynamic Forms (Conditional Fields)

**Challenge:** Fields appear/disappear based on selections.

```bash
# Initial state
bdg dom a11y query role=combobox name="Country" --json

# Select "United States"
bdg dom fill --node-id 42 "United States"
bdg sleep 0.5  # Wait for conditional fields

# New field appears: State dropdown
bdg dom a11y query role=combobox name="State" --json
bdg dom fill --node-id 43 "California"
```

**Key insight:** Use short delays (`sleep 0.5s`) after selections that trigger DOM changes, then re-query.

---

## What's Missing (Opportunities from devtools-frontend)

### 1. Element Staleness Detection

**Problem:** bdg doesn't explicitly track when nodeIds become invalid.

**From devtools-frontend DOMModel:**
```typescript
// core/sdk/DOMModel.ts
class DOMNode {
  get isInDocument(): boolean {
    // Tracks DOM mutations, knows when node is removed
  }
}
```

**For bdg:**
- Add `bdg dom validate --node-id 42` command
- Returns: `{ valid: true/false, reason: "removed|navigated" }`
- Agents can check before operations

---

### 2. DOM Snapshot Diffing

**Problem:** Hard to detect what changed after an action.

**From devtools-frontend:**
- Maintains DOM mirror
- Compares snapshots before/after actions
- Reports: "3 nodes added, 1 removed"

**For bdg:**
```bash
# Take snapshot
bdg dom snapshot save snapshot1.json

# Perform action
bdg dom click "button.load-more"

# Compare
bdg dom snapshot compare snapshot1.json
# Output: "+5 .product-card nodes, +1 .pagination-next"
```

---

### 3. Network Request Correlation

**Problem:** Can't tell which action triggered which request.

**From devtools-frontend NetworkManager:**
- Correlates user actions → network requests
- "Click on button.submit caused POST /api/submit"

**For bdg:**
```bash
# Start recording action context
bdg network record-action "submit form"

# Perform action
bdg dom click "button[type='submit']"

# Stop recording
bdg network show-action-requests
# Output: 
#   POST /api/submit (200 OK)
#   GET /success-page (302 redirect)
```

---

### 4. Form Autofill Integration

**From devtools-frontend Autofill Panel:**
- Detects form fields by autocomplete attribute
- Groups related fields (address, payment, contact)
- Can populate entire form in one step

**For bdg:**
```bash
# Detect autofill groups
bdg dom analyze-form --json
# Output:
# {
#   "contact": ["name", "email", "phone"],
#   "address": ["street", "city", "zip", "country"],
#   "payment": ["cardNumber", "cvv", "expiry"]
# }

# Fill entire group
bdg dom autofill contact --data contact.json
```

---

## Best Practices for Agent Prompts

### 1. Always Query Before Operating

❌ **Bad:**
```
Agent: Fill input with class "email-field"
```

✅ **Good:**
```
Agent: 
1. Query for textbox with name "Email"
2. If found, fill with provided value
3. Verify value was set
4. Report success or error details
```

---

### 2. Use Accessibility Semantics

❌ **Bad:**
```
Click the element with class "btn btn-primary submit-button"
```

✅ **Good:**
```
Click the button with accessible name "Submit"
```

**Why:** CSS classes change, accessible names don't (without breaking a11y).

---

### 3. Handle Multiple Matches Explicitly

❌ **Bad:**
```
Fill input[type='text'] with "value"
```

✅ **Good:**
```
Query all input[type='text']
If count > 1:
  - Prioritize by label match
  - Or ask user which one
  - Or use --index flag
```

---

### 4. Validate After Critical Actions

```bash
# Fill email
bdg dom fill "input[name='email']" "test@example.com"

# Validate (read back)
VALUE=$(bdg dom eval "document.querySelector('input[name=\"email\"]').value")
if [ "$VALUE" != "test@example.com" ]; then
  echo "Fill failed! Actual value: $VALUE"
  exit 1
fi
```

---

## Complete Agent Workflow Example

**Task:** "Fill out contact form and submit"

```bash
#!/bin/bash
set -e  # Exit on error

# Start session
bdg https://example.com/contact

# === Step 1: Query form fields ===
FIELDS=$(bdg dom a11y query role=textbox --json)
echo "Found $(echo $FIELDS | jq '.count') form fields"

# === Step 2: Fill each field ===
# Name
NAME_NODE=$(echo $FIELDS | jq -r '.nodes[] | select(.name | contains("Name")) | .backendDOMNodeId')
bdg dom fill --node-id $NAME_NODE "John Doe"

# Email
EMAIL_NODE=$(echo $FIELDS | jq -r '.nodes[] | select(.name | contains("Email")) | .backendDOMNodeId')
bdg dom fill --node-id $EMAIL_NODE "john@example.com"

# Message (textarea)
MSG=$(bdg dom a11y query role=textbox name="Message" --json)
MSG_NODE=$(echo $MSG | jq -r '.nodes[0].backendDOMNodeId')
bdg dom fill --node-id $MSG_NODE "Hello from automation"

# === Step 3: Check for validation errors ===
ERRORS=$(bdg dom query ".error-message" --json | jq '.count')
if [ "$ERRORS" -gt 0 ]; then
  echo "Validation errors detected!"
  bdg dom query ".error-message"
  exit 1
fi

# === Step 4: Submit ===
SUBMIT=$(bdg dom a11y query role=button name="Submit" --json)
SUBMIT_NODE=$(echo $SUBMIT | jq -r '.nodes[0].backendDOMNodeId')
bdg dom click --node-id $SUBMIT_NODE --wait

# === Step 5: Verify success ===
SUCCESS=$(bdg dom query ".success-message" --json | jq '.count')
if [ "$SUCCESS" -eq 0 ]; then
  echo "Submission failed - no success message"
  exit 1
fi

echo "✅ Form submitted successfully!"
bdg stop
```

---

## Chrome-Inspector Integration Benefits

If bdg adopts chrome-inspector's DOM mirror:

**1. Automatic Staleness Detection**
```typescript
const element = inspector.querySelector('input[name="email"]');
console.log(element.tracked);  // false if removed/navigated
```

**2. Persistent Element Handles**
```typescript
// Query once
const submitBtn = inspector.querySelector('button[type="submit"]');

// Use multiple times (if still tracked)
await submitBtn.scrollIntoView();
await submitBtn.click();
console.log(submitBtn.outerHTML);  // Works because mirror is local
```

**3. Style-Based Visibility Check**
```typescript
const computed = await element.getComputedStyle();
const isVisible = (
  computed['display'] !== 'none' &&
  computed['visibility'] !== 'hidden' &&
  parseFloat(computed['opacity']) > 0
);
```

---

## Recommendations

### Immediate (Implement Now)

1. **Add `--a11y` flag to fill/click commands**
   ```bash
   bdg dom fill --a11y "role=textbox,name=Email" "test@example.com"
   ```

2. **Document node ID lifecycle clearly**
   - Add to CLI help: "⚠️  nodeId invalid after navigation"
   - Show warning when reusing stale nodeId

3. **Expose form autofill detection**
   ```bash
   bdg dom detect-form --json
   ```

### Short-Term (Next Quarter)

4. **Add element validation command**
   ```bash
   bdg dom validate --node-id 42
   # { valid: false, reason: "Element removed from DOM" }
   ```

5. **Network action correlation**
   ```bash
   bdg trace-action "bdg dom click button.submit"
   # Shows requests triggered by action
   ```

6. **DOM snapshot diffing**
   ```bash
   bdg dom diff snapshot1.json snapshot2.json
   ```

### Long-Term (With chrome-inspector)

7. **DOM mirroring for staleness tracking**
8. **Persistent element handles**
9. **XPath generation from accessible name**

---

## DevTools-Frontend Insights

### Node Tracking Architecture (from DOMModel.ts)

**How DevTools handles node staleness:**

<cite index="12-4,12-5,12-6">CDP states: "It is important that client receives DOM events only for the nodes that are known to the client. Backend keeps track of the nodes that were sent to the client and never sends the same node twice. It is client's responsibility to collect information about the nodes that were sent to the client."</cite>

**Key implementation patterns from devtools-frontend:**

1. **Event-Driven Validity Tracking**
   ```typescript
   // devtools-frontend/core/sdk/DOMModel.ts pattern
   class DOMNode {
     private _valid: boolean = true;
     
     markRemoved(): void {
       this._valid = false;
       // Recursively invalidate children
     }
     
     isInDocument(): boolean {
       return this._valid && this._parent?.isInDocument();
     }
   }
   ```

2. **DOM Mutation Subscription**
   - Subscribe to: `DOM.childNodeRemoved`, `DOM.documentUpdated`
   - On `childNodeRemoved`: Mark node + descendants as invalid
   - On `documentUpdated`: Clear entire node map, rebuild from scratch

3. **Detached Node Detection**
   <cite index="13-1,13-2">Detached DOM nodes "are still held in memory but are not shown in the DOM tree of your page, because some JavaScript code still references them somewhere."</cite>

**For bdg:**
```typescript
// Proposed: src/cache/NodeRegistry.ts
export class NodeRegistry {
  private nodes = new Map<number, { valid: boolean; lastSeen: number }>();
  
  constructor(cdp: CDPConnection) {
    cdp.on('DOM.childNodeRemoved', ({ nodeId }) => {
      this.markInvalid(nodeId);
    });
    
    cdp.on('DOM.documentUpdated', () => {
      this.nodes.clear();
    });
  }
  
  validate(nodeId: number): { valid: boolean; reason?: string } {
    const node = this.nodes.get(nodeId);
    if (!node) return { valid: false, reason: 'unknown' };
    if (!node.valid) return { valid: false, reason: 'removed' };
    if (Date.now() - node.lastSeen > 30000) {
      return { valid: false, reason: 'stale' };
    }
    return { valid: true };
  }
}
```

---

### Form Autofill Detection (from DevTools Autofill Panel)

<cite index="26-12,26-13">DevTools is building features to help developers understand "How does browser Autofill map stored values to form fields? What criteria are used by Autofill to fill a form field?"</cite>

**Autofill field detection:**
<cite index="26-33,26-34,26-35,26-36">DevTools identifies form issues including "Input fields without an id or name attribute, Elements with duplicate IDs, A <label> with a for attribute that doesn't match an element ID, A field with an empty autocomplete attribute."</cite>

**For bdg:**
```bash
# Proposed command
bdg dom analyze-form --json
```

**Implementation:**
```typescript
// src/commands/dom/formAnalysis.ts
export async function analyzeForm(cdp: CDPConnection) {
  const inputs = await queryElements(cdp, 'input, textarea, select');
  const groups: Record<string, FormField[]> = {
    contact: [],
    address: [],
    payment: [],
    unknown: []
  };
  
  for (const input of inputs) {
    const autocomplete = input.attributes['autocomplete'];
    const name = input.attributes['name'];
    
    // Group by autocomplete hint
    if (autocomplete?.includes('email') || name?.includes('email')) {
      groups.contact.push(input);
    } else if (autocomplete?.includes('address') || name?.includes('address')) {
      groups.address.push(input);
    } else if (autocomplete?.includes('cc-') || name?.includes('card')) {
      groups.payment.push(input);
    } else {
      groups.unknown.push(input);
    }
  }
  
  return groups;
}
```

---

### Event Listener Inspection

<cite index="23-5,23-6">DevTools "Lists all event listeners and their attributes. Lets you find the source of event listeners and filter for passive or blocking listeners."</cite>

**Use case for form automation:**
- Detect if form has validation listeners
- Identify submit button event handlers
- Find dynamic form behavior (conditional fields)

**For bdg:**
```bash
# Proposed command
bdg dom listeners "form" --json
# Output: { "submit": 2, "input": 15, "change": 8 }

bdg dom listeners "button[type='submit']" --json
# Output: { "click": 1, "mousedown": 1 }
```

**Implementation:**
```typescript
// Use CDP DOMDebugger domain
export async function getEventListeners(
  cdp: CDPConnection,
  nodeId: number
): Promise<EventListener[]> {
  await cdp.send('DOMDebugger.enable');
  
  const { objectId } = await cdp.send('DOM.resolveNode', { nodeId });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {
    objectId
  });
  
  return listeners.map(l => ({
    type: l.type,
    useCapture: l.useCapture,
    passive: l.passive,
    once: l.once,
    handler: l.handler
  }));
}
```

---

### DOM Breakpoints for Change Detection

<cite index="23-7">DevTools "Lists DOM change breakpoints added from the Elements panel and lets you enable, disable, remove, or reveal them."</cite>

**Breakpoint types:**
- Subtree modifications
- Attribute modifications
- Node removal

**For bdg automation:**
```bash
# Watch for form validation errors appearing
bdg dom watch-subtree ".form-errors" --timeout 2s
# Triggers when child nodes added (error messages)

# Watch for disabled state changes
bdg dom watch-attribute "button[type='submit']" disabled
# Triggers when submit button becomes enabled/disabled
```

**Implementation:**
```typescript
export async function watchSubtree(
  cdp: CDPConnection,
  nodeId: number,
  timeout: number
): Promise<{ changed: boolean; mutations: Mutation[] }> {
  const mutations: Mutation[] = [];
  
  const cleanup = cdp.on('DOM.childNodeInserted', (params) => {
    if (params.parentNodeId === nodeId) {
      mutations.push({ type: 'inserted', node: params.node });
    }
  });
  
  await delay(timeout);
  cleanup();
  
  return { changed: mutations.length > 0, mutations };
}
```

---

## Recommendations for bdg (Updated)

### Critical (Based on DevTools Patterns)

1. **Node Validity Tracking** (High Priority)
   - Implement `NodeRegistry` with event-driven invalidation
   - Add `bdg dom validate --node-id <id>` command
   - Warn users when attempting to use stale nodeIds

2. **Form Autofill Analysis** (Medium Priority)
   - Add `bdg dom analyze-form` to detect field groups
   - Identify missing `autocomplete` attributes
   - Detect label mismatches (accessibility + autofill)

3. **Event Listener Inspection** (Low Priority)
   - Add `bdg dom listeners <selector>` command
   - Help agents understand form behavior
   - Detect validation patterns

4. **DOM Change Watching** (Medium Priority)
   - Add `bdg dom watch-subtree` for dynamic content
   - Useful for detecting validation errors
   - Track when submit buttons become enabled

---

## References

- [Web Accessibility Standards (ARIA)](https://www.w3.org/WAI/standards-guidelines/aria/)
- [React Synthetic Events](https://react.dev/reference/react-dom/components/input#controlling-an-input-with-a-state-variable)
- [CDP DOM Domain](https://chromedevtools.github.io/devtools-protocol/tot/DOM/)
- [CDP Accessibility Domain](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/)
- [CDP DOMDebugger Domain](https://chromedevtools.github.io/devtools-protocol/tot/DOMDebugger/)
- [DevTools Autofill Panel](https://developer.chrome.com/blog/devtools-autofill)
- [Memory Leaks and Detached Nodes](https://learn.microsoft.com/en-us/microsoft-edge/devtools-guide-chromium/memory-problems/dom-leaks)
