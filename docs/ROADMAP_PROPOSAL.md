# bdg: Strategic Roadmap & Vision

## Vision: The "Browser Interface for Agents" (BIA)
`bdg` is not just a debugger; it is the **standard library for AI Agents interacting with the web**.
While Puppeteer/Playwright are for *programmers* writing scripts, `bdg` is for *agents* discovering and manipulating state dynamically via a text interface.

---

## 1. The Foundation: Accessibility Engine (Critical Path)
**Status:** 🔴 Not Started
**Why:** You cannot build "Semantic Interaction" (Click "Submit") without a robust Accessibility Tree parser. This is the dependency for everything else.

### New Command Suite: `bdg a11y`
- `bdg a11y tree`: Dumps the computed accessibility tree.
- `bdg a11y query "Button 'Submit'"`: Resolves semantic queries to NodeIDs.
- *Implementation:* Wraps `Accessibility.getFullAXTree` and provides a query engine for Role/Name/Value.

## 2. The "Semantic Interaction" Layer (Dependent on A11y)
**Problem:** Raw CDP input (`Input.dispatchMouseEvent`) is too low-level.
**Solution:** High-level verbs powered by the A11y Engine.

### New Commands:
- `bdg click "Sign Up"` -> Resolves via `bdg a11y query` -> Dispatches Input events.
- `bdg type "Search..." "drills"` -> Resolves via `bdg a11y query` -> Dispatches Keystrokes.

---

## 3. Context Optimization (Token Economy)
**Problem:** `bdg dom get` dumps raw HTML, which burns tokens and confuses models with layout noise (`div` soups).
**Solution:** A "Semantic Dump" mode.

### New Flag: `bdg dump --semantic`
- Returns a Markdown-like representation of the **Accessibility Tree**.
- **Output Example:**
  ```markdown
  [Button] "Menu"
  [Heading L1] "Castorama"
  [SearchField] "Search..." (focused: false)
  [Link] "Garden"
  [Link] "Tools"
  ```
- **Benefit:** Reduces token usage by 90%+ while increasing agent accuracy.

---

## 3. The "Headless" TUI (Developer Experience)
**Problem:** When an agent hangs, the developer has to `peek` blindly or `stop` the session.
**Solution:** An interactive Text User Interface.

### New Command: `bdg ui` (or `bdg monitor`)
- A `k9s`/`htop` style interface in the terminal.
- **Panels:**
  - **Live Network:** Scrolling list of requests (status, type, size).
  - **Console:** Real-time logs.
  - **DOM Explorer:** Tree view.
  - **Status:** Memory usage, current URL, active targets.
- **Why:** Allows developers to "watch" the agent work in real-time without the overhead of a GUI browser.

---

## 4. Session Portability & Replay
**Problem:** Debugging complex network issues (like the mixed content check) is hard in text.
**Solution:** Standard Export Formats.

### New Command: `bdg export --har session.har`
- Exports the collected network log to HTTP Archive format.
- **Workflow:** Agent finds a bug -> Exports HAR -> Developer drags HAR into their local Chrome DevTools to see the waterfall.

---

## 6. Cognitive Ergonomics (The "Teacher")
**Problem:** Agents default to raw CDP because they don't know better.
**Solution:** Active, logic-based suggestions.

### Pattern Matching Suggestions
- **Logic:** If input contains `document.querySelector`, suggest `bdg dom query`.
- **Logic:** If input contains `document.cookie`, suggest `bdg network getCookies`.
- **Implementation:** Regex-based "Anti-Pattern Detector" in the command runner.

## 7. Technical Debt & Friction (Immediate Fixes)
- **Fix `peek` JSON Schema:** Unify `preview.data` vs `data`.
- **Smart Wait Strategy:** Implement `bdg wait --network-idle` or `bdg wait --selector ".foo"`. Agents currently rely on external polling loops (as seen in the workflows), which is slow. Native waiting is faster and more reliable.
- **Protocol Versioning:** Graceful fallbacks for deprecated methods (like `Security.getVisibleSecurityState`).

## Summary of Direction
Move `bdg` from **"Raw CDP Wrapper"** -> **"Semantic Browser Agent"**.
Keep the raw access (it's your superpower), but build the "Skills" layer *into* the tool so agents don't have to reinvent the wheel.
