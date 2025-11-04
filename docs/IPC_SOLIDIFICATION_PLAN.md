# IPC System Solidification Plan

## Executive Summary

Comprehensive smoke testing of the IPC-based live streaming system identified **3 critical issues** and several areas for improvement. The system is fundamentally sound with good performance (70-83ms response times, 738ms for 10 rapid requests), but needs robustness improvements before production use.

## Smoke Test Results

### ✅ **Passing Tests** (16/19 - 84%)

**Performance:**
- Peek response time: 70-83ms (excellent)
- 10 rapid peeks: 738-845ms (excellent)
- Details response time: 79-83ms (excellent)

**Functionality:**
- ✓ Daemon lifecycle management
- ✓ Session lifecycle (start, worker spawn, metadata)
- ✓ Basic peek command
- ✓ Peek filters (--network, --console)
- ✓ Details for console messages
- ✓ Error handling for invalid IDs/indexes
- ✓ File system verification (no preview/full files created)

### ❌ **Critical Issues Found** (3 failures)

#### 1. Peek JSON Output Invalid ⚠️ CRITICAL
**Severity**: High  
**Impact**: Breaks JSON consumers (AI agents, scripts)

**Problem**: The peek --json output structure is malformed or incomplete  
**Test**: `bdg peek --json 2>&1 | jq -e '.preview.data'` fails

**Root Cause Investigation Needed:**
- Is the JSON structure missing `.preview.data`?
- Is it malformed (syntax error)?
- Is the IPC response not being properly transformed?

**Impact**:
- AI agents cannot parse preview data
- Automated scripts will fail
- JSON contracts are broken

---

#### 2. Peek Without Session Not Handled Properly ⚠️ MEDIUM
**Severity**: Medium  
**Impact**: Poor error messages confuse users

**Problem**: When no session is running, peek should return clear error, but doesn't  
**Test**: `bdg peek 2>&1 | grep -q -E "(No active|not running|Error)"` fails

**Root Cause**: Likely returning success with empty data instead of error status

**Impact**:
- Users get confusing "no data" instead of "no session"
- Unclear whether the issue is session not running vs no data collected
- Poor UX

---

#### 3. Daemon Start Detection ⚠️ LOW
**Severity**: Low  
**Impact**: Test infrastructure issue, not runtime issue

**Problem**: Test expects "Daemon not running" message on first command  
**Reality**: Daemon was already running from previous test

**This is a test artifact, not a real issue.**

---

## Performance Analysis

### Response Time Benchmarks
| Operation | Average | Target | Status |
|-----------|---------|--------|--------|
| Peek | 70-74ms | < 1000ms | ✅ Excellent |
| Details | 79-83ms | < 1000ms | ✅ Excellent |
| 10x Rapid Peek | 738-845ms | < 5000ms | ✅ Excellent |

### Bottlenecks Observed

**None identified during smoke testing**. The IPC system is fast and responsive.

**Potential Future Bottlenecks** (not observed yet):
1. Large number of network requests (>1000) might slow peek
2. Concurrent details requests from multiple clients
3. Worker stdin/stdout buffer saturation under high load

---

## Issues From Development Investigation

### 4. Type Field Collision (FIXED ✅)
**Status**: Fixed in PR #12  
**Problem**: IPC envelope `type` field collided with `worker_details` command `type` parameter  
**Solution**: Renamed to `itemType`

### 5. Dead Code: handlePeekRequest
**Status**: Needs cleanup  
**Problem**: Special `handlePeekRequest` in daemon is dead code (never reached due to isCommandRequest check)  
**Impact**: Code confusion, maintenance burden  
**Action**: Remove in follow-up PR

---

## Solidification Plan

### Priority 1: Critical Fixes (Required for Production)

#### Fix 1.1: Repair Peek JSON Output Structure
**Deadline**: Immediate  
**Effort**: 1-2 hours

**Actions**:
1. Investigate peek --json output format
2. Compare daemon response vs expected PeekResponse structure
3. Fix transform logic in `forwardCommandResponse` if needed
4. Add test to verify JSON structure

**Acceptance Criteria**:
- `bdg peek --json | jq '.preview.data'` succeeds
- Structure matches docs/contracts
- All JSON consumers work

---

#### Fix 1.2: Improve "No Session" Error Handling
**Deadline**: High Priority  
**Effort**: 1 hour

**Actions**:
1. Update peek command to check for empty/null response.data
2. Return clear error: "No active session found"
3. Include suggestion: "Start a session with: bdg <url>"
4. Update details command similarly

**Acceptance Criteria**:
- Peek without session returns clear error message
- Exit code is non-zero (e.g., EXIT_CODES.RESOURCE_NOT_FOUND)
- Error message is actionable

---

### Priority 2: Robustness Improvements (Recommended)

#### Fix 2.1: Input Validation & Sanitization
**Effort**: 2-3 hours

**Missing Validations**:
- Peek `lastN` parameter: cap at 100, validate > 0
- Details `id` parameter: validate format (non-empty string)
- Details `itemType`: already validated by TypeScript

**Actions**:
1. Add validation in CLI commands before sending IPC
2. Add validation in worker handlers as defense-in-depth
3. Return structured errors for invalid input

---

#### Fix 2.2: Timeout Configuration & Tuning
**Effort**: 1 hour

**Current State**:
- Client timeout: 5s
- Daemon timeout: 10s
- Mismatch causes client to timeout before daemon

**Actions**:
1. Align timeouts: Client 10s, Daemon 8s (client always times out first)
2. Make timeouts configurable via environment variables
3. Document timeout behavior

---

#### Fix 2.3: Concurrent Request Handling
**Effort**: 2 hours

**Current Limitation**:
- Single pending request map in daemon
- No explicit concurrency control

**Actions**:
1. Test concurrent peek/details requests
2. Verify request correlation works correctly
3. Add stress test for concurrent clients
4. Document concurrency limits if any

---

### Priority 3: Observability & Debugging (Nice to Have)

#### Fix 3.1: Structured Logging
**Effort**: 2-3 hours

**Actions**:
1. Add request/response logging with IDs
2. Log performance metrics (response times)
3. Add optional debug mode (BDG_IPC_DEBUG=1)
4. Log worker handler execution times

---

#### Fix 3.2: Health Checks & Diagnostics
**Effort**: 2 hours

**Actions**:
1. Add `bdg ipc ping` command to test daemon connectivity
2. Add `bdg ipc health` to check daemon + worker status
3. Return diagnostics in error responses (e.g., "daemon running but worker not responding")

---

### Priority 4: Testing & Documentation

#### Fix 4.1: Contract Tests
**Effort**: 4-6 hours

**Coverage Needed**:
- Worker peek response schema
- Worker details response schema
- Error response formats
- IPC message envelope structure

**Approach**:
- Use Node.js test runner
- Test message serialization/deserialization
- Verify schema compliance
- Test error conditions

---

#### Fix 4.2: Fix Smoke Test Script
**Effort**: 30 minutes

**Issues**:
- Script exits early on first failure (set -e)
- Test result summary not printed

**Actions**:
1. Remove `set -e` or use error trapping
2. Accumulate results and print summary
3. Add color-coded output

---

## Implementation Roadmap

### Phase 1: Critical Fixes (Day 1)
1. ✅ Fix peek JSON output structure
2. ✅ Improve "no session" error handling
3. ✅ Fix smoke test script

### Phase 2: Robustness (Day 2-3)
4. Add input validation
5. Align timeouts
6. Test concurrent requests

### Phase 3: Observability (Day 4)
7. Structured logging
8. Health check commands

### Phase 4: Testing (Day 5-6)
9. Write contract tests
10. Extended stress testing

---

## Risks & Mitigations

### Risk 1: Breaking Changes During Fixes
**Mitigation**: Smoke test after each fix, maintain backwards compatibility

### Risk 2: Performance Regression
**Mitigation**: Benchmark before/after, reject changes that degrade performance >10%

### Risk 3: Incomplete Error Coverage
**Mitigation**: Systematic error case enumeration, test all error paths

---

## Success Criteria

**Ready for Production When**:
1. ✅ All critical issues fixed
2. ✅ Peek JSON output valid
3. ✅ Error messages clear and actionable
4. ✅ Contract tests passing
5. ✅ Smoke test passing 100%
6. ✅ Performance metrics maintained
7. ✅ Documentation updated

---

## Appendix: Observed Issues During Development

### Type Field Collision (FIXED)
- **Discovered During**: worker_details timeout investigation
- **Duration**: ~1 hour debugging
- **Resolution**: Renamed parameter to itemType
- **Lesson**: Avoid using common field names ("type", "id", "data") for command parameters when using envelope-based IPC

### Dead Code
- `handlePeekRequest` in daemon is unreachable (isCommandRequest catches it first)
- Should be removed in cleanup PR

### Missing Network Requests in Tests
- Fetch requests in smoke test sometimes don't complete before peek
- Need to wait longer or poll until data appears
- Consider adding `bdg peek --wait` to block until data available

---

## Next Actions

1. **Immediate**: Investigate and fix peek JSON output issue
2. **High Priority**: Improve error handling for no-session case
3. **Medium Priority**: Implement input validation
4. **After Fixes**: Write contract tests
5. **Before Merge**: Run full smoke test suite and verify 100% pass rate

---

## Conclusion

The IPC system is **fundamentally sound** with excellent performance. With 3 critical fixes and robustness improvements, it will be production-ready. The main work is **fixing the JSON output structure** and **improving error handling**.

**Estimated Time to Production Ready**: 1-2 days of focused work.
