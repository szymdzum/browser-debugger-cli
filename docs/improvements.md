# BDG Improvements & Future Enhancements

This document outlines potential improvements to the Browser Debugger CLI (bdg) tool based on real-world usage and user feedback.

## Table of Contents

- [Session Evaluation Summary](#session-evaluation-summary)
- [High Priority Improvements](#high-priority-improvements)
- [Medium Priority Improvements](#medium-priority-improvements)
- [Low Priority Improvements](#low-priority-improvements)
- [Implementation Notes](#implementation-notes)

---

## Session Evaluation Summary

### What Went Well ✅

1. **Live Query Feature** - Successfully implemented during active session
   - Allows real-time page inspection without stopping collection
   - Example: `bdg query "document.querySelector('input[type=\"email\"]').value"`
   - Enabled debugging while maintaining data collection

2. **Session Persistence** - Background collection worked reliably
   - No data loss during user interactions
   - Continuous capture of network/console/DOM events

3. **Chrome Auto-Launch** - Seamless browser setup
   - Automatic detection of running Chrome instances
   - Clean launch with debugging enabled

4. **Root Cause Analysis** - Successfully identified login issues
   - OAuth endpoint detection
   - Error message capture
   - Analytics event tracking

### What Went Wrong ❌

1. **Session Data Visibility** - Biggest pain point
   - Network and console data only available after stopping session
   - No way to preview collected data during active session
   - Blind trust that data is being captured

2. **Session Management Issues**
   - `bdg stop` occasionally failed with "No active session"
   - Stale PID files caused conflicts
   - Multiple restarts needed to connect to correct tab
   - Data loss on unexpected session termination

3. **Tab Confusion**
   - Unclear which browser tab was being monitored
   - "Found existing tab" message misleading
   - Initial connection to wrong page (homepage vs signin)

4. **No Live Status Information**
   - Unable to see collection progress
   - No indication of captured request count
   - No error count visibility during session

---

## High Priority Improvements

### 1. Status Command

**Priority:** CRITICAL
**Effort:** Low
**Impact:** High

Add a `bdg status` command to show current session state without stopping collection.

```bash
bdg status
```

**Output:**
```
Session Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status:           ACTIVE
PID:              12345
Chrome PID:       12346
Duration:         2m 34s
Port:             9222

Target Tab
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
URL:              http://localhost:3000/customer/signin
Title:            Zaloguj się - Castorama

Collection Stats
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Network:          127 requests (3 failed)
Console:          45 messages (3 errors, 12 warnings)
Collectors:       network, console, dom
```

**Implementation:**
- Read session metadata from `~/.bdg/session.json` metadata file
- Query CDP for current tab info
- Connect to running session and count collected items
- Format output with colored sections

---

### 2. Live Data Preview

**Priority:** CRITICAL
**Effort:** Medium
**Impact:** High

Allow viewing collected data without stopping the session.

```bash
# View network requests
bdg network                    # Show last 10 requests
bdg network --all              # Show all captured requests
bdg network --failed           # Show only failed requests (4xx/5xx)
bdg network --filter "api"     # Filter by URL pattern

# View console logs
bdg console                    # Show last 20 messages
bdg console --errors           # Show only errors
bdg console --warnings         # Show warnings and errors
bdg console --all              # Show all messages

# View both
bdg data                       # Summary of all collected data
```

**Example Output (network):**
```
Recent Network Requests (last 10)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
200 GET  /api/products          2.3s  application/json
200 GET  /api/cart              0.8s  application/json
401 POST /oauth/token           1.2s  application/json  ❌
200 GET  /images/logo.png       0.5s  image/png
500 POST /api/checkout          3.1s  application/json  ❌
...
```

**Implementation:**
- Maintain shared memory/file for live data access
- Write incremental updates to temp file during collection
- Read from temp file without stopping session
- Use `tail -f` style streaming for real-time view

---

### 3. Better Session Cleanup

**Priority:** HIGH
**Effort:** Low
**Impact:** Medium

Automatically detect and clean up stale sessions.

**Features:**
- Auto-cleanup on `bdg start` if PID is dead
- Graceful handling of crashed sessions
- Session recovery with partial data
- Clear error messages with suggestions

```bash
# Current behavior (bad)
$ bdg start localhost:3000
Error: Session already running (PID 12345). Stop it with: bdg stop

# Improved behavior
$ bdg start localhost:3000
Warning: Found stale session (PID 12345 not running)
Cleaning up old session...
Starting new session...
✓ Connected to http://localhost:3000
```

**Implementation:**
- Check if PID is alive before throwing error
- Automatically cleanup if process is dead
- Offer to kill old session if it's still running
- Save partial data before cleanup

---

### 4. Partial Data Export

**Priority:** HIGH
**Effort:** Medium
**Impact:** Medium

Export specific data types without stopping the entire session.

```bash
bdg export network > requests.json      # Export network data only
bdg export console > logs.json          # Export console data only
bdg export dom > dom.html               # Export DOM snapshot
bdg snapshot                            # Save all data without stopping
```

**Use Cases:**
- Quick analysis of network requests while session continues
- Share console errors with team without ending debug session
- Take DOM snapshot at specific point in time
- Create checkpoints during long debugging sessions

**Implementation:**
- Read from shared data file (same as live preview)
- Format output as JSON matching final output structure
- Allow continuing collection after export
- Optionally clear exported data from memory

---

## Medium Priority Improvements

### 5. Tab Management

**Priority:** MEDIUM
**Effort:** Medium
**Impact:** Medium

Better visibility and control over which browser tabs are being monitored.

```bash
bdg tabs                           # List all available tabs
bdg tabs --monitored               # Show currently monitored tab
bdg attach <tab-id>                # Attach to specific tab by ID
bdg attach --url "signin"          # Attach to tab matching URL pattern
bdg switch <tab-id>                # Switch monitoring to different tab
```

**Example Output:**
```
Available Chrome Tabs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[1] ● http://localhost:3000/signin       (Monitored)
[2]   http://localhost:3000/dashboard
[3]   https://github.com/user/repo
[4]   chrome://extensions

Use: bdg attach <id> to switch monitoring
```

---

### 6. Real-Time Streaming

**Priority:** MEDIUM
**Effort:** High
**Impact:** Medium

Stream events in real-time as they happen (like `tail -f`).

```bash
bdg stream console                 # Stream console messages
bdg stream network                 # Stream network requests
bdg stream --errors                # Stream only errors
bdg stream --filter "api"          # Stream filtered events
```

**Example Output:**
```
Streaming console messages (Ctrl+C to stop)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[17:45:23] LOG   App initialized
[17:45:24] WARN  Missing API key
[17:45:25] ERROR Failed to fetch /api/data
           → NetworkError: fetch failed
[17:45:26] LOG   Retrying request...
```

**Implementation:**
- WebSocket or SSE for real-time updates from CDP
- Colored output for different log levels
- Filters and search during streaming
- Timestamped entries

---

### 7. Query Shortcuts

**Priority:** MEDIUM
**Effort:** Low
**Impact:** Low

Predefined shortcuts for common queries.

```bash
bdg get email                      # document.querySelector('input[type="email"]').value
bdg get password                   # document.querySelector('input[type="password"]').value
bdg get errors                     # Array.from(document.querySelectorAll('.error'))
bdg get title                      # document.title
bdg get url                        # window.location.href
bdg get cookies                    # document.cookie
```

**Implementation:**
- Map of predefined queries in config file
- Allow custom shortcuts in `~/.bdgrc`
- Fallback to custom query if shortcut not found

---

### 8. Session Annotations

**Priority:** MEDIUM
**Effort:** Low
**Impact:** Low

Add timeline markers during debugging.

```bash
bdg mark "User clicked login button"
bdg mark "Form validation error"
bdg mark "API request started"
bdg notes                          # View all annotations with timestamps
```

**Example Output:**
```
Session Annotations
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
00:23  User clicked login button
00:45  Form validation error
01:12  API request started
01:15  Received 401 response
```

**Use Cases:**
- Mark important events during manual testing
- Correlate user actions with network/console events
- Create test case documentation
- Share timeline with team

---

### 9. Enhanced Error Messages

**Priority:** MEDIUM
**Effort:** Low
**Impact:** Medium

Provide helpful suggestions when errors occur.

```bash
# Current
$ bdg stop
Error: No active session found

# Improved
$ bdg stop
Error: No active session found

Possible solutions:
  • Start a new session:     bdg <url>
  • Check running sessions:  bdg status
  • List Chrome tabs:        bdg tabs

Troubleshooting:
  • Ensure Chrome is running with debugging enabled
  • Check port 9222 is not blocked by firewall
```

---

## Low Priority Improvements

### 10. Multiple Session Support

**Priority:** LOW
**Effort:** High
**Impact:** Low

Run multiple bdg sessions simultaneously.

```bash
bdg start <url> --session login
bdg start <url2> --session checkout
bdg query "..." --session login
bdg stop login
```

**Use Cases:**
- Monitor multiple tabs/pages simultaneously
- Compare behavior across different environments
- Parallel testing scenarios

---

### 11. Performance Metrics

**Priority:** LOW
**Effort:** High
**Impact:** Low

Automatic performance tracking.

```bash
bdg perf                           # Show performance summary
```

**Metrics:**
- Page load time (DOMContentLoaded, load events)
- First Contentful Paint (FCP)
- Largest Contentful Paint (LCP)
- Time to Interactive (TTI)
- Network waterfall visualization
- Memory usage over time

---

### 12. Filtering & Search

**Priority:** LOW
**Effort:** Medium
**Impact:** Medium

Advanced filtering for collected data.

```bash
bdg network --filter "api.kingfisher"      # URL pattern match
bdg network --status 400-599               # Status code range
bdg network --method POST                  # HTTP method
bdg network --type xhr                     # Request type
bdg console --grep "error"                 # Text search
bdg console --level error                  # By log level
```

---

### 13. Diff Mode

**Priority:** LOW
**Effort:** Medium
**Impact:** Low

Compare two debugging sessions.

```bash
bdg diff session1.json session2.json

# Show differences:
# - Network requests that only appear in one session
# - Different response codes for same endpoint
# - Console errors that are new/fixed
```

---

### 14. Configuration File

**Priority:** LOW
**Effort:** Low
**Impact:** Low

Support for `.bdgrc` configuration file.

```json
{
  "port": 9222,
  "timeout": 30,
  "collectors": ["network", "console", "dom"],
  "shortcuts": {
    "email": "document.querySelector('input[type=\"email\"]').value",
    "errors": "document.querySelectorAll('.error')"
  },
  "filters": {
    "network": {
      "exclude": ["google-analytics.com", "doubleclick.net"]
    }
  }
}
```

---

## Implementation Notes

### Architecture Considerations

1. **Shared Data Storage**
   - Need persistent storage for live data access
   - Options: SQLite, shared memory, JSON file with incremental writes
   - Trade-offs: Performance vs complexity

2. **Process Communication**
   - Current: Signals (SIGINT/SIGTERM)
   - Needed: Bidirectional communication for live queries
   - Options: Unix sockets, TCP, shared files

3. **Session State Management**
   - Current: Simple PID file
   - Needed: Rich metadata (tab info, stats, annotations)
   - Format: JSON metadata file alongside PID

### Testing Strategy

1. **Unit Tests**
   - Test each command in isolation
   - Mock CDP responses
   - Verify data collection logic

2. **Integration Tests**
   - Full workflow tests (start → collect → query → stop)
   - Multi-tab scenarios
   - Error recovery scenarios

3. **Manual Testing**
   - Real browser interaction
   - Performance under load
   - Edge cases (tab closure, navigation, crashes)

### Backward Compatibility

- Maintain existing command API
- New features should be opt-in
- Graceful degradation for missing features
- Clear deprecation warnings for removed features

---

## Prioritization Matrix

| Feature | Priority | Effort | Impact | Impl. Order |
|---------|----------|--------|--------|-------------|
| Status Command | CRITICAL | Low | High | 1 |
| Live Data Preview | CRITICAL | Medium | High | 2 |
| Session Cleanup | HIGH | Low | Medium | 3 |
| Partial Export | HIGH | Medium | Medium | 4 |
| Tab Management | MEDIUM | Medium | Medium | 5 |
| Enhanced Errors | MEDIUM | Low | Medium | 6 |
| Query Shortcuts | MEDIUM | Low | Low | 7 |
| Annotations | MEDIUM | Low | Low | 8 |
| Streaming | MEDIUM | High | Medium | 9 |
| Multiple Sessions | LOW | High | Low | 10 |
| Performance Metrics | LOW | High | Low | 11 |
| Filtering | LOW | Medium | Medium | 12 |
| Diff Mode | LOW | Medium | Low | 13 |
| Config File | LOW | Low | Low | 14 |

---

## Next Steps

1. **Immediate (This Week)**
   - Implement `bdg status` command
   - Add automatic stale session cleanup
   - Improve error messages

2. **Short Term (This Month)**
   - Live data preview (`bdg network`, `bdg console`)
   - Partial export functionality
   - Tab management improvements

3. **Long Term (Next Quarter)**
   - Real-time streaming
   - Performance metrics
   - Multiple session support

---

## Contributing

If you'd like to contribute to implementing these improvements:

1. Pick an improvement from the list
2. Create an issue on GitHub
3. Discuss implementation approach
4. Submit a pull request

For questions or suggestions, please open an issue!
