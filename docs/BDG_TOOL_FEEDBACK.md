# BDG Tool Usage Review & Recommendations

**Date:** 2025-11-18  
**Use Case:** CSP Security Audit for diy.com  
**Reviewer:** Development Team

---

## Overview

This document provides feedback on using the `bdg` CLI tool (Browser DevTools Protocol automation) for security auditing and telemetry gathering. Based on real-world usage during a Content Security Policy (CSP) investigation.

---

## What Worked Really Well

### 1. `bdg dom eval` - The Killer Feature ⭐

**Why it's great:** Run JavaScript without JSON escaping nightmares.

**Example:**
```bash
# This just works - no escaping needed
bdg dom eval 'document.querySelector("input").value'

# vs the painful alternative with CDP
bdg cdp Runtime.evaluate --params '{"expression":"document.querySelector(\"input\")"}'
```

**Use Cases:**
- Quick DOM inspection
- Security header extraction
- Complex telemetry gathering

**Recommendation:** Make `dom eval` the default recommendation in all documentation. It's significantly more user-friendly than raw CDP commands.

---

### 2. Async/Await Support in eval

**Critical for modern workflows.** Enabled complex multi-step operations:

**Example from CSP audit:**
```bash
bdg dom eval '
(async () => {
  const banners = [
    { name: "BQUK", url: "https://www.diy.com/" },
    { name: "CAFR", url: "https://www.castorama.fr/" },
    { name: "CAPL", url: "https://www.castorama.pl/" }
  ];
  
  const results = {};
  
  for (const banner of banners) {
    const response = await fetch(banner.url);
    const csp = response.headers.get("content-security-policy");
    
    results[banner.name] = {
      hasCSP: !!csp,
      hasUnsafeEval: csp?.includes("unsafe-eval"),
      hasUnsafeInline: csp?.includes("unsafe-inline")
    };
  }
  
  return results;
})()
'
```

**Result:**
```json
{
  "BQUK": {
    "hasCSP": true,
    "hasUnsafeEval": true,
    "hasUnsafeInline": true
  },
  "CAFR": {
    "hasCSP": false
  }
}
```

**Why it matters:** Eliminates need for separate scripts or complex shell loops.

---

### 3. Clean Session Management

**Daemon model works flawlessly:**

```bash
bdg "https://www.diy.com/"    # Start session
# ... do work ...
bdg stop                       # Clean shutdown
```

**Benefits:**
- No orphaned Chrome processes
- Session state persisted to JSON
- Easy to integrate into CI/CD

**Example workflow:**
```bash
#!/bin/bash
bdg "https://www.diy.com/"
sleep 3  # Wait for page load

# Run security checks
bdg dom eval 'fetch("/").then(r => r.headers.get("content-security-policy"))'

# Cleanup
bdg stop
```

---

## Pain Points & Improvement Suggestions

### 1. Network Telemetry Doesn't Capture Main Document Request ❌

**Problem:** `bdg peek` and `bdg details` work great for XHR/Fetch/images, but don't capture the initial HTML document navigation request.

**What works:**
```bash
bdg peek                       # ✅ Shows XHR, images, API calls
bdg peek --verbose             # ✅ Full URLs and formatting
bdg peek --json                # ✅ Structured JSON output
bdg peek --network             # ✅ Filter to network only
bdg peek --last 50             # ✅ Show last 50 items
bdg tail                       # ✅ Live monitoring (like tail -f)
bdg details network 33996.461  # ✅ Full request/response with headers
```

**What doesn't work:**
```bash
# The main HTML document request is NOT in peek/details
bdg peek  # Shows: XHR to colrep.sitelabweb.com, logx.optimizely.com, etc.
          # Missing: GET https://www.diy.com/ (the initial page load)

# Had to use workaround via fetch()
bdg dom eval 'fetch("https://www.diy.com/").then(r => r.headers.get("content-security-policy"))'
```

**Why this matters:**
- Security headers (CSP, HSTS, X-Frame-Options) are set on the document request
- Can't inspect them via `bdg details`
- Forces workaround using `fetch()` inside `dom eval`

**Recommendation:**

Option 1: Capture navigation requests in telemetry
```bash
# Enable CDP Network.responseReceived for document navigations
# Then these would work:
bdg peek --filter document         # Show only document requests
bdg details network <navigation-id> # Get headers from page load
```

Option 2: Add dedicated document inspection
```bash
bdg document headers               # Get headers from current document
bdg document security              # Get all security headers
bdg document response --json       # Full response metadata
```

Option 3: Add `network` wrapper (similar to `dom` wrapper):
```bash
bdg network list                   # List all captured requests (XHR + document)
bdg network get <id>               # Get request details
bdg network headers <url>          # Get response headers
bdg network timing <url>           # Get performance timing
bdg network filter --type document # Filter by resource type
bdg network filter --status 200    # Filter by status code
```

**Priority:** High - Document request telemetry is critical for security audits.

---

### 2. Missing Response Header Inspection

**Problem:** Had to use `fetch()` inside `dom eval` to get headers.

**Workaround used:**
```bash
bdg dom eval '
(async () => {
  const response = await fetch("https://www.diy.com/");
  const headers = {};
  
  const securityHeaders = [
    "content-security-policy",
    "x-frame-options",
    "strict-transport-security"
  ];
  
  securityHeaders.forEach(header => {
    headers[header] = response.headers.get(header);
  });
  
  return headers;
})()
'
```

**What would be better:**
```bash
# Dedicated security header inspector
bdg security headers
# Output:
# content-security-policy: default-src * 'unsafe-eval'
# x-frame-options: SAMEORIGIN
# strict-transport-security: max-age=31536000

bdg security headers --json  # For programmatic use
```

**Recommendation:**

Add security-focused helpers:

```bash
bdg security headers              # Get all security headers
bdg security csp                  # Parse and analyze CSP
bdg security csp --check          # Check for unsafe directives
bdg security cookies              # List cookies with flags
bdg security mixed-content        # Check for http:// resources
```

**Priority:** Medium - Nice to have for security audits.

---

### 3. Skill Documentation vs CLI Help Mismatch

**Problem:** The skill file (`.claude/skills/bdg/`) is excellent, but `bdg --help` doesn't surface the same patterns.

**Current state:**
```bash
bdg --help
# Shows basic commands but no examples or recipes
```

**Recommendation:**

Add interactive help:

```bash
bdg examples              # Show all available examples
bdg examples csp          # Show CSP-specific examples
bdg examples login        # Show login flow examples
bdg recipes security      # Security testing recipes
bdg recipes accessibility # Accessibility testing recipes

# Or integrate with skill system
bdg skill --list          # List available skills/recipes
bdg skill csp             # Run CSP analysis recipe
```

**Priority:** Low - Documentation improvement, not blocking.

---

### 4. Session Output Underutilized

**Problem:** After `bdg stop`, it saves to `~/.bdg/session.json`, but there's no guidance on using this data.

**Current state:**
```bash
bdg stop
# Session stopped. Output saved to: /Users/DZUMAS02/.bdg/session.json

# Now what? The file just sits there.
```

**Recommendation:**

Make session output actionable:

```bash
bdg stop --report              # Show summary after stopping
# Summary:
#   Duration: 45s
#   Network requests: 127
#   Console errors: 3
#   Security issues: 2 (unsafe CSP, mixed content)

bdg history last               # Replay last session's key events
bdg history last --filter csp  # Show only CSP-related events

bdg export --format csv        # Export network data
bdg export --format har        # Export as HAR file (for DevTools)

bdg analyze                    # Run post-session analysis
# Checks:
#   ✅ HTTPS enforced
#   ❌ CSP too permissive
#   ⚠️  3 console errors
```

**Priority:** Medium - Would make telemetry more valuable.

---

### 5. Better Error Messages

**Problem:** Errors are sometimes cryptic.

**Example:**
```bash
bdg details network 200
# Error: Network request not found: 200
```

**Improved version:**
```
Error: Network request not found: 200

Hint: Request IDs are shown in 'bdg peek'. Use 'bdg peek' to see available IDs.
      The number '200' looks like an HTTP status code, not a request ID.

Try:
  bdg peek                    # List all requests with IDs
  bdg peek --verbose          # Show full request details
  bdg network filter --status 200  # Filter by HTTP status
```

**Recommendation:** Add hints and suggestions to all error messages.

**Priority:** Low - Nice UX improvement.

---

## Feature Requests

### 1. Multi-URL Testing / Comparison Mode

**Use Case:** Comparing security headers across multiple banners.

**What I had to do:**
```bash
bdg dom eval '
(async () => {
  const urls = ["diy.com", "castorama.fr", "castorama.pl"];
  const results = {};
  
  for (const url of urls) {
    const response = await fetch("https://" + url);
    results[url] = {
      csp: response.headers.get("content-security-policy")
    };
  }
  
  return results;
})()
'
```

**What would be ideal:**
```bash
bdg compare-urls \
  https://www.diy.com/ \
  https://www.castorama.fr/ \
  https://www.castorama.pl/ \
  --check csp

# Output (table format):
# ┌────────────────┬─────────┬──────────────┬───────────────┐
# │ URL            │ Has CSP │ unsafe-eval  │ unsafe-inline │
# ├────────────────┼─────────┼──────────────┼───────────────┤
# │ diy.com        │ ✅ Yes  │ ❌ Present   │ ❌ Present    │
# │ castorama.fr   │ ❌ No   │ -            │ -             │
# │ castorama.pl   │ ❌ No   │ -            │ -             │
# └────────────────┴─────────┴──────────────┴───────────────┘
```

**Priority:** High - Common use case for multi-brand platforms.

---

### 2. Crawling / Page Scanning

**Use Case:** Audit multiple pages automatically.

**Proposed command:**
```bash
bdg crawl https://www.diy.com/ \
  --depth 2 \
  --collect headers \
  --check security

# Crawls:
#   - Homepage
#   - All links from homepage (depth 1)
#   - All links from those pages (depth 2)
#
# Checks:
#   - CSP on each page
#   - Security headers consistency
#   - Mixed content warnings
```

**Priority:** Medium - Useful for comprehensive audits.

---

### 3. JSON Output Mode

**Use Case:** Integrate with other tools (jq, scripts, CI/CD).

**Proposed:**
```bash
bdg security headers --json | jq '.["content-security-policy"]'

bdg network list --json | jq '.[] | select(.status == 200)'

bdg dom eval 'document.title' --json
# {"result": "B&Q | DIY Products at Everyday Low Prices"}
```

**Priority:** Medium - Improves scriptability.

---

### 4. CI/CD Integration Helpers

**Use Case:** Run security checks in pipelines.

**Proposed:**
```bash
# Exit code 0 if pass, non-zero if fail
bdg assert https://www.diy.com/ \
  --has-csp \
  --no-unsafe-eval \
  --has-hsts

# For GitLab CI
script:
  - bdg assert $DEPLOY_URL --has-csp --no-unsafe-eval
  - bdg export --format junit > security-report.xml

# For reporting
artifacts:
  reports:
    junit: security-report.xml
```

**Priority:** High - Enables "shift-left" security testing.

---

## Real-World Usage Example: CSP Audit

### Full Workflow

```bash
#!/bin/bash
# CSP Security Audit Script using bdg

echo "Starting CSP audit for diy.com..."

# 1. Start session
bdg "https://www.diy.com/"
sleep 3

# 2. Get all security headers
echo "Fetching security headers..."
bdg dom eval '
(async () => {
  const response = await fetch("https://www.diy.com/");
  const headers = {};
  
  ["content-security-policy", "x-frame-options", "strict-transport-security",
   "x-content-type-options", "referrer-policy", "permissions-policy"].forEach(h => {
    headers[h] = response.headers.get(h) || "NOT SET";
  });
  
  return headers;
})()
' > security-headers.json

# 3. Parse and analyze CSP
echo "Analyzing CSP..."
bdg dom eval '
(async () => {
  const response = await fetch("https://www.diy.com/");
  const csp = response.headers.get("content-security-policy");
  
  const directives = {};
  csp.split(";").forEach(directive => {
    const parts = directive.trim().split(/\s+/);
    if (parts[0]) {
      directives[parts[0]] = parts.slice(1);
    }
  });
  
  const unsafe = Object.entries(directives)
    .filter(([_, values]) => 
      values.some(v => v.includes("unsafe") || v === "*")
    )
    .map(([key, values]) => ({
      directive: key,
      unsafe: values.filter(v => v.includes("unsafe") || v === "*")
    }));
  
  return { directives, unsafe };
})()
' > csp-analysis.json

# 4. Count inline scripts
echo "Checking for inline scripts..."
bdg dom eval '
({
  totalScripts: document.scripts.length,
  inlineScripts: Array.from(document.scripts).filter(s => !s.src).length,
  externalScripts: Array.from(document.scripts).filter(s => s.src).length
})
' > script-stats.json

# 5. Get orchestrator version
echo "Identifying infrastructure..."
bdg dom eval '
(async () => {
  const response = await fetch("https://www.diy.com/");
  return {
    server: response.headers.get("server"),
    orchestrator: response.headers.get("x-orchestrator"),
    via: response.headers.get("via")
  };
})()
' > infrastructure.json

# 6. Stop session
bdg stop

# 7. Generate report
echo ""
echo "=== CSP Audit Results ==="
echo ""
echo "Security Headers:"
cat security-headers.json | jq .
echo ""
echo "Unsafe CSP Directives:"
cat csp-analysis.json | jq '.unsafe'
echo ""
echo "Script Statistics:"
cat script-stats.json | jq .
echo ""
echo "Infrastructure:"
cat infrastructure.json | jq .
echo ""
echo "Audit complete. Files saved:"
echo "  - security-headers.json"
echo "  - csp-analysis.json"
echo "  - script-stats.json"
echo "  - infrastructure.json"
```

### Results Obtained

This workflow successfully identified:

1. **CSP Source:** `x-orchestrator: v1.67.2`
2. **Unsafe Directives:** 8 directives with wildcards or unsafe keywords
3. **Script Stats:** 68 total scripts, 15 inline
4. **Infrastructure:** CloudFront → Orchestrator → Node.js app
5. **Missing Headers:** referrer-policy, permissions-policy

**Time to complete:** ~10 seconds  
**Lines of code:** ~80 (including comments)  
**Alternative approach:** Manual DevTools inspection would take 30+ minutes

---

## What I Loved (Keep This!)

### ✅ No JSON Escaping in `dom eval`

**Absolute MVP feature.** Made complex queries trivial.

### ✅ Async/Await Support  

**Critical for modern workflows.** Enabled multi-step operations without callback hell.

### ✅ Clean Daemon Architecture

**Worked flawlessly.** No orphaned processes, clean session management.

### ✅ Skill-Based Documentation

**Well-structured.** The `.claude/skills/bdg/` patterns were invaluable.

### ✅ Exit Code Clarity

**When errors occurred, exit codes made sense.** Easy to debug in scripts.

---

## Summary: Priority Recommendations

### High Priority ⭐⭐⭐

1. **Add `bdg network headers <url>` command**  
   - Most requested feature
   - Eliminates fetch() workaround
   
2. **Add `bdg security csp` helper**  
   - Parse and analyze CSP automatically
   - Check for unsafe directives
   
3. **Improve error messages with hints**  
   - Add suggestions to every error
   - Link to documentation

4. **Add `bdg compare-urls` for multi-site testing**  
   - Critical for multi-brand platforms
   - Common audit use case

5. **CI/CD integration mode (`bdg assert`)**  
   - Enable security testing in pipelines
   - Exit codes for pass/fail

### Medium Priority ⭐⭐

6. **Better `bdg peek` filtering**  
   - `--filter`, `--headers`, `--status`
   
7. **Session replay/export features**  
   - Make session.json actionable
   - Export to HAR, CSV formats

8. **Security helper commands**  
   - `bdg security headers`
   - `bdg security cookies`
   - `bdg security mixed-content`

### Nice to Have ⭐

9. **`bdg crawl` for automated page scanning**  
   - Multi-page audits
   
10. **JSON output mode for all commands**  
    - Better integration with jq, scripts
    
11. **Interactive help (`bdg examples`)**  
    - Surface skill patterns in CLI

---

## Overall Rating: 8.5/10

### Pros ✅
- Solved the CSP investigation perfectly
- `dom eval` is brilliant - no JSON escaping
- Well-designed skill system
- Clean session management

### Cons ❌
- Network telemetry access too indirect
- Missing security-focused helpers
- Session output underutilized

### Would I Use It Again?

**Absolutely.** Especially for:
- Security audits
- Accessibility testing
- DOM inspection tasks
- Header analysis
- Performance monitoring

**With the network/security helpers, it would be a 10/10 tool.**

---

## Additional Use Cases Discovered

Beyond CSP auditing, `bdg` proved useful for:

1. **Multi-Banner Testing**
   - Compare headers across diy.com, castorama.fr, castorama.pl
   - Identify infrastructure inconsistencies

2. **Infrastructure Mapping**
   - Identify CDN layers (CloudFront)
   - Discover middleware (orchestrator)
   - Map request flow

3. **Performance Analysis**
   - Count script tags (68 total, 15 inline)
   - Measure transfer sizes
   - Analyze caching headers

4. **Security Posture Assessment**
   - Check all security headers in one command
   - Identify missing protections
   - Generate compliance reports

---

## Final Thoughts

The `bdg` tool is already excellent for browser automation and security testing. With the addition of network/security wrappers and better telemetry access, it would become the go-to tool for security audits and compliance checks.

**Key strengths:**
- Developer-friendly API (`dom eval`)
- Powerful CDP access
- Clean architecture

**Key opportunities:**
- Make network data more accessible
- Add security-focused helpers
- Improve session output utility

**Recommended next steps:**
1. Implement `bdg network` wrapper
2. Add `bdg security` commands
3. Create example scripts for common use cases
4. Document CI/CD integration patterns

---

**End of Report**
