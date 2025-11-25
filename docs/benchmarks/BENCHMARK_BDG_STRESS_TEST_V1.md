# bdg Agent Stress Test Benchmark v2.0

**Purpose**: Stress test both bdg capabilities AND agent reasoning/discovery skills across real-world scenarios.

**Philosophy**:
- Real sites, real complexity, no synthetic tests
- Agent must discover commands through bdg's self-documentation
- Tests measure tool proficiency AND agent problem-solving
- No pre-scripted commands - only goals and success criteria

---

## Benchmark Rules

### Discovery Constraints

The agent MUST discover bdg capabilities using only:
1. `bdg --help --json` - Machine-readable CLI structure
2. `bdg cdp --list` - List all CDP domains
3. `bdg cdp <Domain> --list` - List domain methods
4. `bdg cdp <Method> --describe` - Get method schema
5. `bdg cdp --search <term>` - Search across CDP

**Forbidden**: External documentation, web searches for bdg usage, or pre-existing knowledge of bdg commands.

### Timing

Each test has a time budget. The timer starts when the agent receives the task and ends when the agent reports completion or gives up.

---

## Test Categories

| Category | Tests | Focus Areas |
|----------|-------|-------------|
| A. DOM Stress | 5 | Large DOMs, Shadow DOM, iframes, dynamic content |
| B. Network Stress | 5 | High traffic, WebSockets, large payloads, streaming |
| C. Console & Errors | 4 | Error storms, source maps, async errors |
| D. CDP Direct Access | 4 | Profiling, debugging, advanced domains |
| E. Session Resilience | 4 | Long sessions, recovery, edge cases |
| F. Real-World Workflows | 4 | E2E scenarios combining multiple features |

**Total: 26 tests**

---

## Metrics to Capture

For each test, record:

| Metric | Description |
|--------|-------------|
| bdg version | Version being tested |
| Time to first command | How long before agent ran first bdg command |
| Discovery commands used | Which help/list/describe commands were used |
| Total commands executed | Count of all bdg invocations |
| Retry/recovery attempts | Times agent adapted after failure |
| Token usage (input) | Approximate input tokens consumed |
| Token usage (output) | Approximate output tokens consumed |
| Task success | Did agent achieve the goal? |
| Errors encountered | bdg errors and how agent handled them |
| Novel approaches | Did agent find unexpected solutions? |

---

## Category A: DOM Stress Tests

### A1. Infinite Scroll Performance

**Site**: https://www.reddit.com/
**Goal**: Measure how DOM query performance changes as page grows via scrolling
**Time Budget**: 5 minutes

**Objectives** (describe, don't prescribe):
1. Start a session on Reddit
2. Measure the initial DOM size (element count)
3. Find and count the post containers
4. Trigger page scrolling to load more content (at least 5 scroll cycles)
5. Re-measure DOM size and post count after scrolling
6. Test query performance on the now-larger DOM
7. Access a specific element by index from a large result set
8. End the session cleanly

**Success Criteria**:
- [ ] Agent discovered how to start a session
- [ ] Agent found a way to measure DOM element count
- [ ] Agent figured out how to trigger scrolling
- [ ] Agent identified the correct selector for posts
- [ ] Final measurements show DOM growth
- [ ] Large result set handled without crash/timeout

**Agent Observation Points**:
- Did agent use `--help --json` to discover commands?
- How did agent approach the "scroll" problem? (hint: there may not be a scroll command)
- Did agent handle large query results gracefully?
- What recovery strategies did agent use if something failed?

**Known Challenges**:
- bdg may not have a built-in scroll command
- Agent must discover JavaScript evaluation capabilities
- Large result sets may need pagination or limiting

---

### A2. Shadow DOM Traversal

**Site**: https://github.com/anthropics/anthropic-cookbook/blob/main/misc/prompt_caching.ipynb
**Goal**: Test ability to detect and interact with Shadow DOM elements
**Time Budget**: 3 minutes

**Objectives**:
1. Start a session on the GitHub page
2. Query for visible code blocks
3. Identify custom elements (GitHub uses web components)
4. Attempt to access Shadow DOM content
5. Get accessibility information for shadow elements
6. Attempt to click elements that may be in shadow roots
7. End session

**Success Criteria**:
- [ ] Agent identified presence of custom elements
- [ ] Agent attempted shadow root access (success or documented limitation)
- [ ] Agent used accessibility tree as alternative
- [ ] Agent understood and reported any cross-shadow limitations

**Agent Observation Points**:
- Did agent recognize shadow DOM from query results?
- How did agent attempt to pierce shadow boundaries?
- Did agent discover accessibility commands as workaround?

**Known Challenges**:
- Shadow DOM access may be limited by browser security
- Agent needs to recognize when something is a custom element

---

### A3. Nested Iframes

**Site**: https://codesandbox.io/p/sandbox/react-new
**Goal**: Test iframe detection and understand cross-origin limitations
**Time Budget**: 4 minutes

**Objectives**:
1. Start a session (site is heavy, may need longer timeout)
2. Wait for the application to fully load
3. Count and enumerate all iframes on the page
4. Identify iframe sources and names
5. Query the main page DOM (code editor)
6. Attempt to access iframe content (expect limitations)
7. Check network traffic for iframe resource loading
8. Check console for any cross-origin errors
9. End session

**Success Criteria**:
- [ ] Agent correctly counted iframes
- [ ] Agent understood cross-origin limitations
- [ ] Agent checked network for iframe resources
- [ ] Agent reported limitations clearly

**Agent Observation Points**:
- Did agent anticipate cross-origin issues?
- How did agent discover iframe-related capabilities?
- Did agent use network/console to understand iframe behavior?

---

### A4. Complex Form Interaction

**Site**: https://checkout.stripe.dev/preview
**Goal**: Test form interaction with iframes, validation, and dynamic fields
**Time Budget**: 5 minutes

**Objectives**:
1. Start a session and wait for Stripe checkout to load
2. Analyze the form structure (identify iframes vs regular inputs)
3. Fill fields that are outside iframes
4. Verify the fill worked by reading back values
5. Identify Stripe Elements iframes
6. Understand and document limitations for iframe-embedded fields
7. Check console for Stripe SDK messages
8. Check network for Stripe API communications
9. End session

**Success Criteria**:
- [ ] Agent distinguished iframe fields from regular fields
- [ ] Agent successfully filled accessible fields
- [ ] Agent documented iframe limitations
- [ ] Agent found Stripe network traffic

**Agent Observation Points**:
- How did agent identify which fields are in iframes?
- Did agent try multiple approaches for iframe fields?
- How did agent verify form fills worked?

---

### A5. Large Table Extraction

**Site**: https://en.wikipedia.org/wiki/List_of_countries_by_population_(United_Nations)
**Goal**: Query and extract data from large table structures efficiently
**Time Budget**: 3 minutes

**Objectives**:
1. Start a session on the Wikipedia page
2. Count total table rows
3. Query all table rows (expect 200+)
4. Extract specific row content by index
5. Extract column data (e.g., country names) programmatically
6. Test a complex CSS selector query
7. Measure/note performance on large result sets
8. End session

**Success Criteria**:
- [ ] Agent handled 200+ element query
- [ ] Agent extracted specific data from table
- [ ] Complex selectors worked correctly
- [ ] Agent managed output size appropriately

**Agent Observation Points**:
- Did agent limit result sets to avoid token explosion?
- How did agent approach bulk data extraction?
- Did agent use eval vs query appropriately?

---

## Category B: Network Stress Tests

### B1. High Traffic Capture

**Site**: https://www.nytimes.com
**Goal**: Test network capture under high request volume (100+ requests)
**Time Budget**: 4 minutes

**Objectives**:
1. Start a session on NYTimes
2. Wait for page to fully load (many resources)
3. Check how many network requests were captured
4. Filter network requests by type (documents, scripts, images, XHR)
5. Export network data to HAR format
6. Verify HAR file contains expected data
7. Check for failed requests (4xx, 5xx)
8. Navigate to another page and verify capture continues
9. End session

**Success Criteria**:
- [ ] Agent captured 100+ requests
- [ ] Agent successfully filtered by resource type
- [ ] HAR export worked and contained data
- [ ] Navigation didn't break capture

**Agent Observation Points**:
- Did agent discover HAR export capability?
- How did agent filter network requests?
- Did agent verify the HAR file contents?

---

### B2. WebSocket Detection

**Site**: https://www.tradingview.com/chart/
**Goal**: Detect and understand WebSocket connections
**Time Budget**: 5 minutes

**Objectives**:
1. Start a session (real-time trading site)
2. Wait for WebSocket connections to establish
3. Check standard network requests
4. Look for WebSocket upgrade requests
5. Explore CDP methods related to WebSocket
6. Check console for WebSocket-related logs
7. Monitor network in real-time briefly
8. End session

**Success Criteria**:
- [ ] Agent detected WebSocket connections
- [ ] Agent explored relevant CDP domains
- [ ] Agent understood WebSocket capabilities/limitations
- [ ] Real-time monitoring worked

**Agent Observation Points**:
- Did agent search CDP for websocket methods?
- How did agent distinguish WS from regular HTTP?
- Did agent discover follow/streaming modes?

---

### B3. Large Response Bodies

**Site**: Custom data URL with API fetches
**Goal**: Test capture of large JSON response bodies
**Time Budget**: 3 minutes

**Objectives**:
1. Start a session with a page that fetches large JSON (e.g., jsonplaceholder photos endpoint - 5000 items)
2. Wait for the fetch to complete
3. View the network request
4. Retrieve the response body
5. Check body size handling
6. Trigger additional large fetches
7. Export to HAR and verify bodies included
8. End session

**Success Criteria**:
- [ ] Agent captured large response bodies
- [ ] Agent retrieved body content successfully
- [ ] HAR included body data
- [ ] No crashes from large payloads

**Agent Observation Points**:
- Did agent discover body size limits?
- How did agent trigger additional requests?
- Did agent use details command for body access?

---

### B4. Streaming Responses (SSE)

**Site**: Custom data URL with Server-Sent Events
**Goal**: Test handling of streaming/long-lived connections
**Time Budget**: 3 minutes

**Objectives**:
1. Start a session with a page using EventSource (e.g., Wikimedia recent changes stream)
2. Wait for streaming events to arrive
3. Check how streaming connection appears in network
4. Check console for any SSE-related output
5. Verify DOM updates from streaming data
6. End session cleanly (with active stream)

**Success Criteria**:
- [ ] Agent detected streaming connection
- [ ] DOM updates from stream visible
- [ ] Clean shutdown with active stream
- [ ] Agent understood streaming behavior

**Agent Observation Points**:
- Did agent recognize the EventSource pattern?
- How did agent verify streaming was working?
- Did agent handle the active connection on shutdown?

---

### B5. Request Interception via CDP

**Site**: https://example.com
**Goal**: Test low-level request interception using CDP Fetch domain
**Time Budget**: 4 minutes

**Objectives**:
1. Start a session
2. Discover CDP Fetch domain capabilities
3. Enable request interception
4. Understand how paused requests work
5. Trigger new requests to test interception
6. Properly disable interception
7. End session

**Success Criteria**:
- [ ] Agent discovered Fetch.enable method
- [ ] Agent understood interception patterns
- [ ] Agent handled paused request implications
- [ ] Clean disable and shutdown

**Agent Observation Points**:
- How did agent discover interception capabilities?
- Did agent understand the consequences of pausing requests?
- Did agent properly clean up?

**Known Challenges**:
- Unhandled paused requests will block the page
- Agent must understand request lifecycle

---

## Category C: Console & Error Tests

### C1. Error Storm

**Site**: https://microsoftedge.github.io/Demos/devtools-explain-error/
**Goal**: Test console capture under high error volume
**Time Budget**: 4 minutes

**Objectives**:
1. Start a session on the error demo page
2. Trigger all error buttons to generate many errors rapidly
3. Check total console message count
4. Get all captured errors
5. Filter errors by severity level
6. Check if deduplication is working
7. Get details on specific errors (stack traces)
8. Test real-time console streaming briefly
9. End session

**Success Criteria**:
- [ ] Agent triggered all errors
- [ ] Agent captured all error types
- [ ] Deduplication observed and understood
- [ ] Stack traces preserved

**Agent Observation Points**:
- How did agent trigger multiple errors?
- Did agent discover console filtering options?
- Did agent use details command for stack traces?

---

### C2. Source-Mapped Errors

**Site**: https://react.dev/learn
**Goal**: Test error capture in production React app with source maps
**Time Budget**: 3 minutes

**Objectives**:
1. Start a session on React docs
2. Inject a JavaScript error
3. Check console for the error
4. Get error details and inspect stack trace
5. Check for React-specific warnings
6. Navigate to a different page
7. Verify console history persists across navigation
8. End session

**Success Criteria**:
- [ ] Injected error captured
- [ ] Stack trace accessible
- [ ] React warnings captured
- [ ] History preserved across navigation

**Agent Observation Points**:
- How did agent inject the error?
- Did agent discover history flag for navigation?
- Did agent notice source-mapped vs raw locations?

---

### C3. Rich Object Logging

**Site**: Custom data URL with complex console output
**Goal**: Test capture of complex objects, console.table, console.dir
**Time Budget**: 3 minutes

**Objectives**:
1. Start a session with a page that logs complex objects (nested objects, arrays, classes, console.table, console.dir, console.group)
2. Check all console messages captured
3. Get details on complex object messages
4. Check if nested values are accessible
5. Check console.table output format
6. Check console.dir output
7. End session

**Success Criteria**:
- [ ] Nested objects captured with structure
- [ ] console.table data accessible
- [ ] console.dir output meaningful
- [ ] console.group structure visible

**Agent Observation Points**:
- Did agent discover how to view complex objects?
- How did agent access nested data?
- Did agent understand different console method outputs?

---

### C4. Async Error Tracking

**Site**: Custom data URL with async error patterns
**Goal**: Test capture of various async error types
**Time Budget**: 3 minutes

**Objectives**:
1. Start a session with a page that has:
   - Unhandled Promise rejection
   - Async/await error
   - setTimeout error
   - Event handler error
2. Wait for async errors to fire
3. Trigger event-based error (click)
4. Capture all errors
5. Verify different error types captured
6. Get details on each error type
7. End session

**Success Criteria**:
- [ ] Promise rejection captured
- [ ] Async/await error captured
- [ ] setTimeout error captured
- [ ] Event handler error captured

**Agent Observation Points**:
- Did agent understand async error patterns?
- How did agent trigger the event error?
- Did agent differentiate error types?

---

## Category D: CDP Direct Access Tests

### D1. Memory Profiling

**Site**: https://microsoftedge.github.io/Demos/detached-elements/
**Goal**: Use HeapProfiler CDP domain for memory analysis
**Time Budget**: 6 minutes

**Objectives**:
1. Start a session on the memory leak demo
2. Discover HeapProfiler CDP methods
3. Enable heap profiling
4. Take a baseline heap snapshot
5. Get current heap statistics
6. Trigger memory allocations (click add buttons)
7. Get updated heap stats
8. Track allocations over time
9. Force garbage collection
10. Compare final vs initial state
11. End session

**Success Criteria**:
- [ ] Agent discovered HeapProfiler methods
- [ ] Heap snapshots completed
- [ ] Allocation tracking worked
- [ ] GC triggered successfully

**Agent Observation Points**:
- How did agent discover heap profiling?
- Did agent understand snapshot vs tracking?
- How did agent interpret heap statistics?

---

### D2. JavaScript Debugging

**Site**: https://example.com
**Goal**: Explore Debugger CDP domain capabilities
**Time Budget**: 5 minutes

**Objectives**:
1. Start a session
2. Discover Debugger CDP methods
3. Enable the debugger
4. Explore script enumeration
5. Inject code with debugger statement
6. Understand breakpoint APIs
7. Test pause/resume
8. Disable debugger cleanly
9. End session

**Success Criteria**:
- [ ] Agent discovered Debugger methods
- [ ] Enable/disable worked
- [ ] Pause/resume worked
- [ ] Agent understood debugging concepts

**Agent Observation Points**:
- Did agent find Debugger via search or list?
- How did agent handle paused state?
- Did agent clean up debugger state?

**Known Challenges**:
- Paused state can be tricky to handle
- Agent must resume before stopping

---

### D3. Performance Tracing

**Site**: https://react.dev/learn
**Goal**: Use Performance and Tracing CDP domains
**Time Budget**: 5 minutes

**Objectives**:
1. Start a session
2. Discover Performance domain methods
3. Enable performance metrics
4. Get current performance metrics
5. Start a trace
6. Perform actions to generate trace data
7. Stop the trace
8. Get final metrics
9. End session

**Success Criteria**:
- [ ] Performance metrics retrieved
- [ ] Trace start/stop worked
- [ ] Metrics showed meaningful values
- [ ] Agent understood tracing concepts

**Agent Observation Points**:
- Did agent discover both Performance and Tracing?
- How did agent configure trace categories?
- Did agent understand metrics vs tracing?

---

### D4. CSS Coverage

**Site**: https://tailwindcss.com/docs/installation
**Goal**: Use CSS CDP domain for coverage analysis
**Time Budget**: 4 minutes

**Objectives**:
1. Start a session (Tailwind has lots of CSS)
2. Discover CSS domain methods
3. Enable CSS domain
4. Explore stylesheet enumeration
5. Start CSS coverage tracking
6. Interact with the page
7. Stop coverage tracking
8. Retrieve coverage results
9. End session

**Success Criteria**:
- [ ] CSS domain methods discovered
- [ ] Coverage tracking worked
- [ ] Coverage data retrieved
- [ ] Agent understood coverage output

**Agent Observation Points**:
- How did agent find coverage-related methods?
- Did agent understand the coverage workflow?
- How did agent interpret coverage results?

---

## Category E: Session Resilience Tests

### E1. Long-Running Session

**Site**: https://www.youtube.com/watch?v=dQw4w9WgXcQ
**Goal**: Test session stability over extended period
**Time Budget**: 15 minutes

**Objectives**:
1. Start a session with extended timeout
2. Record initial memory state
3. Perform periodic health checks every 2 minutes:
   - Session status
   - Recent data peek
   - Console messages
   - Memory usage
4. Continue for 10 minutes minimum
5. Check final state comprehensively
6. End session and verify clean shutdown

**Success Criteria**:
- [ ] Session stayed connected 10+ minutes
- [ ] Health checks succeeded throughout
- [ ] Memory didn't grow unboundedly
- [ ] Clean shutdown

**Agent Observation Points**:
- Did agent set appropriate timeout?
- How did agent structure periodic checks?
- Did agent track memory trends?

---

### E2. Page Crash Recovery

**Site**: https://example.com then chrome://crash
**Goal**: Test behavior when Chrome tab crashes
**Time Budget**: 3 minutes

**Objectives**:
1. Start a normal session
2. Verify session works
3. Navigate to chrome://crash (or trigger crash)
4. Wait for crash to occur
5. Check session status (should detect crash)
6. Try to run commands (should fail gracefully)
7. Clean up and verify can start new session

**Success Criteria**:
- [ ] Crash detected
- [ ] Error messages were clear
- [ ] Cleanup succeeded
- [ ] New session startable

**Agent Observation Points**:
- How did agent attempt crash?
- Did agent recognize crash symptoms?
- How did agent handle error recovery?

**Known Challenges**:
- chrome:// URLs may be restricted
- Agent must find alternative crash method if needed

---

### E3. Network Error Handling

**Site**: https://jsonplaceholder.typicode.com/posts
**Goal**: Test behavior with network failures
**Time Budget**: 4 minutes

**Objectives**:
1. Start a session
2. Verify working state
3. Trigger requests that will fail/timeout
4. Check console for network errors
5. Verify failed requests appear in network log
6. Make successful requests after failures
7. Verify session remains stable
8. End session

**Success Criteria**:
- [ ] Network errors captured
- [ ] Failed requests in network log
- [ ] Session stayed stable
- [ ] Clean shutdown

**Agent Observation Points**:
- How did agent trigger network failures?
- Did agent check both console and network?
- Did agent verify recovery?

---

### E4. Concurrent Session Prevention

**Site**: Any page
**Goal**: Test session lock mechanism
**Time Budget**: 3 minutes

**Objectives**:
1. Start a session
2. Verify session is running
3. Attempt to start a second session (should fail)
4. Verify first session still works
5. Test force cleanup
6. Verify cleanup worked
7. Start new session to confirm

**Success Criteria**:
- [ ] Lock prevented concurrent sessions
- [ ] Error message explained situation
- [ ] Force cleanup worked
- [ ] New session startable after cleanup

**Agent Observation Points**:
- Did agent understand the lock mechanism?
- How did agent discover cleanup options?
- Did agent verify the lock was working?

---

## Category F: Real-World Workflow Tests

### F1. Complete Form Workflow

**Site**: https://demoqa.com/automation-practice-form
**Goal**: Fill and submit a complete form with various input types
**Time Budget**: 6 minutes

**Objectives**:
1. Start a session
2. Analyze the form structure
3. Fill text fields (name, email)
4. Handle radio buttons
5. Fill phone number
6. Handle date picker
7. Handle autocomplete inputs
8. Handle checkboxes
9. Fill textarea
10. Handle dropdown selects
11. Check for validation errors
12. Submit the form
13. Detect success state
14. End session

**Success Criteria**:
- [ ] All text fields filled
- [ ] Radio buttons selected
- [ ] Checkboxes checked
- [ ] Dropdowns selected
- [ ] Form submitted
- [ ] Success detected

**Agent Observation Points**:
- How did agent discover form interaction commands?
- Did agent handle React-controlled inputs?
- How did agent verify each step?

**Known Challenges**:
- React-controlled inputs may need special handling
- Custom components (date picker, autocomplete) may be tricky

---

### F2. SPA Navigation

**Site**: https://demo.realworld.io/
**Goal**: Navigate a single-page application and track state
**Time Budget**: 5 minutes

**Objectives**:
1. Start a session
2. Wait for initial app load
3. Record initial state (articles visible)
4. Navigate via client-side routing (click link)
5. Verify URL changed (hash routing)
6. Verify DOM updated
7. Fill a form on the new page
8. Submit and observe network call
9. Check console for errors
10. Navigate back to home
11. Verify state restored
12. End session

**Success Criteria**:
- [ ] SPA navigation worked
- [ ] DOM updates tracked
- [ ] Network captured AJAX calls
- [ ] Console captured any errors
- [ ] State changes observable

**Agent Observation Points**:
- Did agent understand SPA routing?
- How did agent verify DOM changes?
- Did agent check multiple data sources?

---

### F3. Canvas Interaction

**Site**: https://excalidraw.com/
**Goal**: Interact with canvas-based application
**Time Budget**: 5 minutes

**Objectives**:
1. Start a session (heavy app, need timeout)
2. Wait for app to fully load
3. Query for canvas element
4. Get canvas dimensions
5. Find and interact with toolbar buttons
6. Select a drawing tool
7. Attempt to simulate drawing on canvas
8. Check if interaction registered
9. Take a screenshot
10. Verify screenshot captured canvas
11. End session

**Success Criteria**:
- [ ] Canvas element found
- [ ] Toolbar interaction worked
- [ ] Drawing attempted (may not work)
- [ ] Screenshot captured canvas

**Agent Observation Points**:
- How did agent approach canvas interaction?
- Did agent discover screenshot capability?
- Did agent understand canvas limitations?

**Known Challenges**:
- Canvas events require specific coordinate handling
- Drawing may require complex event sequences

---

### F4. Secure Form Interaction

**Site**: https://github.com/login
**Goal**: Interact with security-sensitive form (no actual login)
**Time Budget**: 4 minutes

**Objectives**:
1. Start a session
2. Identify security features (CSRF tokens, etc.)
3. Query hidden form fields
4. Read CSRF token value
5. Fill username/email field
6. Fill password field
7. Verify fills worked
8. Check network for any preflight requests
9. Check console for CSP violations
10. DO NOT submit (avoid rate limiting)
11. End session

**Success Criteria**:
- [ ] Agent interacted with secure form
- [ ] Hidden fields found
- [ ] CSRF tokens readable
- [ ] No CSP violations caused

**Agent Observation Points**:
- Did agent find security-related elements?
- How did agent handle password fields?
- Did agent understand not to submit?

---

## Scoring Template

```markdown
# bdg Agent Stress Test Results

**Date**: YYYY-MM-DD
**bdg Version**: X.X.X
**Agent**: [Name/Model]
**Tester**:

## Summary

| Category | Tests Passed | Tests Failed | Agent Discovery Score | Notes |
|----------|--------------|--------------|----------------------|-------|
| A. DOM Stress | /5 | | /5 | |
| B. Network Stress | /5 | | /5 | |
| C. Console & Errors | /4 | | /4 | |
| D. CDP Direct Access | /4 | | /4 | |
| E. Session Resilience | /4 | | /4 | |
| F. Real-World Workflows | /4 | | /4 | |
| **TOTAL** | **/26** | | **/26** | |

## Agent Discovery Score Rubric

For each test, rate agent's discovery approach (0-1):
- **1.0**: Used self-documentation effectively, minimal trial-and-error
- **0.75**: Good discovery, some unnecessary commands
- **0.5**: Eventually found commands, but inefficient
- **0.25**: Heavy trial-and-error, many failures
- **0**: Failed to discover required commands

## Bugs Found

| ID | Category | Test | Description | Severity |
|----|----------|------|-------------|----------|
| 1 | | | | |

## Agent Behavior Observations

| ID | Category | Test | Observation | Impact |
|----|----------|------|-------------|--------|
| 1 | | | | |

## bdg Improvements Suggested

| ID | Category | Description | Priority |
|----|----------|-------------|----------|
| 1 | | | |

## Detailed Results

[Per-test details with command transcripts]
```

---

## Execution Notes

### Environment Setup

The agent should discover these itself, but evaluator can verify:
- Clean state before testing (no running sessions)
- bdg version
- Chrome availability

### Running Tests

- Execute tests in order (A1 -> F4)
- Allow 30s recovery between tests
- Clean up between categories
- Capture full command transcripts

### Evaluator Notes

When observing agent:
1. Note the FIRST command agent tries
2. Track discovery command usage (--help, --list, --describe)
3. Record adaptation strategies on failure
4. Note any creative/unexpected approaches
5. Time how long until agent achieves goal

---

**Version**: 2.0
**Created**: 2025-11-25
**Last Updated**: 2025-11-25
**Change**: Refactored to agent-centric benchmark (removed scripted commands)
