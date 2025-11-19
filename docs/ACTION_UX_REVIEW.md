# bdg Agent UX Review: State of the Union

**Date:** 2025-11-18
**Focus:** Agent Ergonomics (How easy is it for an LLM to use this tool?)

## 1. Input Actions (The "Hands")
**Status:** ⭐⭐⭐ (3/5) - Functional but Low-Level

We have `bdg dom fill`, `click`, `submit`. This is a huge improvement over raw `Runtime.evaluate`.
*   **Good:** `fill` handles React state (a notoriously hard problem for agents).
*   **Bad:** It relies entirely on **CSS Selectors** (`input[name="email"]`).
*   **The Gap:** Agents are bad at guessing CSS selectors. They are good at "Intent" ("Click the Search button").
*   **Verdict:** We are forcing the agent to be a Frontend Developer. We need to let them be Users (`bdg click "Search"`).

## 2. Observation Actions (The "Eyes")
**Status:** ⭐⭐ (2/5) - Inconsistent Abstraction

*   **DOM:** `bdg dom get` returns raw HTML.
    *   *Critique:* Violates "Token Economy". A 50KB HTML dump is expensive and noisy.
*   **Network:** `bdg peek` is powerful but has a confusing JSON schema (`preview.data` vs `data`).
    *   *Critique:* Agents fail when schemas drift.
*   **Console:** Functional but basic.
*   **Verdict:** We provide "Data" but not "Insight". The agent has to burn tokens to filter the noise.

## 3. Waiting Actions (The "Nervous System")
**Status:** ⭐ (1/5) - Critical Missing Piece

*   **Current State:** Agents use `sleep 2` or complex `while` loops in bash.
    *   *Evidence:* `AGENT_DISCOVERABILITY.md` showed agents writing 10 lines of bash just to wait for a div.
*   **Verdict:** This is the #1 cause of flakey agent scripts. `bdg` is stateless, but the browser is stateful. We need `bdg wait`.

## 4. Cognitive Ergonomics (The "Teacher")
**Status:** ⭐⭐ (2/5) - Passive Documentation

*   **The "Expert Trap":** Agents (like me!) default to raw CDP (`Runtime.evaluate`) because they don't know high-level commands exist.
    *   *Evidence:* `AGENT_DISCOVERABILITY.md` proves agents skip `bdg dom get` if not explicitly guided.
*   **Missing Feedback Loop:** The tool is silent when used sub-optimally.
    *   *Solution:* **Active Hints** in JSON output.
    *   *Example:* `_meta: { suggestion: "Use 'bdg dom get' to save 50% tokens" }`
*   **Task Mapping:** Help text lists *tools* (`dom`, `network`), not *tasks* ("Login", "Audit").

## 5. UX Scorecard

| Capability | Current Tool | Agent Friction | Score |
| :--- | :--- | :--- | :--- |
| **Discovery** | `bdg cdp --search` | Low (Excellent) | 5/5 |
| **Input** | `bdg dom click <css>` | Medium (Selector guessing) | 3/5 |
| **Observation** | `bdg dom get` | High (Token cost, parsing) | 2/5 |
| **Synchronization**| `sleep` (External) | Extreme (Flakiness) | 1/5 |
| **Learnability** | Passive Help | High (Requires reading) | 2/5 |

## 6. Recommendations (The Path Forward)

### Priority 1: The "Standard Library" (Technical Fixes)
1.  **Build `bdg wait` Immediately.** (`--network-idle`, `--selector`)
2.  **Implement Semantic Selectors.** (`click --text "Submit"`)
3.  **Implement Semantic Dump.** (Token-optimized DOM)

### Priority 2: The "Socratic Teacher" (Cognitive Fixes)
1.  **Active Hints:** Inject usage tips into JSON output when raw CDP is used inefficiently.
2.  **Task-Based Help:** Add `commonTasks` to `bdg --help --json` mapping intents to commands.
