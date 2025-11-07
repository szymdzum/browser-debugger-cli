# Technical Debt Tracking

**Generated:** November 7, 2025  
**Last Updated:** v0.3.0

---

## Quick Reference

Use this document to track technical debt issues by ticket. Each issue links back to the Code Review.

---

## Unresolved Issues

### TD-001: Composite Stop Command
**File:** `src/commands/stop.ts` (Lines 47-128)  
**Severity:** High  
**Category:** Unix Philosophy  
**Description:** Stop command combines session stopping with Chrome process killing

**Current Behavior:**
- Stops daemon session
- Optionally kills Chrome with `--kill-chrome` flag
- Complex error handling due to mixed concerns
- Returns composite result with multiple state fields

**Impact:**
- Violates "do one thing well" principle
- Hard to test edge cases
- Can't be composed with other tools
- Error branches are complex

**Fix Strategy:**
1. Remove `--kill-chrome` flag from stop command
2. Let `cleanup --aggressive` handle Chrome killing
3. Stop command focuses on session cleanup only
4. Users compose: `bdg stop && bdg cleanup --aggressive`

**Estimated Effort:** 2 hours  
**Risk:** Low (refactoring, good test coverage)

---

### TD-002: Duplicated Selector/Index Resolution
**File:** `src/commands/dom.ts` (Lines 50-115)  
**Severity:** High  
**Category:** DRY  
**Description:** Four DOM subcommands duplicate selector→nodeId resolution logic

**Current Behavior:**
```typescript
// handleDomHighlight (Lines 84-89)
const ipcOptions: Parameters<typeof highlightDOM>[0] = {
  ...(options.color !== undefined && { color: options.color }),
  // ...
};
const selectorOptions = buildSelectorOptions(...);
Object.assign(ipcOptions, selectorOptions);

// handleDomGet (Lines 121-129) - Nearly identical
const ipcOptions: Parameters<typeof getDOM>[0] = {
  ...(options.all !== undefined && { all: options.all }),
  // ...
};
const selectorOptions = buildSelectorOptions(...);
Object.assign(ipcOptions, selectorOptions);
```

**Impact:**
- Code duplication increases maintenance burden
- Risk of inconsistency across commands
- Changes need to be applied in 4 places

**Fix Strategy:**
1. Create generic helper for merging base + selector options
2. Reuse across all four commands
3. Consider moving to `domOptionsBuilder.ts`

**Estimated Effort:** 1 hour  
**Risk:** Low (pure refactoring)

---

### TD-003: Duplicated File Deletion Pattern
**File:** `src/session/cleanup.ts` (Lines 52-110)  
**Severity:** High  
**Category:** DRY  
**Description:** Five file deletion operations repeat identical try-catch pattern

**Current Behavior:**
```typescript
// Lines 52-59
if (fs.existsSync(metaPath)) {
  try {
    fs.unlinkSync(metaPath);
    log('Removed metadata file');
  } catch (error) {
    log(`Failed to remove metadata: ${getErrorMessage(error)}`);
  }
}

// Lines 82-88 (daemon PID) - Identical pattern
// Lines 94-100 (socket) - Identical pattern
// Lines 104-110 (lock) - Identical pattern
```

**Impact:**
- ~50 lines of boilerplate code
- Changes to error handling need 5x updates
- Risk of inconsistent error messages

**Fix Strategy:**
1. Extract to `safeDeleteFile()` helper
2. Takes path, label, and logger
3. Returns success/failure boolean
4. Reuse for all file deletions

**Estimated Effort:** 1 hour  
**Risk:** Low (pure refactoring)

---

### TD-004: Platform-Specific Command Hardcoded
**File:** `src/commands/cleanup.ts` (Lines 118-133)  
**Severity:** High  
**Category:** Unix Philosophy  
**Description:** Force cleanup uses hardcoded macOS/Linux-specific `lsof` command

**Current Behavior:**
```typescript
// Lines 128-130
try {
  execSync('lsof -ti:9222 | xargs kill -9 2>/dev/null || true', { stdio: 'ignore' });
  cleanedChrome = true;
} catch (error) {
  // ...
}
```

**Issues:**
- Hardcoded port 9222 instead of config
- `lsof` only available on macOS/Linux
- Windows users get silent failure
- Comments admit: "Platform-specific: macOS/Linux only"

**Impact:**
- Cross-platform incompatibility
- Silent failure on Windows
- Hard to test
- Inconsistent with `cleanupStaleChrome()` function

**Fix Strategy:**
1. Use existing `cleanupStaleChrome()` from sessionController
2. Or create cross-platform `killProcessesOnPort()` helper
3. Abstract port from constant `DEFAULT_DEBUG_PORT`
4. Test on Windows CI

**Estimated Effort:** 2 hours  
**Risk:** Medium (affects Windows compatibility)

---

### TD-005: Composite Peek Command with Follow Mode
**File:** `src/commands/peek.ts` (Lines 27-66)  
**Severity:** Medium  
**Category:** Unix Philosophy  
**Description:** Peek command does both one-time snapshot and continuous monitoring

**Current Behavior:**
```typescript
if (options.follow) {
  // Infinite loop with 1s polling
  console.error(followingPreviewMessage());
  await showPreview();
  const followInterval = setInterval(() => {
    void showPreview();
  }, 1000);
  
  process.on('SIGINT', () => {
    clearInterval(followInterval);
    console.error(stoppedFollowingPreviewMessage());
    process.exit(EXIT_CODES.SUCCESS);
  });
} else {
  // One-time snapshot
  await showPreview();
}
```

**Impact:**
- `--follow` transforms tool into monitoring daemon
- Error handling differs between modes
- Violates "one thing well"
- SIGINT handler only in follow mode

**Fix Strategy:**
1. Keep peek as one-time snapshot
2. Create separate `bdg tail` or `bdg watch` for monitoring
3. Share `showPreview()` logic between both
4. Cleaner semantics

**Estimated Effort:** 3 hours  
**Risk:** Medium (new command)

---

### TD-006: Complex Error Code Mapping
**File:** `src/commands/stop.ts` (Lines 38-52)  
**Severity:** Medium  
**Category:** KISS  
**Description:** Switch statement for error code mapping with mostly duplicate results

**Current Behavior:**
```typescript
function getExitCodeForDaemonError(errorCode?: IPCErrorCode): number {
  switch (errorCode) {
    case IPCErrorCode.NO_SESSION:
      return EXIT_CODES.RESOURCE_NOT_FOUND;
    case IPCErrorCode.SESSION_KILL_FAILED:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    case IPCErrorCode.DAEMON_ERROR:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    // ... 5 more cases, all returning UNHANDLED_EXCEPTION
    case undefined:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
  }
}
```

**Impact:**
- Only 1 code has special handling
- Switch statement is verbose and repetitive
- Hard to understand intent
- Violates KISS principle

**Fix Strategy:**
```typescript
const exitCode = errorCode === IPCErrorCode.NO_SESSION 
  ? EXIT_CODES.RESOURCE_NOT_FOUND 
  : EXIT_CODES.UNHANDLED_EXCEPTION;
```

**Estimated Effort:** 30 minutes  
**Risk:** Very Low (simplification)

---

### TD-007: Over-Complex Cleanup Flow
**File:** `src/commands/cleanup.ts` (Lines 74-155)  
**Severity:** Medium  
**Category:** KISS  
**Description:** Cleanup command has nested if/else with 4 levels of branching

**Current Behavior:**
```typescript
if (!pid) {
  // Fall through
} else {
  const isAlive = isProcessAlive(pid);
  if (isAlive && !opts.force) {
    return { success: false, error: ... };
  }
  if (isAlive && opts.force) {
    // Handle force
  } else {
    // Handle stale
  }
}
```

**Impact:**
- High cyclomatic complexity
- Multiple state checks mixed
- Error path interleaved with success path
- Hard to follow logic

**Fix Strategy:**
1. Use early-exit pattern
2. Validate state first, return early on error
3. Process valid cases sequentially
4. Improves readability

**Estimated Effort:** 2 hours  
**Risk:** Low (refactoring only)

---

### TD-008: Complex Body-Fetching Conditionals
**File:** `src/telemetry/network.ts` (Lines 130-150)  
**Severity:** Medium  
**Category:** KISS  
**Description:** Network collection duplicates MIME type and size checks

**Current Behavior:**
```typescript
const isTextResponse = (request.mimeType?.includes('json') ?? false) || ...;

if (isTextResponse && isSizeAcceptable) {
  const shouldFetch = shouldFetchBody(...);
  if (shouldFetch) {
    // Fetch
  } else {
    bodiesSkipped++;
    request.responseBody = '[SKIPPED: Auto-optimization...]';
  }
} else if (isTextResponse && !isSizeAcceptable) {
  bodiesSkipped++;
  request.responseBody = `[SKIPPED: Response too large...]`;
}
```

**Impact:**
- Duplicate isTextResponse check
- Size checking split between two functions
- Logic harder to understand
- Decision-making is scattered

**Fix Strategy:**
1. Extend `shouldFetchBody()` to handle all decisions
2. Return decision object with reason
3. Simplify caller logic

**Estimated Effort:** 2 hours  
**Risk:** Low (refactoring)

---

### TD-009: Unresolved TODO Comment
**File:** `src/daemon/ipcServer.ts`  
**Severity:** Low  
**Category:** Code Quality  
**Description:** Hardcoded value with TODO to extract from request

**Current Behavior:**
```typescript
lastN: 10, // TODO: Extract from PeekRequest if needed
```

**Impact:**
- Feature incomplete
- Code review noise
- Intent unclear

**Fix Strategy:**
1. Either implement: `lastN: params.lastN ?? 10`
2. Or remove TODO if feature not needed

**Estimated Effort:** 30 minutes  
**Risk:** Very Low

---

### TD-010: Magic Number in Option Validation
**File:** `src/commands/shared/commonOptions.ts` (Lines 29-34)  
**Severity:** Low  
**Category:** Best Practices  
**Description:** Hardcoded limit 10000 appears twice in validation

**Current Behavior:**
```typescript
if (isNaN(n) || n < 0 || n > 10000) {  // Magic number
  throw new Error(invalidLastRangeError(0, 10000));  // Duplicated
}
```

**Impact:**
- Hard to maintain
- Risk of inconsistency
- Non-obvious constant value

**Fix Strategy:**
```typescript
const MAX_LAST_ITEMS = 10000;
if (isNaN(n) || n < 0 || n > MAX_LAST_ITEMS) {
  throw new Error(invalidLastRangeError(0, MAX_LAST_ITEMS));
}
```

**Estimated Effort:** 30 minutes  
**Risk:** Very Low

---

### TD-011: Type Assertions Without Validation
**File:** `src/commands/domEvalHelpers.ts` (Lines 66-68)  
**Severity:** High  
**Category:** Best Practices  
**Description:** CDP response type assertion without runtime validation

**Current Behavior:**
```typescript
const result = (await cdp.send('Runtime.evaluate', {...})) as RuntimeEvaluateResult;
```

**Impact:**
- No runtime validation of response structure
- Silent failures if CDP response changes
- Type assertion bypasses type checking
- Hard to debug

**Fix Strategy:**
1. Create type guard `isRuntimeEvaluateResult()`
2. Validate response at runtime
3. Throw clear error if invalid

**Estimated Effort:** 1 hour  
**Risk:** Low

---

### TD-012: Missing Error Context in IPC Client
**File:** `src/ipc/client.ts` (Lines 10-80)  
**Severity:** Low  
**Category:** Best Practices  
**Description:** Generic `sendRequest()` errors lack context

**Current Behavior:**
```typescript
socket.on('error', (err) => {
  reject(new Error(`Connection error: ${err.message}`));  // Missing context
});
```

**Impact:**
- Hard to debug multiple IPC failures
- No indication of which request failed
- Socket path not in error message

**Fix Strategy:**
```typescript
reject(new Error(
  `IPC ${requestName} error (${socketPath}): ${err.message}`
));
```

**Estimated Effort:** 30 minutes  
**Risk:** Very Low

---

### TD-013: Missing Input Validation
**File:** `src/commands/status.ts` (Lines 30-79)  
**Severity:** Low  
**Category:** Best Practices  
**Description:** No explicit validation of boolean options

**Current Behavior:**
```typescript
interface StatusOptions {
  json?: boolean;
  verbose?: boolean;
}
// No validation that these are actually booleans
```

**Impact:**
- Implicit reliance on Commander
- Could silently fail with wrong types

**Fix Strategy:**
1. Add explicit validation function
2. Or rely on TypeScript stricter mode

**Estimated Effort:** 1 hour  
**Risk:** Very Low

---

## Dependency Analysis

### Shared Root Causes

**Pattern Duplication (TD-002, TD-003, TD-008):**
- Common pattern: repeated code can be extracted
- Affects multiple modules
- Could be addressed with helper utilities

**Command Design Issues (TD-001, TD-005):**
- Commands doing multiple things
- Could be addressed with clearer command boundaries

**Complexity Issues (TD-006, TD-007):**
- Over-engineered solutions
- Could be simplified with early-exit patterns

---

## Migration Path

### Phase 1: Quick Wins (4 hours)
1. TD-010: Extract magic number → 30m
2. TD-006: Simplify error mapping → 30m
3. TD-009: Resolve TODO → 30m
4. TD-012: Enhance error messages → 30m
5. TD-013: Add input validation → 1h
6. TD-004: Use existing helper instead of execSync → 1h

**Total:** 4 hours, Very Low Risk

### Phase 2: Refactoring (8 hours)
1. TD-003: Extract file deletion helper → 1h
2. TD-002: Consolidate selector resolution → 1h
3. TD-008: Simplify body-fetching logic → 2h
4. TD-007: Refactor cleanup flow → 2h
5. TD-011: Add type validation → 1h
6. Test comprehensive test coverage → 1h

**Total:** 8 hours, Low Risk

### Phase 3: Architecture (6 hours)
1. TD-005: Separate peek/watch commands → 3h
2. TD-001: Remove --kill-chrome from stop → 3h

**Total:** 6 hours, Medium Risk

---

## Estimated Total Cost

- **Development:** 18 hours
- **Testing:** 4 hours (Phase 1 & 2 are low risk)
- **Code Review & Integration:** 2 hours
- **Total:** ~24 hours

**Recommended Schedule:**
- Week 1: Phase 1 (1-2 days)
- Week 2-3: Phase 2 (2-3 days)
- Week 4: Phase 3 (1-2 days)

---

## Success Criteria

### Code Quality Metrics
- Reduce cyclomatic complexity of cleanup.ts from 12 to <8
- Eliminate code duplication (DRY violations from 5 to 0)
- Type assertion coverage: 100% validation before use
- Magic number count: 0

### Test Coverage
- Maintain or increase current test coverage
- Add tests for new helpers (file deletion, response handler)
- Test cross-platform cleanup on Windows CI

### Performance
- No performance regression
- IPC error messages slightly more informative (negligible cost)

---

## Related Documents

- **CODE_REVIEW.md** - Detailed findings and recommendations
- **CLAUDE.md** - Project guidelines and patterns
- **package.json** - Dependency list

---

## Notes

- All issues are non-critical; codebase is stable
- Issues don't prevent feature development
- Can be addressed incrementally
- Strong test coverage makes refactoring safe
- Issues are architectural, not functional

