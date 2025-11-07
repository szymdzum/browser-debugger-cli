# Refactoring Guide with Code Examples

**Purpose:** Provide concrete before/after examples for each technical debt issue  
**Audience:** Developers implementing fixes

---

## TD-003: Extract File Deletion Helper

### Before

**File:** `src/session/cleanup.ts` (Lines 52-110)

```typescript
// Remove metadata
const metaPath = getSessionFilePath('METADATA');
if (fs.existsSync(metaPath)) {
  try {
    fs.unlinkSync(metaPath);
    log('Removed metadata file');
  } catch (error) {
    log(`Failed to remove metadata: ${getErrorMessage(error)}`);
  }
}

// Remove daemon PID
if (fs.existsSync(daemonPidPath)) {
  try {
    fs.unlinkSync(daemonPidPath);
    log('Removed daemon PID file');
  } catch (error) {
    log(`Failed to remove daemon PID: ${getErrorMessage(error)}`);
  }
}

// Remove daemon socket
const socketPath = getSessionFilePath('DAEMON_SOCKET');
if (fs.existsSync(socketPath)) {
  try {
    fs.unlinkSync(socketPath);
    log('Removed daemon socket');
  } catch (error) {
    log(`Failed to remove daemon socket: ${getErrorMessage(error)}`);
  }
}

// Remove daemon lock
const daemonLockPath = getSessionFilePath('DAEMON_LOCK');
if (fs.existsSync(daemonLockPath)) {
  try {
    fs.unlinkSync(daemonLockPath);
    log('Removed daemon lock');
  } catch (error) {
    log(`Failed to remove daemon lock: ${getErrorMessage(error)}`);
  }
}
```

### After

**Create new helper:** `src/session/fileOps.ts`

```typescript
import * as fs from 'fs';
import type { Logger } from '@/utils/logger.js';
import { getErrorMessage } from '@/utils/errors.js';

/**
 * Safely delete a file if it exists.
 *
 * Handles missing files and errors gracefully.
 *
 * @param path - File path to delete
 * @param label - Human-readable label for logging
 * @param log - Logger instance
 * @returns True if file was deleted, false if it didn't exist or error occurred
 */
export function safeDeleteFile(path: string, label: string, log: Logger): boolean {
  if (!fs.existsSync(path)) {
    return false;
  }

  try {
    fs.unlinkSync(path);
    log(`Removed ${label}`);
    return true;
  } catch (error) {
    log(`Failed to remove ${label}: ${getErrorMessage(error)}`);
    return false;
  }
}
```

**Updated cleanup.ts:**

```typescript
import { safeDeleteFile } from '@/session/fileOps.js';

// ... in cleanupStaleSession() function ...

// All file deletions now use single helper
safeDeleteFile(getSessionFilePath('METADATA'), 'metadata file', log);
safeDeleteFile(daemonPidPath, 'daemon PID file', log);
safeDeleteFile(socketPath, 'daemon socket', log);
safeDeleteFile(daemonLockPath, 'daemon lock', log);
```

**Benefits:**
- Eliminates ~50 lines of boilerplate
- Single point of change for error handling
- Consistent logging across all deletions
- Testable in isolation

---

## TD-006: Simplify Error Code Mapping

### Before

**File:** `src/commands/stop.ts` (Lines 38-52)

```typescript
/**
 * Map daemon error codes to appropriate exit codes.
 *
 * @param errorCode - IPC error code from daemon response
 * @returns Semantic exit code
 */
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
    case IPCErrorCode.WORKER_START_FAILED:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    case IPCErrorCode.CHROME_LAUNCH_FAILED:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    case IPCErrorCode.CDP_TIMEOUT:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    case undefined:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
  }
}
```

### After

```typescript
/**
 * Map daemon error codes to appropriate exit codes.
 *
 * @param errorCode - IPC error code from daemon response
 * @returns Semantic exit code
 */
function getExitCodeForDaemonError(errorCode?: IPCErrorCode): number {
  // Only NO_SESSION has special handling; all others are unhandled exceptions
  return errorCode === IPCErrorCode.NO_SESSION
    ? EXIT_CODES.RESOURCE_NOT_FOUND
    : EXIT_CODES.UNHANDLED_EXCEPTION;
}
```

**Benefits:**
- Reduces from 16 lines to 4 lines
- Intent immediately clear: one special case
- Easier to add new error codes in future
- Follows KISS principle

---

## TD-002: Consolidate Selector Resolution

### Before

**File:** `src/commands/dom.ts` (appears 4 times)

```typescript
// Pattern in handleDomHighlight
async function handleDomHighlight(
  selectorOrIndex: string,
  options: DomHighlightOptions
): Promise<void> {
  await runCommand(
    async () => {
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

      const response = await highlightDOM(ipcOptions);
      // ...
    },
    options,
    formatDomHighlight
  );
}

// Pattern in handleDomGet (nearly identical)
async function handleDomGet(
  selectorOrIndex: string,
  options: DomGetOptions
): Promise<void> {
  await runCommand(
    async () => {
      const ipcOptions: Parameters<typeof getDOM>[0] = {
        ...(options.all !== undefined && { all: options.all }),
        ...(options.nth !== undefined && { nth: options.nth }),
      };

      const selectorOptions = buildSelectorOptions<Parameters<typeof getDOM>[0]>(
        selectorOrIndex,
        options.nodeId
      );
      Object.assign(ipcOptions, selectorOptions);

      const response = await getDOM(ipcOptions);
      // ...
    },
    // ...
  );
}
```

### After

**Create helper:** `src/commands/domOptionsBuilder.ts` (enhance existing file)

```typescript
/**
 * Merge base options with selector-based options.
 *
 * @param baseOptions - Base IPC options object
 * @param selectorOrIndex - CSS selector or cached index
 * @param nodeId - Optional direct nodeId
 * @returns Merged options object
 *
 * @example
 * ```typescript
 * const options = mergeWithSelector(
 *   { color: 'red', opacity: 0.5 },
 *   '.error',
 *   undefined
 * );
 * // → { color: 'red', opacity: 0.5, selector: '.error' }
 * ```
 */
export function mergeWithSelector<T extends SelectorBasedOptions>(
  baseOptions: T,
  selectorOrIndex: string,
  nodeId: number | undefined
): T {
  const selectorOptions = buildSelectorOptions<T>(selectorOrIndex, nodeId);
  return { ...baseOptions, ...selectorOptions };
}
```

**Updated dom.ts:**

```typescript
async function handleDomHighlight(
  selectorOrIndex: string,
  options: DomHighlightOptions
): Promise<void> {
  await runCommand(
    async () => {
      const ipcOptions = mergeWithSelector<Parameters<typeof highlightDOM>[0]>(
        {
          ...(options.color !== undefined && { color: options.color }),
          ...(options.opacity !== undefined && { opacity: options.opacity }),
          ...(options.first !== undefined && { first: options.first }),
          ...(options.nth !== undefined && { nth: options.nth }),
        },
        selectorOrIndex,
        options.nodeId
      );

      const response = await highlightDOM(ipcOptions);
      // ...
    },
    options,
    formatDomHighlight
  );
}

async function handleDomGet(
  selectorOrIndex: string,
  options: DomGetOptions
): Promise<void> {
  await runCommand(
    async () => {
      const ipcOptions = mergeWithSelector<Parameters<typeof getDOM>[0]>(
        {
          ...(options.all !== undefined && { all: options.all }),
          ...(options.nth !== undefined && { nth: options.nth }),
        },
        selectorOrIndex,
        options.nodeId
      );

      const response = await getDOM(ipcOptions);
      // ...
    },
    options,
    formatDomGet
  );
}
```

**Benefits:**
- Eliminates duplicate merge logic
- Single point of change
- Consistent across all commands
- Clear, testable helper

---

## TD-008: Simplify Body-Fetching Logic

### Before

**File:** `src/telemetry/network.ts` (Lines 130-150)

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
    bodiesFetched++;
    void cdp
      .send('Network.getResponseBody', { requestId: params.requestId })
      .then((response) => {
        const typedResponse = response as CDPGetResponseBodyResponse;
        request.responseBody = typedResponse.body;
      })
      .catch(() => {
        // Response body not available
      });
  } else {
    bodiesSkipped++;
    request.responseBody = '[SKIPPED: Auto-optimization (see DEFAULT_SKIP_BODY_PATTERNS)]';
  }
} else if (isTextResponse && !isSizeAcceptable) {
  bodiesSkipped++;
  request.responseBody = `[SKIPPED: Response too large (${(params.encodedDataLength / 1024 / 1024).toFixed(2)}MB > ${maxBodySize / 1024 / 1024}MB)]`;
}
```

### After

**Enhance filters.ts:**

```typescript
export interface BodyFetchDecision {
  should: boolean;
  reason?: string;
}

/**
 * Determine if a response body should be fetched.
 *
 * Combines all decision logic: size, MIME type, smart defaults, and fetch flags.
 *
 * @param url - Request URL
 * @param mimeType - Response MIME type
 * @param encodedDataLength - Response size in bytes
 * @param options - Configuration options
 * @returns Decision object with reason if skipped
 */
export function shouldFetchBody(
  url: string,
  mimeType: string | undefined,
  encodedDataLength: number,
  options: { fetchAllBodies?: boolean; maxBodySize?: number } = {}
): BodyFetchDecision {
  const { fetchAllBodies = false, maxBodySize = MAX_RESPONSE_SIZE } = options;

  // Check if response is text-based
  const isTextResponse =
    mimeType?.includes('json') ||
    mimeType?.includes('javascript') ||
    mimeType?.includes('text') ||
    mimeType?.includes('html');

  if (!isTextResponse) {
    return { should: false, reason: 'Non-text response type' };
  }

  // Check size limits
  if (encodedDataLength > maxBodySize) {
    const sizeStr = `${(encodedDataLength / 1024 / 1024).toFixed(2)}MB`;
    const limitStr = `${maxBodySize / 1024 / 1024}MB`;
    return {
      should: false,
      reason: `Response too large (${sizeStr} > ${limitStr})`,
    };
  }

  // Check fetchAllBodies override
  if (fetchAllBodies) {
    return { should: true };
  }

  // Apply smart defaults
  const matchesSkipPattern = DEFAULT_SKIP_BODY_PATTERNS.some((pattern) =>
    matchesWildcard(url, pattern)
  );

  if (matchesSkipPattern) {
    return {
      should: false,
      reason: 'Matches auto-skip patterns (see DEFAULT_SKIP_BODY_PATTERNS)',
    };
  }

  return { should: true };
}
```

**Updated network.ts:**

```typescript
registry.register<CDPNetworkLoadingFinishedParams>(
  cdp,
  'Network.loadingFinished',
  (params: CDPNetworkLoadingFinishedParams) => {
    const entry = requestMap.get(params.requestId);
    if (entry && requests.length < MAX_NETWORK_REQUESTS) {
      const request = entry.request;

      // Apply domain filtering
      if (shouldExcludeDomain(request.url, includeAll)) {
        requestMap.delete(params.requestId);
        return;
      }

      // Decide if body should be fetched
      const decision = shouldFetchBody(
        request.url,
        request.mimeType,
        params.encodedDataLength,
        { fetchAllBodies, maxBodySize }
      );

      if (decision.should) {
        bodiesFetched++;
        void cdp
          .send('Network.getResponseBody', { requestId: params.requestId })
          .then((response) => {
            const typedResponse = response as CDPGetResponseBodyResponse;
            request.responseBody = typedResponse.body;
          })
          .catch(() => {
            // Response body not available
          });
      } else {
        bodiesSkipped++;
        request.responseBody = decision.reason
          ? `[SKIPPED: ${decision.reason}]`
          : '[SKIPPED]';
      }

      requests.push(request);
      requestMap.delete(params.requestId);
    }
  }
);
```

**Benefits:**
- All decision logic in one place
- Clear reason for skipping
- Eliminates duplicate conditionals
- Easier to test
- Better error messages for users

---

## TD-011: Add Type Validation for CDP Responses

### Before

**File:** `src/commands/domEvalHelpers.ts` (Lines 66-68)

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

  if (result.exceptionDetails) {
    const errorMsg =
      result.exceptionDetails.exception?.description ?? 'Unknown error executing script';
    throw new Error(errorMsg);
  }

  return result;
}
```

### After

```typescript
/**
 * Type guard for CDP Runtime.evaluate result
 */
function isRuntimeEvaluateResult(obj: unknown): obj is RuntimeEvaluateResult {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const result = obj as Record<string, unknown>;
  
  // Has either result or exceptionDetails
  return (
    'result' in result ||
    'exceptionDetails' in result
  );
}

export async function executeScript(
  cdp: CDPConnection,
  script: string
): Promise<RuntimeEvaluateResult> {
  const response = await cdp.send('Runtime.evaluate', {
    expression: script,
    returnByValue: true,
    awaitPromise: true,
  });

  // Validate response structure
  if (!isRuntimeEvaluateResult(response)) {
    throw new Error(
      `Invalid CDP Runtime.evaluate response: ${JSON.stringify(response)}`
    );
  }

  const result = response;

  // Check for execution exceptions
  if (result.exceptionDetails) {
    const errorMsg =
      result.exceptionDetails.exception?.description ?? 'Unknown error executing script';
    throw new Error(errorMsg);
  }

  return result;
}
```

**Benefits:**
- Runtime validation of CDP response
- Clear error if response structure is invalid
- Type-safe after validation
- Better error messages for debugging

---

## TD-010: Extract Magic Numbers

### Before

**File:** `src/commands/shared/commonOptions.ts` (Lines 29-34)

```typescript
export const lastOption = new Option('--last <n>', 'Show last N items')
  .default(0)
  .argParser((val) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 0 || n > 10000) {  // Magic number appears twice
      throw new Error(invalidLastRangeError(0, 10000));
    }
    return n;
  });
```

### After

**At top of file:**

```typescript
/**
 * Validation limits for --last option
 */
const MIN_LAST_ITEMS = 0;
const MAX_LAST_ITEMS = 10000;

export const lastOption = new Option('--last <n>', 'Show last N items')
  .default(MIN_LAST_ITEMS)
  .argParser((val) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < MIN_LAST_ITEMS || n > MAX_LAST_ITEMS) {
      throw new Error(invalidLastRangeError(MIN_LAST_ITEMS, MAX_LAST_ITEMS));
    }
    return n;
  });
```

**Benefits:**
- Constants are self-documenting
- Single point of change
- Easy to adjust limits in future
- Consistent validation

---

## TD-009: Resolve TODO Comment

### Current

**File:** `src/daemon/ipcServer.ts`

```typescript
lastN: 10, // TODO: Extract from PeekRequest if needed
```

### Option 1: Implement the Feature

If the feature is needed, extract from request:

```typescript
// In peek request handler
const lastN = params.lastN ?? 10; // Default to 10 if not specified
```

### Option 2: Remove if Not Needed

If feature isn't needed, remove TODO:

```typescript
lastN: 10, // Default last N items
```

**Recommendation:** Check PeekRequest type to see if `lastN` field exists. If yes, implement Option 1. If no, implement Option 2.

---

## TD-012: Enhance IPC Error Messages

### Before

**File:** `src/ipc/client.ts` (Lines 10-80)

```typescript
socket.on('error', (err) => {
  if (!resolved) {
    resolved = true;
    clearTimeout(timeout);
    reject(new Error(`Connection error: ${err.message}`));
  }
});
```

### After

```typescript
socket.on('error', (err) => {
  if (!resolved) {
    resolved = true;
    clearTimeout(timeout);
    const fullMessage = [
      `IPC ${requestName} connection error`,
      `Socket: ${socketPath}`,
      `Details: ${err.message}`,
    ].join(' | ');
    reject(new Error(fullMessage));
  }
});
```

**Benefits:**
- Request name helps identify which call failed
- Socket path aids debugging
- Consistent format across all errors

---

## Testing Checklist

When implementing these refactors, verify:

- [ ] All existing tests pass
- [ ] New helpers are unit tested
- [ ] Error paths work correctly
- [ ] No behavioral changes observed
- [ ] Type checking passes (`npm run check`)
- [ ] Linting passes (`npm run lint`)
- [ ] Code review checks pass

---

## Implementation Order

Recommended order to minimize conflicts:

1. **Day 1:** TD-010, TD-009, TD-012 (isolated changes)
2. **Day 2:** TD-003 (create helper, update cleanup.ts)
3. **Day 3:** TD-006, TD-002 (refactoring)
4. **Day 4:** TD-008 (enhance filters.ts, update network.ts)
5. **Day 5:** TD-011 (add type guards)

---

## Common Patterns

### Pattern 1: Extract Helper Function

```typescript
// Before: Logic scattered in multiple places
if (fs.existsSync(path)) {
  try {
    fs.unlinkSync(path);
  } catch (error) {
    log(`Failed: ${error.message}`);
  }
}

// After: Extracted helper
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

// Usage: One-liner
safeDeleteFile(path, 'metadata file', log);
```

### Pattern 2: Decision Object Return Type

```typescript
// Before: Multiple return values to handle
if (condition1) {
  result.reason = 'reason1';
} else if (condition2) {
  result.reason = 'reason2';
}

// After: Structured decision
interface Decision {
  should: boolean;
  reason?: string;
}

function makeDecision(): Decision {
  if (condition1) return { should: true };
  if (condition2) return { should: false, reason: 'reason2' };
  return { should: false, reason: 'default' };
}
```

### Pattern 3: Simplify Conditional Logic

```typescript
// Before: Complex switch with repetition
switch (code) {
  case A: return X;
  case B: return Y;
  case C: return Y;
  case D: return Y;
  default: return Y;
}

// After: Simple ternary
return code === A ? X : Y;
```

---

## Notes for Reviewers

When reviewing these changes:

1. **Focus on behavior:** Does the code do the same thing?
2. **Check tests:** Are the new helpers properly tested?
3. **Verify types:** Does TypeScript still pass without warnings?
4. **Review error handling:** Are all error cases covered?
5. **Performance:** Any regression in metrics?

---

