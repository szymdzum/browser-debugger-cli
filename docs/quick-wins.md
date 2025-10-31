# Quick Wins - Immediate BDG Improvements

This document outlines the **top 3 improvements** that would have the biggest impact with minimal effort, based on real-world usage evaluation.

---

## 1. Status Command ⭐

**What:** Show current session information without stopping collection

**Why:** Currently, there's no way to see if the session is running, what tab it's monitoring, or how much data has been collected.

**Command:**
```bash
bdg status
```

**Example Output:**
```
Session Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status:           ACTIVE ✓
PID:              12345
Duration:         2m 34s

Target Tab
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
URL:              http://localhost:3000/customer/signin
Title:            Zaloguj się - Castorama

Collection Stats
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Network:          127 requests (3 failed)
Console:          45 messages (3 errors)
Collectors:       network, console, dom
```

**Implementation Effort:** 2-3 hours
**User Impact:** HIGH - Solves the biggest pain point

---

## 2. Live Data Preview ⭐⭐⭐

**What:** View collected data without stopping the session

**Why:** Currently have to stop the entire session to see what was collected. This means losing the ability to continue collecting data.

**Commands:**
```bash
bdg network              # Show last 10 network requests
bdg network --all        # Show all requests
bdg network --failed     # Show only 4xx/5xx responses

bdg console              # Show last 20 console messages
bdg console --errors     # Show only errors
```

**Example Output:**
```
Recent Network Requests (last 10)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
200 GET  /api/products          2.3s  json
401 POST /oauth/token           1.2s  json  ❌
500 POST /api/checkout          3.1s  json  ❌
200 GET  /images/logo.png       0.5s  png
...
```

**Implementation Effort:** 4-6 hours
**User Impact:** CRITICAL - Enables debugging while maintaining collection

**Technical Approach:**
- Write collected data to temp file incrementally during session
- Read from temp file for preview commands
- Use same format as final output for consistency

---

## 3. Auto-Cleanup Stale Sessions ⭐⭐

**What:** Automatically detect and clean up dead sessions

**Why:** Stale PID files from crashed sessions prevent starting new sessions. Currently requires manual cleanup.

**Current Behavior (Bad):**
```bash
$ bdg start localhost:3000
Error: Session already running (PID 12345). Stop it with: bdg stop

$ bdg stop
Error: Session process (PID 12345) is not running
# User is now stuck - must manually delete ~/.bdg/session.pid
```

**Improved Behavior:**
```bash
$ bdg start localhost:3000
Warning: Found stale session (PID 12345 not running)
Cleaning up old session...
Starting new session... ✓
```

**Implementation Effort:** 1-2 hours
**User Impact:** MEDIUM - Eliminates frustrating edge case

**Changes:**
1. Check if PID is alive before throwing error in `acquireSessionLock()`
2. Auto-cleanup if process is dead
3. Optionally offer to kill running session with confirmation

---

## Implementation Order

### Week 1: Status Command
- Lowest effort, highest immediate value
- Provides visibility into active sessions
- Foundation for other improvements

### Week 2: Auto-Cleanup
- Quick win that eliminates frustration
- Makes tool more robust and reliable
- Improves user experience significantly

### Week 3-4: Live Data Preview
- Highest effort but most impactful
- Enables true live debugging workflow
- Complements existing `bdg query` feature

---

## Success Metrics

After implementing these 3 features, we should see:

1. **Reduced restarts** - Auto-cleanup eliminates need to manually fix stuck sessions
2. **Faster debugging** - Live preview enables checking data without stopping
3. **Better confidence** - Status command shows collection is working
4. **Fewer questions** - "Is it working?" answered by `bdg status`

---

## Bonus: Enhanced Error Messages

**Effort:** 1 hour
**Impact:** Medium

While implementing the above, also improve error messages:

```bash
# Before
$ bdg stop
Error: No active session found

# After
$ bdg stop
Error: No active session found

💡 Suggestions:
  Start a new session:     bdg <url>
  Check running sessions:  bdg status
  List Chrome tabs:        bdg tabs
```

This is easy to add and significantly improves user experience.

---

## Testing Plan

For each feature:

1. **Manual Testing**
   - Start session
   - Test command
   - Verify output
   - Test edge cases (no session, crashed session, etc.)

2. **Integration Testing**
   - Full workflow: start → status → preview → stop
   - Error scenarios
   - Multiple tabs

3. **Documentation**
   - Update README with new commands
   - Add examples to help text
   - Update CLAUDE.md with new features

---

## Next Steps

1. Review this document
2. Agree on implementation order
3. Create GitHub issues for each feature
4. Implement in priority order
5. Test and document
6. Release new version

Questions? Feedback? Let's discuss!
