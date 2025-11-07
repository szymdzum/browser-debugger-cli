# Code Review: Unix Philosophy, DRY, KISS, and Best Practices

**Date:** November 7, 2025  
**Scope:** `src/` directory analysis  
**Focus Areas:** Commands, utilities, IPC, telemetry, session management

---

## Executive Summary

The codebase demonstrates strong architectural foundations with an IPC-based daemon pattern and well-separated concerns. However, there are specific violations of DRY, KISS, and Unix philosophy principles that should be addressed. Most issues are moderate and can be fixed incrementally.

**Severity Distribution:**
- **High (refactoring required):** 6 issues
- **Medium (cleanup/consolidation):** 8 issues
- **Low (minor improvements):** 5 issues

---

## 1. UNIX PHILOSOPHY VIOLATIONS

### 1.1 `src/commands/stop.ts` - Line 47-128: Composite Command Violates "One Thing Well"

**Issue:** The `stop` command does multiple things simultaneously:
1. Stops the daemon session (primary responsibility)
2. Optionally kills Chrome processes (`--kill-chrome` flag)
3. Handles warnings collection
4. Returns composite result with multiple cleanup states

**Why It's Problematic:**
- Violates Unix philosophy: tools should do one thing well
- `--kill-chrome` should be a separate operation or concern
- Error handling branches are complex due to mixed concerns
- Harder to test, compose with other tools

**Specific Code:**
```typescript
// Lines 75-92: Chrome killing logic embedded in stop command
if (opts.killChrome) {
  const chromePid = response.chromePid;
  if (chromePid) {
    try {
      killChromeProcess(chromePid, 'SIGTERM');
      chromeStopped = true;
      // ...
    } catch (chromeError: unknown) {
      // ...
    }
  }
}
```

**Recommendation:**
1. Split into separate concerns:
   - Core: `stop` command stops the session only
   - Optional: Add `killProcess` utility function (reuse in `cleanup --force`)
   - Pattern: Let users compose: `bdg stop && bdg cleanup --aggressive`

**Impact:** Medium - Improves composability, reduces branching complexity


### 1.2 `src/commands/cleanup.ts` - Line 118-133: Platform-Specific Command Embedded

**Issue:** Force cleanup uses platform-specific `lsof` command hardcoded for macOS/Linux:
```typescript
// Line 128-130
try {
  execSync('lsof -ti:9222 | xargs kill -9 2>/dev/null || true', { stdio: 'ignore' });
  cleanedChrome = true;
} catch (error) {
  // ...
}
```

**Why It's Problematic:**
- Breaks Windows compatibility silently
- Mixes CLI command execution with Node.js process handling
- `DEFAULT_DEBUG_PORT` (9222) is hardcoded instead of using configuration
- Comments admit platform limitation: "Platform-specific: macOS/Linux only"

**Recommendation:**
1. Use `cleanupStaleChrome()` from `sessionController.js` instead
2. Or create platform-agnostic helper:
   ```typescript
   // Extract to utils/process.ts
   async function killProcessesOnPort(port: number): Promise<number>
   ```

**Impact:** Medium - Improves cross-platform support, reduces tech debt


### 1.3 `src/commands/peek.ts` - Lines 27-66: Composite Command with Follow Mode

**Issue:** The `peek` command conflates two distinct use cases:
1. One-time data snapshot (primary)
2. Continuous monitoring with `--follow` flag (different tool)

**Why It's Problematic:**
- `--follow` mode runs infinite loop with 1s interval polling
- Error handling differs significantly between modes
- SIGINT handler only installed in follow mode
- Logic branches heavily based on `options.follow`

**Specific Code:**
```typescript
// Lines 58-70: Follow mode adds state and different error handling
if (options.follow) {
  await showPreview();
  const followInterval = setInterval(() => {
    void showPreview();
  }, 1000);
  
  process.on('SIGINT', () => {
    clearInterval(followInterval);
    // ...
  });
} else {
  await showPreview();
}
```

**Recommendation:**
Create separate tools following Unix philosophy:
- `bdg peek` - one-time snapshot (current behavior without follow)
- `bdg peek --follow` → could become `bdg watch` or `bdg tail` for continuous monitoring
- Share common `showPreview()` logic between both

**Impact:** Low-Medium - Improves clarity, follows "one thing" principle


---

## 2. DRY (Don't Repeat Yourself) VIOLATIONS

### 2.1 `src/commands/dom.ts` - Lines 50-115: Duplicated Selector/Index Resolution

**Issue:** Four DOM subcommands (`query`, `highlight`, `get`, `screenshot`) duplicate the pattern of handling selector/index/nodeId:

```typescript
// Lines 84-89 (highlight): Build IPC options from selector
const ipcOptions: Parameters<typeof highlightDOM>[0] = {
  ...(options.color !== undefined && { color: options.color }),
  ...(options.opacity !== undefined && { opacity: options.opacity }),
  ...(options.first !== undefined && { first: options.first }),
  ...(options.nth !== undefined && { nth: options.nth }),
};
const selectorOptions = buildSelectorOptions<Parameters<typeof highlightDOM>[0]>(
  selectorOrIndex,
  options.nodeId
);
Object.assign(ipcOptions, selectorOptions);

// Lines 121-129 (get): Nearly identical pattern
const ipcOptions: Parameters<typeof getDOM>[0] = {
  ...(options.all !== undefined && { all: options.all }),
  ...(options.nth !== undefined && { nth: options.nth }),
};
const selectorOptions = buildSelectorOptions<Parameters<typeof getDOM>[0]>(
  selectorOrIndex,
  options.nodeId
);
Object.assign(ipcOptions, selectorOptions);
```

**Why It's Problematic:**
- Same merge pattern appears in `handleDomHighlight()` and `handleDomGet()`
- Easy for bugs to creep in during maintenance (change one, forget others)
- `Object.assign()` pattern is low-level; should be abstracted

**Recommendation:**
Extract helper function:
```typescript
function mergeIpcOptions<T extends Record<string, unknown>>(
  baseOptions: T,
  selectorOptions: Partial<T>
): T {
  return Object.assign(baseOptions, selectorOptions);
}

// Or use spread operator consistently:
const ipcOptions = { ...baseOptions, ...selectorOptions };
```

**Impact:** Medium - Reduces maintenance burden, improves consistency


### 2.2 `src/commands/console.ts` and `src/commands/details.ts` - Error Handling Patterns

**Issue:** Both commands share nearly identical response validation logic:

**console.ts (Lines 51-63):**
```typescript
const response = await getPeek();
validateIPCResponse(response);
const output = response.data?.preview as BdgOutput | undefined;
if (!output?.data.console) {
  return { success: false, error: '...', exitCode: EXIT_CODES.RESOURCE_NOT_FOUND };
}
```

**details.ts (Lines 57-69):**
```typescript
const response = await getDetails(opts.type, opts.id);
validateIPCResponse(response);
if (!response.data?.item) {
  return { success: false, error: 'No data in response', exitCode: EXIT_CODES.RESOURCE_NOT_FOUND };
}
```

**Recommendation:**
Create helper for response validation:
```typescript
// src/ipc/responseValidator.ts
export function ensureResponseData<T>(
  response: { data?: T },
  errorMsg: string
): T {
  if (!response.data) {
    throw new Error(errorMsg);
  }
  return response.data;
}
```

**Impact:** Low - Minor code reduction, improves clarity


### 2.3 `src/session/cleanup.ts` - Duplicated File Deletion Pattern

**Issue:** File deletion is repeated 5+ times with identical try-catch pattern:

**Lines 52-59, 82-88, 94-100, 104-110:**
```typescript
if (fs.existsSync(metaPath)) {
  try {
    fs.unlinkSync(metaPath);
    log('Removed metadata file');
  } catch (error) {
    log(`Failed to remove metadata: ${getErrorMessage(error)}`);
  }
}

// ... repeated for daemon PID, socket, lock, etc.
```

**Recommendation:**
Extract helper function:
```typescript
function safeDeleteFile(path: string, label: string, log: Logger): boolean {
  if (!fs.existsSync(path)) return false;
  try {
    fs.unlinkSync(path);
    log(`Removed ${label}`);
    return true;
  } catch (error) {
    log(`Failed to remove ${label}: ${getErrorMessage(error)}`);
    return false;
  }
}

// Usage:
safeDeleteFile(metaPath, 'metadata file', log);
safeDeleteFile(daemonPidPath, 'daemon PID file', log);
```

**Impact:** Medium - Reduces lines of code by ~30%, improves maintainability


### 2.4 `src/commands/start.ts` - Duplicated Option Validation

**Issue:** Integer parsing logic appears twice with identical error handling:

**Lines 36-43:**
```typescript
function parseOptionalInt(value: string | undefined, fieldName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(invalidIntegerError(fieldName, value));
  }
  return parsed;
}

// Called twice:
parseOptionalInt(options.timeout, 'timeout')      // Line 61
parseOptionalInt(options.maxBodySize, 'max-body-size')  // Line 62
```

**Problem:** This is only used in `start.ts`. Should be in `commonOptions.ts` or a shared validator.

**Recommendation:**
Move to shared validator and reuse across all commands:
```typescript
// src/commands/shared/validators.ts
export function parseOptionalInt(
  value: string | undefined, 
  fieldName: string
): number | undefined {
  // implementation
}
```

**Impact:** Low - Improves reusability, minor consolidation


---

## 3. KISS (Keep It Simple, Stupid) VIOLATIONS

### 3.1 `src/commands/stop.ts` - Complex Error Code Mapping

**Issue:** Lines 38-52 contain a switch statement mapping every single error code, but most map to the same result:

```typescript
function getExitCodeForDaemonError(errorCode?: IPCErrorCode): number {
  switch (errorCode) {
    case IPCErrorCode.NO_SESSION:
      return EXIT_CODES.RESOURCE_NOT_FOUND;
    case IPCErrorCode.SESSION_KILL_FAILED:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    case IPCErrorCode.DAEMON_ERROR:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    case IPCErrorCode.SESSION_ALREADY_RUNNING:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    // ... 4 more cases all returning UNHANDLED_EXCEPTION
    case undefined:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
  }
}
```

**Why It's Problematic:**
- Only 1 error code (NO_SESSION) has special handling
- All others map to the same exit code
- Switch statement is verbose for simple logic
- Violates KISS: uses complexity where simplicity suffices

**Recommendation:**
Simplify to:
```typescript
function getExitCodeForDaemonError(errorCode?: IPCErrorCode): number {
  return errorCode === IPCErrorCode.NO_SESSION 
    ? EXIT_CODES.RESOURCE_NOT_FOUND 
    : EXIT_CODES.UNHANDLED_EXCEPTION;
}
```

**Impact:** Low - Simplification, improves readability


### 3.2 `src/commands/cleanup.ts` - Over-Complex Cleanup Flow

**Issue:** Lines 74-155 contain nested if/else logic with 4 levels of branching:

```typescript
if (!pid) {
  // Fall through
} else {
  const isAlive = isProcessAlive(pid);
  if (isAlive && !opts.force) {
    return { success: false, error: ... };
  }
  if (isAlive && opts.force) {
    // Handle force cleanup
  } else {
    // Handle stale session
  }
}
```

**Why It's Problematic:**
- Cognitive complexity is high
- Early-exit pattern not used (could be clearer)
- Multiple state checks mixed together
- Error path and success path interleaved

**Recommendation:**
Restructure with early exits:
```typescript
// Validate state first
if (!pid) {
  // Handle no session
  return handleNoSession();
}

// Check if process is alive
const isAlive = isProcessAlive(pid);
if (isAlive && !opts.force) {
  return handleActiveSessionError(pid);
}

// Process is dead or force flag set
if (isAlive && opts.force) {
  handleForceKill(pid);
}

cleanupSession();
return handleSuccess();
```

**Impact:** Low-Medium - Improves readability, reduces cyclomatic complexity


### 3.3 `src/telemetry/network.ts` - Complex Conditional for Body Fetching

**Issue:** Lines 130-150 contain nested conditionals for deciding whether to fetch response body:

```typescript
const isSizeAcceptable = params.encodedDataLength <= maxBodySize;
const isTextResponse = 
  (request.mimeType?.includes('json') ?? false) ||
  (request.mimeType?.includes('javascript') ?? false) ||
  (request.mimeType?.includes('text') ?? false) ||
  (request.mimeType?.includes('html') ?? false);

if (isTextResponse && isSizeAcceptable) {
  const shouldFetch = shouldFetchBody(request.url, request.mimeType, {
    fetchAllBodies,
  });
  
  if (shouldFetch) {
    // Fetch
  } else {
    bodiesSkipped++;
    request.responseBody = '[SKIPPED: ...]';
  }
} else if (isTextResponse && !isSizeAcceptable) {
  bodiesSkipped++;
  request.responseBody = `[SKIPPED: Response too large...]`;
}
```

**Why It's Problematic:**
- Logic is repeated: `isTextResponse && !isSizeAcceptable` branch
- Should consolidate decision-making into `shouldFetchBody()` function
- Current function only checks patterns, not size limits
- Belongs in telemetry layer, not split across two functions

**Recommendation:**
Extend `shouldFetchBody()` to handle all logic:
```typescript
export function shouldFetchBody(
  url: string,
  mimeType: string | undefined,
  encodedDataLength: number,
  options: { fetchAllBodies?: boolean; maxBodySize?: number } = {}
): { should: boolean; reason?: string } {
  if (fetchAllBodies && encodedDataLength <= maxBodySize) return { should: true };
  if (encodedDataLength > maxBodySize) {
    return { 
      should: false, 
      reason: `Response too large (${formatSize(encodedDataLength)})` 
    };
  }
  // ... rest of logic
}

// Usage in network.ts is cleaner:
const decision = shouldFetchBody(request.url, request.mimeType, params.encodedDataLength, options);
if (decision.should) {
  // Fetch
} else {
  bodiesSkipped++;
  request.responseBody = decision.reason ? `[SKIPPED: ${decision.reason}]` : '[SKIPPED]';
}
```

**Impact:** Medium - Improves clarity, reduces duplication


---

## 4. BEST PRACTICE ISSUES

### 4.1 `src/commands/status.ts` - No Input Validation on Verbose Flag

**Issue:** Lines 30-79 don't validate that `--verbose` is a boolean before use:

```typescript
// Line 31
interface StatusOptions {
  json?: boolean;
  verbose?: boolean;
}

// Line 72: Used directly without validation
formatSessionStatus(
  metadata,
  data.sessionPid,
  data.activity,
  data.pageState,
  options.verbose ?? false  // Type says optional boolean, but no validation
)
```

**Why It's Problematic:**
- Relies on Commander to enforce type (implicit)
- No explicit validation
- Could silently fail if flag is passed with wrong value

**Recommendation:**
Add explicit validation:
```typescript
function validateStatusOptions(options: unknown): StatusOptions {
  const opts = options as Record<string, unknown>;
  return {
    json: typeof opts.json === 'boolean' ? opts.json : false,
    verbose: typeof opts.verbose === 'boolean' ? opts.verbose : false,
  };
}
```

**Impact:** Low - Minor defensive coding improvement


### 4.2 `src/ipc/client.ts` - Missing Error Context in Generic Function

**Issue:** Lines 10-80 implement a generic `sendRequest()` function with minimal error context:

```typescript
socket.on('error', (err) => {
  if (!resolved) {
    resolved = true;
    clearTimeout(timeout);
    reject(new Error(`Connection error: ${err.message}`));  // Line 64
  }
});
```

**Why It's Problematic:**
- Error message doesn't include request name
- Doesn't distinguish between connection errors and protocol errors
- Doesn't provide socket path for debugging
- Could be ambiguous when multiple IPC calls fail

**Recommendation:**
Enhance error messages:
```typescript
socket.on('error', (err) => {
  if (!resolved) {
    resolved = true;
    clearTimeout(timeout);
    const fullError = new Error(
      `IPC ${requestName} error (${socketPath}): ${err.message}`
    );
    reject(fullError);
  }
});
```

**Impact:** Low - Improves debugging, no functional change


### 4.3 `src/daemon/ipcServer.ts` - TODO Comment (Dead Code Marker)

**Issue:** Line contains unresolved TODO:
```typescript
lastN: 10, // TODO: Extract from PeekRequest if needed
```

**Why It's Problematic:**
- Incomplete feature: hardcoded value should be extracted from request
- TODO comments indicate incomplete implementation
- Makes code review harder (what was the original intent?)

**Recommendation:**
Either:
1. Implement the feature: `lastN: params.lastN ?? 10`
2. Or remove if not needed: `lastN: 10, // Default last N items`

**Impact:** Low - Code cleanup, resolves incomplete feature marker


### 4.4 `src/commands/shared/commonOptions.ts` - Magic Number in Validation

**Issue:** Lines 29-34 use hardcoded range validation:

```typescript
export const lastOption = new Option('--last <n>', 'Show last N items')
  .default(0)
  .argParser((val) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 0 || n > 10000) {  // Hardcoded 10000
      throw new Error(invalidLastRangeError(0, 10000));
    }
    return n;
  });
```

**Why It's Problematic:**
- Magic number `10000` appears twice (in condition and error message)
- Should be configurable constant
- Other commands may have different limits

**Recommendation:**
Extract to constant:
```typescript
const MAX_LAST_ITEMS = 10000;
const MIN_LAST_ITEMS = 0;

export const lastOption = new Option('--last <n>', 'Show last N items')
  .default(0)
  .argParser((val) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < MIN_LAST_ITEMS || n > MAX_LAST_ITEMS) {
      throw new Error(invalidLastRangeError(MIN_LAST_ITEMS, MAX_LAST_ITEMS));
    }
    return n;
  });
```

**Impact:** Low - Improves maintainability, eliminates magic numbers


### 4.5 `src/session/queryCache.ts` - Silent Failure Pattern (Intentional but Risky)

**Issue:** Lines 24-28 and 41-46 intentionally suppress errors:

```typescript
export function writeQueryCache(cache: DomQueryCache): void {
  try {
    const cachePath = getDomQueryCachePath();
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (error) {
    // Silently fail - cache is optional and non-critical
    console.error(domCacheWriteWarning(getErrorMessage(error)));
  }
}

export function readQueryCache(): DomQueryCache | null {
  try {
    // ...
  } catch {
    // Silently fail - cache is optional
    return null;
  }
}
```

**Why It's Problematic:**
- While intentional, silent failures can be confusing
- Error is logged with `console.error()` even though it's not really an error
- Comments say "non-critical" but we're logging it anyway
- Inconsistent: write logs error, read doesn't

**Recommendation:**
Be explicit about non-critical failures:
```typescript
const DEBUG_CACHE = process.env.BDG_DEBUG_CACHE === 'true';

export function writeQueryCache(cache: DomQueryCache): void {
  try {
    const cachePath = getDomQueryCachePath();
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (error) {
    if (DEBUG_CACHE) {
      console.debug(`Cache write failed (non-critical): ${getErrorMessage(error)}`);
    }
  }
}
```

**Impact:** Low - Improves clarity, optional debugging capability


### 4.6 `src/commands/domEvalHelpers.ts` - Type Assertion Without Validation

**Issue:** Lines 66-68 use type assertion without runtime validation:

```typescript
export async function executeScript(
  cdp: CDPConnection,
  script: string
): Promise<RuntimeEvaluateResult> {
  const result = (await cdp.send('Runtime.evaluate', {
    expression: script,
    returnByValue: true,
    awaitPromise: true,
  })) as RuntimeEvaluateResult;  // <-- Type assertion without validation
```

**Why It's Problematic:**
- CDP response structure not validated at runtime
- If response structure changes, code silently breaks
- `as RuntimeEvaluateResult` bypasses type checking
- Should validate response shape before using it

**Recommendation:**
Add runtime validation:
```typescript
function isRuntimeEvaluateResult(obj: unknown): obj is RuntimeEvaluateResult {
  return (
    typeof obj === 'object' && 
    obj !== null &&
    ('result' in obj || 'exceptionDetails' in obj)
  );
}

export async function executeScript(
  cdp: CDPConnection,
  script: string
): Promise<RuntimeEvaluateResult> {
  const result = await cdp.send('Runtime.evaluate', {...});
  
  if (!isRuntimeEvaluateResult(result)) {
    throw new Error(`Invalid CDP response: ${JSON.stringify(result)}`);
  }
  
  return result;
}
```

**Impact:** Medium - Improves runtime safety, better error messages


---

## 5. ARCHITECTURAL IMPROVEMENTS

### 5.1 Missing Abstraction: Response Validation Pattern

**Issue:** Commands repeat IPC response validation pattern:
- Line validation + data existence check
- Error mapping to exit codes
- Success return with normalized data

Appears in: `console.ts`, `details.ts`, `network.ts`, `dom.ts` (~8 places)

**Recommendation:**
Create response handler helper:
```typescript
// src/ipc/responseHandler.ts
export async function handleIpcResponse<T>(
  request: () => Promise<{ status: string; data?: T; error?: string }>,
  options: { requireData?: boolean } = {}
): Promise<T> {
  const response = await request();
  validateIPCResponse(response);
  
  if (options.requireData && !response.data) {
    throw new Error('No data in response');
  }
  
  return response.data as T;
}

// Usage becomes:
const output = await handleIpcResponse(
  () => getPeek(),
  { requireData: true }
);
```

**Impact:** High - Reduces boilerplate, improves consistency


---

## 6. SUMMARY TABLE

| Severity | Category | Issue | Line | File | Type |
|----------|----------|-------|------|------|------|
| High | Unix | Composite stop command | 47-128 | stop.ts | REFACTOR |
| High | DRY | Duplicated selector resolution | 50-115 | dom.ts | CONSOLIDATE |
| High | DRY | Duplicated file deletion | 52-110 | cleanup.ts | EXTRACT |
| High | Best Practice | Type assertions without validation | 66-68 | domEvalHelpers.ts | VALIDATE |
| High | Architecture | Response validation pattern repeated | Multiple | Multiple | EXTRACT |
| High | Unix | Platform-specific hardcoded port | 118-133 | cleanup.ts | ABSTRACT |
| Medium | Unix | Composite peek command with --follow | 27-66 | peek.ts | SEPARATE |
| Medium | KISS | Complex error code mapping | 38-52 | stop.ts | SIMPLIFY |
| Medium | KISS | Over-complex cleanup flow | 74-155 | cleanup.ts | REFACTOR |
| Medium | KISS | Complex body-fetching conditionals | 130-150 | network.ts | SIMPLIFY |
| Medium | DRY | Duplicated response validation | Multiple | Multiple | EXTRACT |
| Low | Best Practice | Missing input validation | 30-79 | status.ts | VALIDATE |
| Low | Best Practice | Poor error context in IPC | 10-80 | client.ts | ENHANCE |
| Low | Code Quality | Unresolved TODO comment | ipcServer.ts | ipcServer.ts | RESOLVE |
| Low | Best Practice | Magic numbers | 29-34 | commonOptions.ts | EXTRACT |
| Low | Best Practice | Silent failure logging | 24-46 | queryCache.ts | CLARIFY |

---

## 7. RECOMMENDED PRIORITY ORDER

1. **Phase 1 (High Impact, Low Risk):**
   - Extract file deletion helper (`cleanup.ts`)
   - Simplify error code mapping (`stop.ts`)
   - Extract response handler pattern (multiple files)

2. **Phase 2 (Architecture Improvements):**
   - Consolidate selector resolution (`dom.ts`)
   - Separate peek/follow commands
   - Simplify cleanup flow (`cleanup.ts`)

3. **Phase 3 (Polish):**
   - Add type assertions validation
   - Extract magic numbers
   - Resolve TODO comments
   - Improve error context

---

## 8. POSITIVE NOTES

The codebase demonstrates several excellent patterns:

1. **Strong Separation of Concerns:** IPC layer, telemetry, session management are well-isolated
2. **Consistent Error Handling:** CommandRunner pattern, CommandError, EXIT_CODES are well-used
3. **Good Module Organization:** Clear imports, absolute paths with `@/`
4. **Comprehensive Logging:** Debug messages, PERF metrics, structured logging
5. **Type Safety:** Generally good TypeScript usage, descriptive interfaces
6. **Documentation:** TSDoc comments are thorough and helpful

These strengths make the codebase maintainable despite the issues identified above.

