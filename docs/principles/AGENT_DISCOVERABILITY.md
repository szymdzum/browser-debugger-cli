# Agent Discoverability - Outstanding Issues

**Last Updated:** 2025-11-20  
**Status:** Issue #68 resolved core discoverability pain points  
**Resolution Summary:** See [Pain Points Resolved](../quality/PAIN_POINTS_RESOLVED.md) for complete analysis

## Executive Summary

Issue #68 successfully addressed the root causes of agent discoverability failures through:
- ✅ Task-to-command mappings (15 tasks in JSON schema)
- ✅ Pattern detection with hints (5 patterns, threshold-based)
- ✅ Decision trees (5 scenario navigators)
- ✅ Landing page reorganization (high-level commands first)
- ✅ Runtime state awareness (session-dependent command visibility)

**Resolution Rate:** 8/12 pain points fully resolved (67%)

This document now tracks **only unresolved issues** for clear roadmap planning.

---

## ❌ Outstanding Issues

### 1. Wait Commands (Highest Priority)

**Status:** Out of scope for Issue #68, needs separate implementation

**Problem:**
No built-in way to wait for conditions. Agents use brittle `sleep` patterns:

```bash
# Current (brittle):
sleep 2 && bdg cdp Runtime.evaluate ...

# Needed:
bdg wait --selector '#error-message' --timeout 2000
bdg wait --url-change --timeout 5000
bdg wait --network-idle --timeout 3000
bdg wait --text "Success" --timeout 1000
```

**Impact:** This is the #1 missing feature. Every interactive workflow requires waiting.

**Recommendation:** Create separate issue for wait command implementation.

**Priority:** 🔴 **HIGH** - Critical for agent workflows

---

### 2. Enhanced `bdg dom get` for Runtime Properties

**Status:** Deferred (workaround exists)

**Problem:**
`bdg dom get` returns HTML/attributes but not runtime properties (value, checked, disabled).

**Current Limitation:**
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
```

**Proposed Enhancement:**
```bash
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
      "ariaInvalid": "true"
    },
    "outerHTML": "..."
  }]
}
```

**Workaround:**
Agents can use `bdg dom eval` for runtime properties:
```bash
$ bdg dom eval 'document.querySelector("#email").value'
```

**Rationale for Deferral:**
- `dom eval` provides complete flexibility for property access
- Pattern detection guides agents toward `dom eval` when needed
- Adding `--properties` flag increases API surface complexity

**Priority:** 🟢 **LOW** - Functional workaround exists, pattern hints guide discovery

---

### 3. Progressive Disclosure Workflow

**Status:** Deferred (pattern hints provide similar value)

**Problem:**
No hints after successful commands suggesting next steps.

**Proposed Enhancement:**
```bash
$ bdg dom fill '#email' 'test@example.com'
✓ Element Filled

💡 Next steps:
  • Verify: bdg dom get '#email' --json
  • Check validation: bdg dom eval 'document.querySelector("#email").getAttribute("aria-invalid")'
  • Submit: bdg dom submit 'button[type="submit"]'
  
  (Disable hints: bdg config set hints false)
```

**Rationale for Deferral:**
- Pattern detection (Priority 1, now implemented) provides similar value with less complexity
- Progressive disclosure may be too chatty for some workflows
- Can be added iteratively based on real usage feedback

**Priority:** 🟢 **LOW** - Pattern hints provide core value

---

### 4. Use-Case Examples in Individual Command Help

**Status:** Partially resolved (JSON complete, human help pending)

**Problem:**
Individual command help (e.g., `bdg dom --help`) is reference-style only.

**Current:**
```bash
$ bdg dom --help

Commands:
  query <selector>  Find elements by CSS selector
  get <selector>    Get full HTML and attributes
  fill <selector>   Fill a form field
  [...]
```

**Proposed Enhancement:**
```bash
$ bdg dom --help

Commands:
  [... existing command list ...]

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

**Current State:**
- ✅ Landing page (`bdg`) shows common tasks
- ✅ JSON schema (`--help --json`) has task mappings
- ❌ Individual command help still reference-style

**Rationale for Partial Resolution:**
- JSON schema provides programmatic access (primary agent interface)
- Human help enhancement is lower priority
- Can be improved iteratively

**Priority:** 🟡 **MEDIUM** - JSON schema complete, human help nice-to-have

---

## What Was Resolved (Summary)

For complete details, see [Pain Points Resolved](../quality/PAIN_POINTS_RESOLVED.md)

**Fully Resolved:**
1. ✅ Task-to-command mapping (15 tasks in JSON schema)
2. ✅ Command hints after verbose CDP (5 pattern definitions)
3. ✅ Landing page reorganization (high-level commands first)
4. ✅ Decision trees (5 scenario navigators)
5. ✅ Runtime state awareness (session-dependent visibility)
6. ✅ CDP self-documentation (maintained excellence)
7. ✅ Error message consistency (centralized functions)
8. ✅ Resource type indicators (peek compact mode)

**Impact:**
- **60-70% projected reduction** in verbose CDP usage
- **100% feature discoverability** through JSON schema
- **Better error recovery** with actionable guidance

---

## Roadmap Recommendations

### Immediate (Already Complete)
- ✅ Deploy Issue #68 changes
- ✅ Monitor agent usage patterns in real workflows
- ✅ Gather feedback on hint frequency and relevance

### Short Term (Next 1-2 sprints)
1. 🔴 **Create separate issue for `wait` command** (highest priority missing feature)
2. 🟡 **Enhance individual command help** with use-case examples (complete Priority 2)
3. **Add integration tests** for pattern detection system

### Long Term (Future consideration)
1. 🟢 Progressive disclosure workflow (if usage data shows benefit)
2. 🟢 Enhanced `dom get --properties` flag (if workaround proves insufficient)
3. 🟢 Anti-pattern session summaries (if per-command hints insufficient)

---

## Conclusion

Issue #68 successfully resolved the core discoverability pain points that caused agents to:
- Default to verbose CDP instead of high-level commands
- Never discover existing features
- Make assumptions instead of investigating

**The most critical unresolved issue is wait commands**, which was intentionally scoped out for separate implementation. All other unresolved issues have functional workarounds and lower priority.

**Next Steps:**
1. Create issue for wait command implementation
2. Monitor agent usage with Issue #68 improvements
3. Iterate based on real-world feedback
