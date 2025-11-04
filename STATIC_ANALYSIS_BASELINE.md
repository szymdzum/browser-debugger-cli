# Static Analysis Baseline Report

**Date:** 2025-11-04  
**Tools:** ts-prune v0.10.3, knip v5.38.2  
**Baseline Metrics:**
- Total source files: 56 TypeScript files (non-test)
- Total lines of code: 9,707 lines
- Largest files: session.ts (775), tabs.ts (768), cdp.ts (653)
- Build status: ✅ Clean (no TypeScript errors)
- Test status: ✅ 91 tests passing (28 suites)
- Bundle size: 1.5MB

---

## Summary of Findings

### Unused Exports (High Confidence)

**Constants (src/constants.ts)**
- `CDP_DISCOVER_TARGETS` - Never referenced
- `DEFAULT_MAX_BODY_SIZE` - Defined but unused
- `MEMORY_LOG_INTERVAL` - Logging feature not implemented

**Types (src/types.ts)**
- `CDPTargetDestroyedParams` - Event type not consumed
- `SessionOptions` - Interface defined but not used consistently
- `SessionState` - Lightweight snapshot interface unused

**Utilities**
- `validateCollectorTypes` (src/utils/validation.ts) - Array validator never called
- `InvalidURLError` (src/utils/errors.ts) - Custom error class unused
- `SessionFileError` (src/utils/errors.ts) - Custom error class unused
- Exit code helpers:
  - `getExitCodeForError`
  - `isUserError`
  - `isSoftwareError`
  - `isRetryable`

**Formatter Functions**
- `formatStaleSessionMessage` (src/cli/formatters/statusFormatter.ts)
- `formatNoMetadataMessage` (src/cli/formatters/statusFormatter.ts)
- `formatDiagnosticsForError` (src/utils/chromeDiagnostics.ts)

**Connection Layer**
- `findBestTarget` (src/connection/tabs.ts:178) - Internal function exported
- `navigateToUrl` (src/connection/tabs.ts:519) - Exported but unused
- `waitForTargetReady` (src/connection/tabs.ts:558) - Exported but unused
- `createOrFindTarget` (src/connection/tabs.ts:732) - Public API unused

**Collectors**
- `collectDOM` (src/collectors/dom.ts:51) - Direct export unused (accessed via different pattern)

---

### Unused Files (Should Investigate)

According to knip:
1. `src/__tests__/fixtures/server.cjs` - Test fixture
2. `src/__testutils__/assertions.ts` - Test utilities
3. `src/collectors/console.ts` - **❗ False positive - actively used**
4. `src/daemon.ts` - **❗ False positive - entry point**
5. `src/utils/cdpHandlers.ts` - **❗ False positive - used by collectors**
6. `src/utils/validation.ts` - Contains `validateCollectorTypes` (unused)

**Note:** Several of these are false positives due to dynamic imports or CLI entry points.

---

### Redundant Code (DRY Violations)

**Session Path Wrappers (src/utils/session.ts)**

All of these wrap `getSessionFilePath()`:
```typescript
getPidFilePath() → getSessionFilePath('PID')
getOutputFilePath() → getSessionFilePath('OUTPUT')
getLockFilePath() → getSessionFilePath('LOCK')
getMetadataFilePath() → getSessionFilePath('METADATA')
getChromePidCachePath() → getSessionFilePath('CHROME_PID')
getDaemonPidPath() → getSessionFilePath('DAEMON_PID')
getDaemonSocketPath() → getSessionFilePath('DAEMON_SOCKET')
```

**Usage count:** 
- `getPidFilePath`: 7 call sites
- `getOutputFilePath`: 3 call sites
- `getLockFilePath`: 4 call sites
- `getMetadataFilePath`: 3 call sites
- Others: 2-4 call sites each

**Recommendation:** Consolidate to `getSessionFilePath('TYPE')` API

---

**URL Parsing (duplicated try/catch)**

Repeated pattern in 4+ files:
```typescript
// src/utils/filters.ts
try { const parsedUrl = new URL(url); }
catch { /* fallback */ }

// src/utils/url.ts
try { const parsed = new URL(url); }
catch { /* return url */ }

// Similar in collectors and connection layer
```

**Recommendation:** Extract `safeParseUrl(input: string): URL | null` utility

---

**Error Message Templates (src/connection/cdp.ts)**

12 inline template functions for error messages:
```typescript
const CONNECTION_TIMEOUT_ERROR = 'Connection timeout';
const WEBSOCKET_CONNECTION_CLOSED_ERROR = 'WebSocket connection closed';
const CONNECTION_ATTEMPT_FAILED_MESSAGE = (attempt, delay) => ...
const FAILED_CONNECT_ATTEMPTS_ERROR = (maxRetries, lastErrorMessage) => ...
// ... 8 more
```

**Recommendation:** Extract to `utils/errors/format.ts` with centralized formatters

---

### Dead Code (Potential)

**WebSocketFactory DI (src/connection/cdp.ts:99)**
```typescript
constructor(createWebSocket: WebSocketFactory = (url: string) => new WebSocket(url))
```
- Only used in constructor
- Tests may not leverage this indirection
- **Action:** Check if tests use this, otherwise simplify

**Two-tier preview system validation needed:**
- Claims 241x size reduction (360KB vs 87MB)
- Write frequency: every 5 seconds
- **Action:** Validate with actual metrics, document in constants.ts WHY comments

---

### Test Fixtures (Unused in Main Code)

All test fixtures/utilities correctly flagged as unused in main codebase:
- `src/__testfixtures__/*` - Used only in tests
- `src/__testutils__/*` - Test helper functions
- These are expected and should remain

---

## Action Items (Prioritized)

### High Priority (Clear Wins)
1. ✅ **Remove unused constants:** `CDP_DISCOVER_TARGETS`, `DEFAULT_MAX_BODY_SIZE`, `MEMORY_LOG_INTERVAL`
2. ✅ **Remove unused error classes:** `InvalidURLError`, `SessionFileError`
3. ✅ **Remove unused exit code helpers:** All 4 functions
4. ✅ **Remove unused formatter functions:** 3 functions identified
5. ✅ **Remove `validateCollectorTypes`** - array version unused

### Medium Priority (Requires Review)
6. ⚠️ **Consolidate session path wrappers** - 7 functions → 1 API
7. ⚠️ **Extract URL parsing utility** - Eliminate duplication
8. ⚠️ **Extract error formatting** - Centralize templates
9. ⚠️ **Review exported connection layer functions** - `findBestTarget`, `navigateToUrl`, etc.

### Lower Priority (YAGNI Review)
10. 🔍 **WebSocketFactory DI** - Keep if tests use it, document test seam
11. 🔍 **Two-tier preview** - Validate metrics, add WHY comments
12. 🔍 **SessionOptions interface** - Used inconsistently, consolidate usage

---

## Metrics

**Baseline (before cleanup):**
- Unused exports: ~58 (per knip)
- Unused types: ~26 (per knip)
- LOC in largest file: 775 lines (session.ts)
- Redundant wrapper functions: 7 (session paths)
- URL parsing duplication: 4+ locations

**Target (after cleanup):**
- Unused exports: 0
- Unused types: 0
- LOC in session.ts: <400 lines (after split)
- Redundant wrappers: 0
- URL parsing duplication: 0

---

## Next Steps

1. Create removal PR for unused constants, types, and functions (safe changes)
2. Extract URL parsing utility
3. Consolidate session path wrappers
4. Split session.ts into focused modules
5. Add JSDoc and WHY comments for remaining exports
6. Validate and document YAGNI items (DI pattern, two-tier preview)
