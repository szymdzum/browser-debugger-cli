# React/SPA Form Interaction Implementation Plan

**Goal**: Provide high-level form interaction commands that work with React, Vue, Angular, and vanilla JS applications.

**Key Insight**: Use CDP's native input methods where possible, fall back to `Runtime.evaluate` for React-specific event handling.

---

## Available CDP Methods

### Input Domain (Low-level input simulation)
- `Input.dispatchKeyEvent` - Dispatch keyboard events
- `Input.dispatchMouseEvent` - Dispatch mouse events (for clicks)
- `Input.insertText` - Insert text (emoji/IME, experimental)

### DOM Domain (Element manipulation)
- `DOM.focus` - Focus elements
- `DOM.setFileInputFiles` - Set file input values
- `DOM.getNodeForLocation` - Find element at coordinates

### Runtime Domain (JavaScript execution)
- `Runtime.evaluate` - Execute JavaScript (our Swiss Army knife)
  - `userGesture: true` - Treat as user-initiated
  - `awaitPromise: true` - Wait for async operations

---

## Implementation Strategy

### Two-Tier Approach

**Tier 1: CDP Native Methods** (when possible)
- Use `Input.dispatchKeyEvent` for keyboard input
- Use `Input.dispatchMouseEvent` for clicks
- Faster, more realistic, browser-native

**Tier 2: Runtime.evaluate** (for React compatibility)
- Use native setters to bypass React's synthetic value
- Dispatch React-compatible events (input, change, focus, blur)
- Required for SPAs to trigger re-renders

**Hybrid Approach** (recommended):
1. Get element coordinates with `DOM` methods
2. Use `Input.dispatch*` for realistic timing/physics
3. Use `Runtime.evaluate` to trigger React events

---

## Command Design

### 1. `bdg dom fill <selector> <value> [options]`

**Purpose**: Fill a form field with a value (React-compatible)

**Signature**:
```bash
bdg dom fill <selector> <value>
  [--index <n>]           # If selector matches multiple, use nth element
  [--delay <ms>]          # Delay between characters (default: 0)
  [--blur]                # Blur after filling (default: true)
  [--wait-stable <ms>]    # Wait for DOM stability after fill (default: 100ms)
  [--json]                # JSON output
```

**Examples**:
```bash
# Basic usage
bdg dom fill "input[name='email']" "test@example.com"

# Multiple matches - use index
bdg dom fill "input[type='text']" "value" --index 2

# Slow typing for autocomplete
bdg dom fill "input[name='search']" "laptop" --delay 100

# Don't blur after filling
bdg dom fill "input[name='password']" "secret" --no-blur
```

**CDP Implementation**:
```javascript
// Via Runtime.evaluate with userGesture: true
const fillElement = (selector, value, options) => {
  const el = document.querySelector(selector);
  if (!el) return { success: false, error: 'Element not found' };
  
  // Focus element
  el.focus();
  
  // Use native setter (React compatibility)
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set;
  nativeInputValueSetter.call(el, value);
  
  // Dispatch events that React listens for
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  
  if (options.blur) {
    el.blur();
  }
  
  return { success: true, value: el.value };
};
```

**Input Types Supported**:
- Text inputs (`<input type="text|email|password|tel|url|search">`)
- Textareas (`<textarea>`)
- Number inputs (`<input type="number">`)
- Select dropdowns (`<select>`)
- Checkboxes (`<input type="checkbox">`) - value should be "true"/"false"
- Radio buttons (`<input type="radio">`)

**Output Format**:
```json
{
  "success": true,
  "selector": "input[name='email']",
  "value": "test@example.com",
  "elementType": "input",
  "inputType": "email"
}
```

**Error Handling**:
- Element not found → Exit 83 (RESOURCE_NOT_FOUND)
- Element not fillable → Exit 81 (INVALID_ARGUMENTS)
- Timeout waiting for stability → Exit 102 (CDP_TIMEOUT)

---

### 2. `bdg dom type <selector> <text> [options]`

**Purpose**: Type text character-by-character with realistic delays (for autocomplete/typeahead)

**Signature**:
```bash
bdg dom type <selector> <text>
  [--index <n>]           # If selector matches multiple
  [--delay <ms>]          # Delay between keystrokes (default: 100ms)
  [--wait-stable <ms>]    # Wait for stability after typing
  [--json]
```

**Examples**:
```bash
# Type with default 100ms delay
bdg dom type "input[name='search']" "laptop"

# Faster typing
bdg dom type "input.autocomplete" "New York" --delay 50

# Very slow (human-like)
bdg dom type "textarea" "Hello World" --delay 200
```

**CDP Implementation**:
Use `Input.dispatchKeyEvent` for each character:
```javascript
// For each character in text:
await cdp.send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  text: char,
  key: char,
  code: getKeyCode(char)
});

await cdp.send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  text: char,
  key: char,
  code: getKeyCode(char)
});

await sleep(delay);
```

**Why separate from `fill`?**
- `fill` is instant (sets value directly) - faster, good for most cases
- `type` simulates keystokes - slower, triggers autocomplete/validation on each keystroke

**Use Cases**:
- Autocomplete fields that suggest as you type
- Real-time validation that triggers per-character
- Typeahead search boxes
- Testing debounced input handlers

---

### 3. `bdg dom submit <selector> [options]`

**Purpose**: Submit a form and wait for the response

**Signature**:
```bash
bdg dom submit <selector>
  [--index <n>]           # If selector matches multiple buttons
  [--wait-navigation]     # Wait for page navigation (default: false)
  [--wait-network <ms>]   # Wait for network idle (default: 1000ms)
  [--timeout <s>]         # Max wait time (default: 10s)
  [--json]
```

**Examples**:
```bash
# Submit form and wait for network idle
bdg dom submit "button[type='submit']"

# Submit and wait for navigation
bdg dom submit "form button" --wait-navigation

# Quick submit without waiting
bdg dom submit "button.submit-btn" --wait-network 0
```

**CDP Implementation**:
```javascript
// 1. Click the submit button
await clickElement(selector);

// 2. Wait for network activity
const waitForNetworkIdle = () => {
  return new Promise((resolve) => {
    let activeRequests = 0;
    let idleTimeout;
    
    cdp.on('Network.requestWillBeSent', () => {
      activeRequests++;
      clearTimeout(idleTimeout);
    });
    
    cdp.on('Network.loadingFinished', () => {
      activeRequests--;
      if (activeRequests === 0) {
        idleTimeout = setTimeout(resolve, waitNetworkMs);
      }
    });
  });
};

// 3. Optionally wait for navigation
if (waitNavigation) {
  await cdp.send('Page.waitForNavigat ion');
}
```

**What it waits for**:
1. Button click completes
2. Network requests triggered by submission
3. Network idle (no requests for N ms)
4. Optional: Page navigation/reload

**Output Format**:
```json
{
  "success": true,
  "selector": "button[type='submit']",
  "clicked": true,
  "networkRequests": 3,
  "navigationOccurred": false,
  "waitTimeMs": 450
}
```

---

### 4. `bdg dom click <selector> [options]`

**Purpose**: Click an element (useful for buttons, links, custom components)

**Signature**:
```bash
bdg dom click <selector>
  [--index <n>]           # If selector matches multiple
  [--wait-navigation]     # Wait for navigation after click
  [--json]
```

**Examples**:
```bash
# Simple click
bdg dom click "button.save-btn"

# Click and wait for navigation
bdg dom click "a[href='/dashboard']" --wait-navigation

# Click nth element
bdg dom click "button.item-delete" --index 3
```

**CDP Implementation**:
Option A: Use `Input.dispatchMouseEvent` with element coordinates
```javascript
// 1. Get element bounding box
const { x, y, width, height } = await getElementRect(selector);
const centerX = x + width / 2;
const centerY = y + height / 2;

// 2. Dispatch mouse events
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: centerX,
  y: centerY,
  button: 'left',
  clickCount: 1
});

await cdp.send('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: centerX,
  y: centerY,
  button: 'left',
  clickCount: 1
});
```

Option B: Use `Runtime.evaluate` (simpler, works in more cases)
```javascript
const clickElement = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return { success: false };
  el.click();
  return { success: true };
};
```

**Recommendation**: Use Option B (Runtime.evaluate) for simplicity. Option A is more realistic but requires coordinate calculation.

---

## Real-World Use Cases

### Use Case 1: Login Form
```bash
# Start session
bdg https://app.example.com/login --headless

# Fill login form
bdg dom fill "input[name='email']" "user@example.com"
bdg dom fill "input[name='password']" "secret123"
bdg dom submit "button[type='submit']" --wait-network 2000

# Verify login succeeded
bdg peek --network --last 5 | grep "200.*login"

# Stop session
bdg stop
```

### Use Case 2: Multi-Step Form Wizard
```bash
bdg https://app.example.com/signup --headless

# Step 1: Personal info
bdg dom fill "input[name='firstName']" "John"
bdg dom fill "input[name='lastName']" "Doe"
bdg dom click "button.next-step"
sleep 1

# Step 2: Contact info
bdg dom fill "input[name='email']" "john@example.com"
bdg dom fill "input[name='phone']" "555-1234"
bdg dom click "button.next-step"
sleep 1

# Step 3: Submit
bdg dom click "button[type='submit']" --wait-network 3000

bdg stop
```

### Use Case 3: Autocomplete/Typeahead
```bash
bdg https://app.example.com --headless

# Type slowly to trigger autocomplete
bdg dom type "input.search" "New Y" --delay 150
sleep 500

# Check if suggestions appeared
bdg dom query ".autocomplete-item"

# Select first suggestion
bdg dom click ".autocomplete-item" --index 1

bdg stop
```

### Use Case 4: File Upload
```bash
bdg https://app.example.com/upload --headless

# Set file input (CDP native method)
bdg cdp DOM.setFileInputFiles --params '{
  "files": ["/path/to/file.pdf"],
  "nodeId": 123
}'

# Or use helper if we add it
bdg dom upload "input[type='file']" "/path/to/file.pdf"

bdg dom submit "button.upload-btn"
bdg stop
```

---

## Integration with Existing Commands

### Works with `bdg dom query`
```bash
# Find elements first
bdg dom query "input[type='text']"
# Output: [1] <input name="firstName"> [2] <input name="lastName">

# Fill by index
bdg dom fill "input[type='text']" "John" --index 1
bdg dom fill "input[type='text']" "Doe" --index 2
```

### Works with `bdg peek`
```bash
# Submit form
bdg dom submit "form button"

# Check network requests triggered
bdg peek --network --last 10
```

### Works with `bdg dom eval` (fallback)
```bash
# For complex cases, use eval as escape hatch
bdg dom eval 'document.querySelector("input").value = "test"'
```

---

## Testing Strategy

### Test Matrix

| Framework | Test Case | Command | Expected Result |
|-----------|-----------|---------|-----------------|
| React 18 | Text input | `fill "input" "test"` | Value set, onChange fires |
| React 18 | Checkbox | `fill "input[type=checkbox]" "true"` | Checked, onChange fires |
| React 18 | Select | `fill "select" "option2"` | Selected, onChange fires |
| Vue 3 | Text input | `fill "input" "test"` | v-model updates |
| Angular | Text input | `fill "input" "test"` | ngModel updates |
| Vanilla JS | Text input | `fill "input" "test"` | Value set |
| React | Autocomplete | `type "input" "test" --delay 100` | Suggestions appear |
| All | Form submit | `submit "button"` | Network request sent |

### Test Scenarios

**Scenario 1: React StrictMode**
- React may mount/unmount components twice
- Ensure events fire correctly even with StrictMode

**Scenario 2: Controlled vs Uncontrolled**
- Controlled: value prop + onChange handler
- Uncontrolled: defaultValue prop
- Both should work

**Scenario 3: Custom Input Components**
```jsx
<CustomInput onChange={handler} />
```
- May not be actual `<input>` element
- Need to handle contenteditable, custom elements

**Scenario 4: Validation**
- Fill invalid email → check for error message
- Fill valid email → error should clear

---

## Implementation Roadmap

### Phase 1: Basic Fill (Week 1)
**Scope**: Text inputs only, no delays
- ✅ `bdg dom fill <selector> <value>`
- ✅ Support input[type=text/email/password/tel/url]
- ✅ Support textarea
- ✅ React compatibility (native setter + events)
- ✅ JSON output
- ✅ Exit codes

**Deliverable**: Can fill basic login forms

**Estimated Effort**: 3-4 days

---

### Phase 2: Click & Submit (Week 1-2)
**Scope**: Clicking and form submission
- ✅ `bdg dom click <selector>`
- ✅ `bdg dom submit <selector>`
- ✅ Wait for network idle
- ✅ Optional navigation waiting

**Deliverable**: Complete login/signup flows

**Estimated Effort**: 2-3 days

---

### Phase 3: Type with Delays (Week 2)
**Scope**: Character-by-character typing
- ✅ `bdg dom type <selector> <text>`
- ✅ Configurable delays
- ✅ Use `Input.dispatchKeyEvent` for realism

**Deliverable**: Autocomplete/typeahead testing

**Estimated Effort**: 2-3 days

---

### Phase 4: All Input Types (Week 2-3)
**Scope**: Checkbox, radio, select, file
- ✅ Checkbox support (`fill "input[type=checkbox]" "true"`)
- ✅ Radio button support
- ✅ Select dropdown support
- ✅ File upload helper (optional)

**Deliverable**: Handle all standard HTML input types

**Estimated Effort**: 3-4 days

---

### Phase 5: Advanced Features (Week 3)
**Scope**: Framework detection, edge cases
- ✅ Framework detection (optional optimization)
- ✅ Shadow DOM support
- ✅ contenteditable support
- ✅ Better error messages

**Deliverable**: Production-ready, handles edge cases

**Estimated Effort**: 3-5 days

---

## Code Architecture

### File Structure
```
src/
├── commands/
│   └── formInteraction.ts          # Main command definitions
├── helpers/
│   ├── formFillHelpers.ts          # Fill implementation
│   ├── formTypeHelpers.ts          # Type implementation
│   ├── formSubmitHelpers.ts        # Submit implementation
│   └── reactEventHelpers.ts        # React-specific event handling
└── types.ts                        # Type definitions
```

### Key Modules

**1. Form Fill Helpers** (`src/helpers/formFillHelpers.ts`)
```typescript
export async function fillElement(
  cdp: CDPConnection,
  selector: string,
  value: string,
  options: FillOptions
): Promise<FillResult>
```

**2. React Event Helpers** (`src/helpers/reactEventHelpers.ts`)
```typescript
// JavaScript that gets injected via Runtime.evaluate
export const REACT_FILL_SCRIPT = `
(function(selector, value) {
  const el = document.querySelector(selector);
  // ... native setter + event dispatching
})
`;
```

**3. Type Helpers** (`src/helpers/formTypeHelpers.ts`)
```typescript
export async function typeText(
  cdp: CDPConnection,
  selector: string,
  text: string,
  delayMs: number
): Promise<TypeResult>
```

### Command Registration
```typescript
// In src/commands/formInteraction.ts
export function registerFormInteractionCommands(program: Command): void {
  const formCommand = program
    .command('dom')
    .description('DOM interaction commands');

  formCommand
    .command('fill')
    .argument('<selector>', 'CSS selector')
    .argument('<value>', 'Value to fill')
    .option('--index <n>', 'Element index if multiple matches')
    .option('--delay <ms>', 'Delay between characters', '0')
    .addOption(jsonOption)
    .action(fillAction);

  // ... more commands
}
```

---

## Error Handling

### Common Errors

**1. Element Not Found**
```json
{
  "success": false,
  "error": "Element not found",
  "selector": "input[name='email']",
  "suggestion": "Try: bdg dom query \"input\" to see available elements"
}
```
Exit code: 83 (RESOURCE_NOT_FOUND)

**2. Element Not Fillable**
```json
{
  "success": false,
  "error": "Element is not fillable",
  "selector": "div.container",
  "elementType": "div",
  "suggestion": "Only input, textarea, and select elements can be filled"
}
```
Exit code: 81 (INVALID_ARGUMENTS)

**3. Multiple Matches**
```json
{
  "success": false,
  "error": "Selector matched 5 elements",
  "selector": "input[type='text']",
  "matchCount": 5,
  "suggestion": "Use --index <n> to specify which element, or use a more specific selector"
}
```
Exit code: 81 (INVALID_ARGUMENTS)

**4. Timeout**
```json
{
  "success": false,
  "error": "Timeout waiting for network idle",
  "timeoutMs": 10000,
  "suggestion": "Try increasing --timeout or use --wait-network 0 to skip waiting"
}
```
Exit code: 102 (CDP_TIMEOUT)

---

## Success Metrics

Track these to measure feature success:

1. **Usage**: % of bdg sessions that use form commands
2. **Success Rate**: % of form commands that succeed
3. **Error Rate**: Most common error types
4. **Framework Coverage**: Works with React/Vue/Angular
5. **Agent Adoption**: % of agent automation scripts using form commands vs Runtime.evaluate workarounds

**Target**: 80% of agents should use `bdg dom fill` instead of manual `Runtime.evaluate` within 3 months.

---

## Open Questions

1. **Framework Detection**: Should we auto-detect React/Vue/Angular and optimize event dispatching? Or use universal approach?
   - **Recommendation**: Universal approach first (Phase 1-4), optimize in Phase 5 if needed

2. **Index vs Query References**: Should `--index` use 0-based or 1-based indexing?
   - **Recommendation**: 1-based (matches `bdg dom query` output)

3. **File Upload**: Include in Phase 4 or defer to v0.8.0?
   - **Recommendation**: Phase 4 if simple, defer if complex

4. **Shadow DOM**: How deep should we search?
   - **Recommendation**: Phase 5, add `--shadow-dom` flag

---

## Summary

**Total Estimated Effort**: 2-3 weeks (10-15 working days)

**Deliverables**:
- `bdg dom fill` - Fill form fields (React-compatible)
- `bdg dom type` - Type with delays (autocomplete)
- `bdg dom click` - Click elements
- `bdg dom submit` - Submit forms with smart waiting

**Key Technologies**:
- CDP Input domain (dispatchKeyEvent, dispatchMouseEvent)
- CDP Runtime.evaluate (React event handling)
- Native property setters (React compatibility)

**Success Criteria**:
- Works with React, Vue, Angular, vanilla JS
- 80% reduction in Runtime.evaluate complexity for agents
- Handles 90%+ of common form interaction scenarios

---

**Next Steps**:
1. Review and approve this plan
2. Create GitHub issue for tracking
3. Start Phase 1 implementation (basic fill command)
