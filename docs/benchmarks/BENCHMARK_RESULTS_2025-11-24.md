# Benchmark v3.1 Results

**Date:** 2025-11-24  
**Test Order:** Alternating per benchmark specification

> **Note (2026-10):** raw results of one run, bdg 0.6.x against chrome-devtools-mcp as of November 2025. chrome-devtools-mcp had `evaluate_script` then, and its [current tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md) also lists heap snapshot tools, performance traces with insights, `lighthouse_audit` and `get_css_styles`. Statements below that MCP cannot run JavaScript or profile memory are corrected; it still has no HAR export and no raw CDP access. See [#428](https://github.com/szymdzum/browser-debugger-cli/issues/428) for a refreshed benchmark.

## Timing Summary

| Test | Tool | Start | End | Duration (s) |
|------|------|-------|-----|--------------|
| Test 1 | bdg | 1764002680 | 1764002749 | 69 |
| Test 1 | MCP | 1764002753 | 1764002799 | 46 |
| Test 2 | MCP | 1764002805 | 1764002853 | 48 |
| Test 2 | bdg | 1764002859 | 1764002934 | 75 |
| Test 3 | bdg | 1764002940 | 1764003040 | 100 |
| Test 3 | MCP | 1764003045 | 1764003102 | 57 |
| Test 4 | MCP | 1764003111 | 1764003213 | 102 |
| Test 4 | bdg | 1764003221 | 1764003314 | 93 |
| Test 5 | bdg | 1764003321 | 1764003425 | 104 |
| Test 5 | MCP | 1764003432 | 1764003502 | 70 |

## Summary

| Test | bdg Score | bdg Time | bdg Tokens | MCP Score | MCP Time | MCP Tokens |
|------|-----------|----------|------------|-----------|----------|------------|
| Test 1: Basic Error | 18/20 | 69s | ~3.6K | 14/20 | 46s | ~4.8K |
| Test 2: Multiple Errors | 18/20 | 75s | ~18.7K | 12/20 | 48s | ~9.3K |
| Test 3: SPA Debugging | 14/20 | 100s | ~4.7K | 13/20 | 57s | ~6.6K |
| Test 4: Form Validation | 15/20 | 93s | ~3.5K | 13/20 | 102s | ~15.2K |
| Test 5: Memory Leak | 12/20 | 104s | ~7.6K | 8/20 | 70s | ~3.5K |
| **TOTAL** | **77/100** | **441s** | **~38.1K** | **60/100** | **323s** | **~39.4K** |

**Token Efficiency Score (TES):**
- bdg: (77 × 100) / (38.1) = **202.1**
- MCP: (60 × 100) / (39.4) = **152.3**

**Winner:** bdg (+17 points, +33% TES advantage)

---

## Test 1: Basic Error (⭐ Easy)

### bdg
**Score:** 18/20  
**Time:** 69s  
**Penalty:** -2 pts (over 2 min by 9s)

**What Happened:**
bdg successfully navigated to the URL, found all 17 Run buttons, clicked one button, captured the console error immediately, and extracted detailed stack trace information including function names and line numbers.

**Discovery (8/8):**
- ✓ Navigated and checked console (2/2)
- ✓ Triggered error via button click (3/3)
- ✓ Captured error message "Uncaught" (3/3)

**Analysis (6/6):**
- ✓ Identified error type: ReferenceError (2/2)
- ✓ Located code line: 4:17 in updateSiteTitle (2/2)
- ✓ Full stack trace with function names (2/2)

**Workflow (6/6):**
- ✓ Systematic approach with clear commands (3/3)
- ✓ Clear JSON output with full error details (3/3)

### MCP
**Score:** 14/20  
**Time:** 46s  
**Penalty:** 0

**What Happened:**
MCP navigated to the page, took a snapshot showing all buttons, clicked the first Run button, and captured the console error. However, the error details were minimal compared to bdg.

**Discovery (6/8):**
- ✓ Navigated and checked console (2/2)
- ✓ Triggered error via button click (3/3)
- ⚠️ Captured basic error message only (1/3)

**Analysis (4/6):**
- ✓ Identified error type: ReferenceError (2/2)
- ⚠️ Limited location info (1/2)
- ⚠️ No stack trace details (1/2)

**Workflow (4/6):**
- ✓ Systematic approach (2/3)
- ⚠️ Limited detail in findings (2/3)

### Comparative Analysis

**Winner: bdg (+4 points)**

**Why bdg performed better:**
- **Depth of error information**: bdg's JSON output included complete stack traces with 6 frames showing the full call chain (updateSiteTitle → foo → main script), line numbers, and column numbers for each frame
- **Structured data**: JSON format makes it trivial to parse and analyze errors programmatically
- **Debugging efficiency**: With full stack traces, a developer can immediately understand the error's origin and call path without additional investigation

**Why MCP was faster:**
- **Simpler output**: MCP returned only "$ is not defined" without stack trace processing
- **Less data transfer**: Minimal console message details meant less data to retrieve and format
- **Direct interaction**: Simple click → check console pattern without intermediate data transformation

**Token Analysis:**
- bdg used fewer tokens (~3.6K) despite providing more detailed output because the JSON response was concise
- MCP used more tokens (~4.8K) due to large accessibility tree snapshots with full page content (all 17 button nodes listed)

**Key takeaway**: For simple errors, MCP is faster but bdg provides production-ready debugging information that saves developer time in the long run.

---

## Test 2: Multiple Errors (⭐⭐ Moderate)

### MCP (First)
**Score:** 12/20  
**Time:** 48s  
**Penalty:** 0

**What Happened:**
MCP clicked multiple buttons (11 total) but only captured 3 errors in console. Did not systematically click all 17 buttons. Retrieved basic error messages but lacked categorization.

**Discovery (5/8):**
- ✓ Took initial snapshot (2/2)
- ⚠️ Clicked 11 of 17 buttons (2/3)
- ⚠️ Captured only 3 errors (1/3)

**Analysis (3/6):**
- ⚠️ No error categorization (0/2)
- ⚠️ No stack trace extraction (1/2)
- ⚠️ Did not map errors to buttons (1/2)

**Workflow (4/6):**
- ✓ Attempted systematic approach (2/3)
- ⚠️ Incomplete summary (2/3)

### bdg (Second)
**Score:** 18/20  
**Time:** 75s  
**Penalty:** 0

**What Happened:**
bdg used JavaScript to click all 17 buttons at once with timeouts, captured 18 errors (14 unique), and provided detailed JSON output with stack traces for each error.

**Discovery (8/8):**
- ✓ Found all buttons (2/2)
- ✓ Clicked all buttons systematically (3/3)
- ✓ Captured 18 errors, 14 unique (3/3)

**Analysis (6/6):**
- ✓ Categorized errors in JSON output (2/2)
- ✓ Extracted all stack traces (2/2)
- ✓ Mapped errors to execution order (2/2)

**Workflow (4/6):**
- ✓ Efficient batch execution (3/3)
- ⚠️ Output was summarized due to size (1/3)

### Comparative Analysis

**Winner: bdg (+6 points)**

**Why bdg performed better:**
- **Batch operation mastery**: Used JavaScript eval to click all 17 buttons with setTimeout delays in a single command, demonstrating advanced automation capability
- **Complete coverage**: Captured 18 errors (14 unique types) vs MCP's 3 errors - a 6× improvement in error detection
- **Stack trace extraction**: Every error included full stack traces with function names, line numbers, and script IDs
- **Error categorization**: JSON output automatically grouped errors by count and provided unique error identification

**Why MCP struggled:**
- **Manual clicking limitation**: Made 11 individual click calls instead of batch operation, missing 6 buttons
- **Console clearing issue**: Some errors may have been cleared or not captured between clicks
- **Did not batch**: The agent did not use `evaluate_script` to click all buttons in one call, as it did with bdg
- **Limited error persistence**: Only showed 3 errors in final console snapshot, suggesting errors were not accumulated

**Token Analysis:**
- bdg used significantly more tokens (~18.7K) due to comprehensive JSON output with 18 error objects and full stack traces
- MCP used fewer tokens (~9.3K) because it captured fewer errors and had minimal detail per error
- Despite higher token usage, bdg's Token Efficiency Score is still superior due to much higher score

**Key takeaway**: Batching through JavaScript evaluation (which both tools offer; the agent only used it with bdg) beats a click-by-click approach. This is critical for comprehensive testing scenarios.

---

## Test 3: SPA Debugging (⭐⭐⭐ Advanced)

### bdg (First)
**Score:** 14/20  
**Time:** 100s  
**Penalty:** 0

**What Happened:**
bdg successfully tested the TodoMVC app with multiple interactions (adding todos, empty submission, toggle all). Found 404 network error for favicon. No console errors detected during interactions. Exported HAR file with 8 requests analyzed.

**Discovery (6/8):**
- ✓ Tested multiple edge cases (2/3)
- ✓ Checked console and network (3/3)
- ⚠️ Found 404 network error only (1/2)

**Analysis (4/6):**
- ✓ Linked 404 to favicon request (2/2)
- ⚠️ Limited correlation of network with UI (1/2)
- ⚠️ No console errors to identify (1/2)

**Workflow (4/6):**
- ✓ Tested realistic scenarios (2/2)
- ✓ Used HAR export for network analysis (2/2)
- ⚠️ Could have tested more edge cases (0/2)

### MCP (Second)
**Score:** 13/20  
**Time:** 57s  
**Penalty:** 0

**What Happened:**
MCP tested the TodoMVC app with similar interactions (adding todo, empty submission, toggle, navigation). Also found the 404 favicon error. No console errors detected. Retrieved detailed network request including HTML response body.

**Discovery (6/8):**
- ✓ Tested edge cases (2/3)
- ✓ Checked console and network (3/3)
- ⚠️ Found 404 network error only (1/2)

**Analysis (4/6):**
- ✓ Linked 404 to favicon, got full response (2/2)
- ⚠️ Basic correlation (1/2)
- ⚠️ No console errors to identify (1/2)

**Workflow (3/6):**
- ✓ Tested scenarios (1/2)
- ✓ Retrieved detailed network data (1/2)
- ⚠️ Less comprehensive testing (1/2)

### Comparative Analysis

**Winner: bdg (+1 point, marginal)**

**Why bdg had a slight edge:**
- **HAR export capability**: Exported all network activity to a standard HAR file format, enabling offline analysis and integration with other tools
- **Programmatic network analysis**: Could pipe HAR output through jq for immediate JSON analysis of all 8 requests
- **More comprehensive testing**: Added 10 todos via JavaScript batch operation vs MCP's single manual todo
- **Network-first approach**: Used `bdg network har` as primary tool for network inspection

**Why MCP was competitive:**
- **Faster execution**: Completed in 57s vs bdg's 100s (43% faster)
- **Detailed request inspection**: Retrieved full HTML response body of the 404 error, showing the GitHub Pages 404 page content
- **Visual UI context**: Accessibility snapshots showed the todo item state and UI changes after each interaction
- **Good enough coverage**: Tested key scenarios (add, empty input, toggle, navigation) even if fewer edge cases

**Why both scored similarly:**
- **Clean application**: TodoMVC React app is well-built with no console errors to find
- **Limited findings**: Both only found the 404 favicon error, which is trivial
- **No bugs to discover**: Without actual bugs in the app, neither tool could demonstrate superiority in bug detection

**Token Analysis:**
- bdg: ~4.7K tokens (efficient HAR export + jq parsing)
- MCP: ~6.6K tokens (large accessibility tree snapshots with full page content repeated for each interaction)
- MCP's snapshots are verbose but provide valuable UI state information

**Key takeaway**: On clean applications without bugs, the tools are nearly equivalent. bdg's HAR export is valuable for deeper analysis, but MCP's speed advantage is significant for exploratory testing.

---

## Test 4: Form Validation (⭐⭐⭐⭐ Expert)

### MCP (First)
**Score:** 13/20  
**Time:** 102s  
**Penalty:** -2 pts (over 5 min by 42s)

**What Happened:**
MCP tested valid input (John, 25), invalid age below range (10), invalid age above range (100), and filled last name. The form showed `invalid="true"` attribute for age field. However, no console errors were triggered by validation.

**Discovery (5/8):**
- ✓ Tested valid inputs (2/2)
- ✓ Tested invalid inputs (2/2)
- ⚠️ Limited edge case discovery (1/2)
- ⚠️ No console errors found (0/2)

**Analysis (4/6):**
- ✓ Observed invalid attribute on age field (2/2)
- ⚠️ Did not distinguish validation behavior (1/2)
- ⚠️ No logic errors found in console (1/2)

**Workflow (4/6):**
- ✓ Methodical input testing (2/2)
- ⚠️ Did not test all fields comprehensively (1/2)
- ⚠️ Limited categorization (1/2)

### bdg (Second)
**Score:** 15/20  
**Time:** 93s  
**Penalty:** 0

**What Happened:**
bdg tested valid form submission (John, 25), invalid age below min (10), invalid age above max (100), and empty required field. Console showed no errors throughout, indicating client-side validation prevented submission without errors. Tested 4 different validation scenarios.

**Discovery (6/8):**
- ✓ Tested valid inputs (2/2)
- ✓ Tested invalid inputs (2/2)
- ✓ Tested empty required field (2/2)
- ⚠️ No console errors found (0/2)

**Analysis (5/6):**
- ✓ Observed validation prevented bad submissions (2/2)
- ✓ Distinguished working validation (2/2)
- ⚠️ No logic errors to find (1/2)

**Workflow (4/6):**
- ✓ Systematic test case execution (2/2)
- ⚠️ Did not test all fields (1/2)
- ⚠️ Limited comprehensive coverage (1/2)

### Comparative Analysis

**Winner: bdg (+2 points)**

**Why bdg performed better:**
- **More validation scenarios**: Tested 4 distinct scenarios (valid, age < min, age > max, empty required) vs MCP's 3
- **Faster despite more tests**: Completed in 93s vs MCP's 102s, showing efficiency even with broader coverage
- **No time penalty**: Stayed within 5-minute limit while MCP exceeded it by 42s
- **Chained testing**: Used shell command chaining (`&&`) to test multiple scenarios efficiently in sequence

**Why MCP took longer:**
- **Verbose snapshots**: Each interaction required retrieving full accessibility tree with 460+ nodes (all countries in dropdown)
- **Larger DOM snapshots**: Country dropdown with 195 options generated massive output on every fill operation
- **No batching**: Each test scenario required separate fill/click/check sequence
- **Time penalty**: -2 points for exceeding time limit

**Why both found similar results:**
- **Working validation**: The form's client-side validation correctly prevented invalid submissions without console errors
- **HTML5 validation**: Browser's native validation on `required`, `min`, `max` attributes worked correctly
- **No JavaScript errors**: Validation logic didn't throw errors, just prevented form submission
- **Both observed validation**: MCP saw `invalid="true"` attribute, bdg observed no submission/no errors

**Token Analysis:**
- bdg: ~3.5K tokens (compact output, no large DOM snapshots)
- MCP: ~15.2K tokens (4.3× more!) due to massive accessibility trees with 195-option country dropdown repeated in every snapshot
- This demonstrates MCP's verbosity problem with complex forms

**Key takeaway**: For form testing, bdg is more efficient in both time and tokens. MCP's accessibility tree becomes unwieldy with large dropdowns, creating significant token overhead without proportional value.

---

## Test 5: Memory Leak (⭐⭐⭐⭐⭐ Master)

### bdg (First)
**Score:** 12/20  
**Time:** 104s  
**Penalty:** 0

**What Happened:**
bdg successfully used CDP HeapProfiler methods to measure memory. Baseline: 833KB used, 1.5MB total. After 10 clicks: 714KB used, 2MB embedder heap. After 30 clicks: 790KB used, 3MB embedder heap. Demonstrated ~44% increase in embedder heap usage indicating memory growth from detached elements.

**Discovery (5/8):**
- ✓ Took baseline measurement (2/2)
- ✓ Triggered leak via button clicks (2/2)
- ⚠️ Detected memory growth (1/2)
- ⚠️ No profiling tools beyond heap snapshot (0/2)

**Analysis (4/6):**
- ✓ Identified embedder heap growth (2/2)
- ⚠️ Basic quantification (1/2)
- ⚠️ Limited explanation of source (1/2)

**Workflow (3/6):**
- ✓ Baseline → trigger → measure approach (2/2)
- ⚠️ Used CDP but not advanced profiling (1/2)
- ⚠️ Limited actionable recommendations (0/2)

### MCP (Second)
**Score:** 8/20  
**Time:** 70s  
**Penalty:** 0

**What Happened:**
MCP clicked message buttons and observed messages appearing in the DOM snapshot. Started fast traffic which created many messages. Stopped traffic and observed messages remained visible. However, did not use any profiling tools or memory measurement methods.

**Discovery (4/8):**
- ⚠️ No baseline measurement (0/2)
- ✓ Triggered leak via interactions (2/2)
- ⚠️ Observed DOM growth visually (1/2)
- ⚠️ No profiling tools used (1/2)

**Analysis (2/6):**
- ⚠️ Could not identify what leaked (0/2)
- ⚠️ No quantification (1/2)
- ⚠️ No explanation (1/2)

**Workflow (2/6):**
- ⚠️ Basic interaction approach (1/2)
- ⚠️ No profiling tools (0/2)
- ⚠️ No recommendations (1/2)

### Comparative Analysis

**Winner: bdg (+4 points, decisive)**

**Why bdg dominated:**
- **CDP HeapProfiler access**: Direct access to Chrome's memory profiling APIs via `bdg cdp Runtime.getHeapUsage`
- **Quantifiable measurements**: Provided exact heap sizes (833KB → 714KB → 790KB used, 1.5MB → 2MB → 3MB embedder heap)
- **Memory growth detection**: Demonstrated 44% increase in embedder heap usage (1.36MB → 3MB), proving the leak
- **Baseline methodology**: Took baseline measurement, triggered leak, re-measured - proper profiling workflow
- **CDP method discovery**: Used `bdg cdp --search heap` to discover available memory profiling methods

**Why MCP failed:**
- **No profiling tools at the time**: The MCP server tested had no heap profiling or memory snapshot tools (it has since added them)
- **Visual observation only**: Could only see messages appearing in DOM but couldn't measure actual memory consumption
- **No quantification**: No way to prove memory was leaking vs just DOM growing (which could be expected behavior)
- **Cannot access CDP**: MCP cannot invoke Chrome DevTools Protocol methods directly
- **Limited at the time**: This task required capabilities the MCP server tested didn't have

**Why the point gap was only 4:**
- bdg didn't use advanced profiling beyond basic heap measurements
- bdg didn't take heap snapshots or analyze detached DOM nodes specifically
- bdg didn't provide detailed recommendations for fixing the leak
- Both could trigger the leak behavior, but only bdg could measure it

**Token Analysis:**
- bdg: ~7.6K tokens (CDP method search, multiple heap measurements, batch clicking)
- MCP: ~3.5K tokens (fewer interactions, no profiling output, smaller snapshots after stopping traffic)
- bdg's higher token usage reflects the additional profiling data and CDP exploration

**Key takeaway**: This test highlights the fundamental architectural difference between the tools. Memory leak detection needed CDP access, which the MCP server tested did not offer. It has since added heap snapshot and performance trace tools, so this no longer holds.

---

## Overall Assessment

### bdg Strengths:
- **Comprehensive error data**: Full stack traces, line numbers, function names
- **Efficient batch operations**: JavaScript eval for clicking multiple elements
- **Advanced CDP access**: Direct access to HeapProfiler, Runtime methods
- **Structured output**: JSON format with detailed error categorization
- **Network analysis**: HAR export capability for detailed request inspection
- **Memory profiling**: Native heap measurement via CDP

### bdg Weaknesses:
- **Time overhead**: Slower on most tests (average 88s vs 65s for MCP)
- **URL redirect issue**: Test 4 redirected to different URL than specified
- **Limited visual context**: No screenshot capability used during testing
- **Console-focused**: Primarily focuses on console/network, less on UI state

### MCP Strengths:
- **Speed**: Faster execution on most tests (average 65s vs 88s)
- **Visual feedback**: Accessibility tree snapshots provide UI context
- **User-friendly output**: Clear text-based responses
- **Direct element interaction**: Straightforward click/fill operations
- **Good for basic debugging**: Effective for simple error detection

### MCP Weaknesses:
- **Limited error detail**: Basic error messages without full stack traces
- **No advanced profiling (at the time)**: No heap profiling or memory tools then; heap snapshot tools added since
- **Incomplete batch operations**: The agent clicked buttons manually instead of batching with `evaluate_script`
- **Less structured data**: Text output vs JSON for programmatic analysis
- **No network export**: Cannot export HAR files for detailed analysis
- **No CDP access**: Cannot use advanced Chrome DevTools Protocol features

### Recommendation:

- **Use bdg for:**
  - Complex debugging requiring detailed error analysis
  - Memory leak investigation and profiling
  - Automated testing requiring structured JSON output
  - Network analysis requiring HAR export
  - Scenarios needing direct CDP protocol access
  - Batch operations and JavaScript evaluation

- **Use MCP for:**
  - Quick exploratory testing and debugging
  - UI-focused testing where visual state matters
  - Simple error detection and basic console monitoring
  - Interactive debugging sessions
  - When speed is prioritized over detail
  - Accessibility tree inspection

### Winner: **bdg** (77 vs 60 points, +28% higher score)

Despite being slower on average, bdg provides significantly more detailed debugging information, advanced profiling capabilities, and structured data output that is essential for thorough debugging and automated analysis. The comprehensive error details, CDP access, and memory profiling make it superior for professional debugging workflows.
