# Agent Discoverability - Observations from Real Usage

**Date:** 2025-11-13  
**Context:** Accessibility testing of login/registration forms at localhost:3000  
**Agent:** Claude (Sonnet 4.5)

## Executive Summary

During a real-world form testing task, the agent defaulted to verbose CDP commands (`Runtime.evaluate`) instead of discovering existing higher-level commands (`bdg dom get`, `bdg screenshot`). This document captures observations about **why discovery failed** and **how to improve it**.

## What Worked Well

1. **CDP discovery is excellent** - `bdg cdp --list`, `--describe`, `--search` made protocol exploration easy
2. **Form commands worked reliably** - After fixes, `bdg dom fill/click/submit` performed well
3. **Exit codes were clear** - Semantic codes made error handling predictable
4. **JSON output was parseable** - `--json` flag provided consistent structured output

## Discovery Failures

### Failure 1: Never Checked `bdg dom --help`

**What happened:**
- Agent needed to check form field values and aria attributes
- Immediately jumped to `bdg cdp Runtime.evaluate` for DOM inspection
- Never considered that `bdg dom get` might exist

**Why it happened:**
- Assumed DOM commands were for **manipulation** (fill/click), not **inspection**
- CDP felt like the "direct" way to access runtime properties
- Agent was in "expert mode" - thought they knew the best approach

**Pattern:**
```bash
# What agent did (verbose):
bdg cdp Runtime.evaluate --params '{"expression":"(() => { const el = document.querySelector(\"#email\"); return { value: el?.value, invalid: el?.getAttribute(\"aria-invalid\") }; })()","returnByValue":true}'

# What agent should have discovered:
bdg dom get '#email' --json
```

### Failure 2: Suggested `bdg screenshot` as "Missing Feature"

**What happened:**
- Agent suggested adding `bdg screenshot` as an improvement
- Command already existed but agent never checked

**Why it happened:**
- Didn't review full command list from `bdg --help --json` before making suggestions
- Made assumptions based on perceived gaps rather than actual investigation

### Failure 3: Didn't Follow Own Documentation Advice

**Irony:**
- `CLAUDE.md` explicitly states: "bdg is self-documenting at TWO levels - use these FIRST"
- Agent wrote this guidance for other agents but didn't follow it themselves
- Went straight to low-level CDP instead of checking high-level commands

## Root Cause Analysis

### Why Agents Skip Discovery

1. **Familiarity Bias** - Once agents learn CDP works, they stick with it
2. **Perceived Directness** - CDP feels like "going to the source" 
3. **Command Categorization Assumptions** - "DOM commands are for manipulation, not inspection"
4. **Expert Mode Trap** - Thinking "I know the best way" prevents exploration
5. **Flow State** - When executing tasks quickly, agents skip documentation checks

### Current Documentation Gaps

1. **Help text is reference-style, not use-case oriented**
   - Lists commands but doesn't show when to use them
   - No guidance on "simpler alternatives exist"

2. **No in-flow learning prompts**
   - Tool doesn't suggest better approaches after verbose commands
   - No "did you know?" hints during usage

3. **Missing task-to-command mapping**
   - Agents think in terms of **tasks** ("check form value")
   - Help text shows **commands** ("dom get")
   - Gap between task intent and command discovery

## Improvement Recommendations

### Priority 1: Command Hints After Verbose CDP Usage

When agent uses complex CDP for common tasks, show simpler alternative:

```bash
$ bdg cdp Runtime.evaluate --params '{"expression":"document.querySelector(\"h1\").outerHTML"}'

{
  "result": {
    "result": {
      "value": "<h1>Hello</h1>"
    }
  }
}

💡 Tip: For DOM inspection, try 'bdg dom get h1' for simpler syntax
```

**Implementation:**
- Detect patterns in `Runtime.evaluate` expressions (querySelector, outerHTML, etc.)
- Add suggestion to JSON output: `"suggestion": "Consider: bdg dom get h1"`
- Make it unobtrusive (suffix, not blocking)

### Priority 2: Use-Case Oriented Help

Enhance `--help` with common use cases:

```bash
$ bdg dom --help

Usage: bdg dom [options] [command]

Commands:
  query <selector>         Find elements by CSS selector
  get <selector>           Get full HTML and attributes
  fill <selector> <value>  Fill a form field (React-compatible)
  click <selector>         Click an element
  submit <selector>        Submit a form
  eval <script>            Evaluate JavaScript (advanced)
  screenshot <path>        Capture page screenshot

Common Use Cases:
  Check if element exists:
    $ bdg dom query '#login-button'
  
  Get element HTML/attributes:
    $ bdg dom get '#email' --json
  
  Get runtime properties (value, checked, etc):
    $ bdg dom eval 'document.querySelector("#email").value'
  
  Fill and submit form:
    $ bdg dom fill '#email' 'test@example.com'
    $ bdg dom submit 'button[type="submit"]'
  
  Capture visual state:
    $ bdg screenshot output.png

💡 For complex queries, use 'bdg cdp Runtime.evaluate'
```

### Priority 3: Task-to-Command Map in JSON Help

Add `commonTasks` section to `bdg --help --json`:

```json
{
  "version": "0.6.0",
  "commands": [...],
  "commonTasks": {
    "inspectElement": {
      "commands": [
        {
          "command": "bdg dom get <selector> --json",
          "description": "Get HTML and attributes",
          "note": "Does not include runtime properties like 'value' or 'checked'"
        },
        {
          "command": "bdg dom eval 'document.querySelector(\"selector\").value'",
          "description": "Get runtime property value"
        }
      ]
    },
    "captureVisualState": {
      "commands": [
        {
          "command": "bdg screenshot <path>",
          "description": "Full page screenshot"
        },
        {
          "command": "bdg dom screenshot --selector <selector> <path>",
          "description": "Screenshot specific element"
        }
      ]
    },
    "waitForCondition": {
      "commands": [
        {
          "command": "Use sleep with retry loop",
          "description": "No built-in wait command yet",
          "suggestion": "Feature request: 'bdg wait --selector' command"
        }
      ]
    }
  }
}
```

### Priority 4: Progressive Disclosure Workflow

Add hints after successful commands suggesting next steps:

```bash
$ bdg dom fill '#email' 'test@example.com'
✓ Element Filled

💡 Next steps:
  • Verify: bdg dom get '#email' --json
  • Check validation: bdg dom eval 'document.querySelector("#email").getAttribute("aria-invalid")'
  • Submit: bdg dom submit 'button[type="submit"]'
  
  (Disable hints: bdg config set hints false)
```

### Priority 5: Enhanced `bdg dom get` for Runtime Properties

Current limitation: `bdg dom get` returns HTML/attributes but not runtime properties:

```bash
# Current (attributes only):
$ bdg dom get '#email' --json
{
  "nodes": [{
    "tag": "input",
    "attributes": { "id": "email", "type": "email" },
    "outerHTML": "..."
  }]
}

# Proposed (add --properties flag):
$ bdg dom get '#email' --properties --json
{
  "nodes": [{
    "tag": "input",
    "attributes": { "id": "email", "type": "email" },
    "properties": {
      "value": "test@example.com",
      "checked": false,
      "disabled": false,
      "ariaInvalid": "true",
      "ariaDescribedBy": "email-error"
    },
    "outerHTML": "..."
  }]
}
```

This would eliminate the need for verbose `Runtime.evaluate` calls for common property checks.

## Missing Feature: Wait Commands

**Biggest pain point:** No built-in way to wait for conditions.

Agent had to use brittle patterns:
```bash
# Current (brittle):
sleep 2 && bdg cdp Runtime.evaluate ...

# Needed:
bdg wait --selector '#error-message' --timeout 2000
bdg wait --url-change --timeout 5000
bdg wait --network-idle --timeout 3000
bdg wait --text "Success" --timeout 1000
```

**Impact:** This is the #1 feature request from agent perspective. Every interactive workflow requires waiting.

## Lessons for Agent-Friendly Tool Design

### 1. Tools Should Teach Themselves

Don't rely on agents reading docs before use. Provide **in-flow learning**:
- Hints after suboptimal usage
- Suggestions for simpler alternatives  
- Progressive disclosure of features

### 2. Bridge Task Intent to Command Discovery

Agents think: "I need to check if form validation triggered"  
Help text shows: "dom get - Get full HTML and attributes"

**Gap:** No mapping from task intent → appropriate command

**Solution:** Use-case oriented help, task-to-command JSON mapping

### 3. Make Expertise a Ladder, Not a Cliff

Current state:
- New agents: Struggle to find commands
- Expert agents: Skip high-level commands, use CDP directly

**Better:** 
- New agents: Get use-case examples, suggestions
- Expert agents: Get hints about simpler alternatives
- All agents: Progressive disclosure keeps them learning

### 4. JSON Help Should Be Agent-Optimized

Human `--help`: Reference documentation  
Agent `--help --json`: Should include task mapping, common patterns, workflow hints

### 5. Detect and Interrupt Anti-Patterns

If agent uses `Runtime.evaluate` 5+ times in a session, interrupt with:
```
💡 You're using Runtime.evaluate frequently. Consider these alternatives:
  • DOM inspection: bdg dom get <selector>
  • DOM queries: bdg dom query <selector>
  • See all DOM commands: bdg dom --help
```

## Real-World Impact

During form testing task:
- **13 verbose CDP commands** for DOM inspection
- **0 uses** of `bdg dom get` (never discovered)
- **1 suggestion** to add `bdg screenshot` (already existed)
- **Multiple `sleep` workarounds** (no wait command)

With improvements above:
- Estimated **60% reduction** in verbose CDP usage
- **100% discovery** of existing features (through hints)
- **Cleaner scripts** with proper wait primitives

## Conclusion

The tool is functionally complete but **discoverability is the bottleneck**. Agents default to low-level approaches not because high-level commands don't exist, but because:

1. They don't know to check for them
2. Command names don't match task intent
3. No in-flow learning prompts
4. Expert mode encourages skipping documentation

**Recommendation:** Implement Priority 1-2 (command hints, use-case help) for immediate improvement. These require minimal code changes but significantly improve agent experience.

## Appendix: Actual Usage Patterns

### Pattern 1: Property Inspection (13 occurrences)
```bash
# What agent did:
bdg cdp Runtime.evaluate --params '{"expression":"(() => { const el = document.querySelector(\"#email\"); return { value: el?.value, invalid: el?.getAttribute(\"aria-invalid\") }; })()","returnByValue":true}'

# Should have used:
bdg dom get '#email' --json  # For attributes
bdg dom eval 'document.querySelector("#email").value'  # For properties
```

### Pattern 2: Wait for State Change (4 occurrences)
```bash
# What agent did:
sleep 2 && bdg cdp Runtime.evaluate ...

# Needed:
bdg wait --selector '#error-message' --timeout 2000
```

### Pattern 3: Visual Debugging (0 occurrences, needed 3 times)
```bash
# Never used (didn't know it existed):
bdg screenshot form-state.png

# Would have helped debug:
- Why form didn't submit
- Which button was clicked (sr-only vs visible)
- Current validation state
```

These patterns show clear opportunities for discoverability improvements.
