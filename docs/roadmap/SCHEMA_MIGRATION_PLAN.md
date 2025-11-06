# Schema Migration Plan

**Date**: 2025-11-06
**Current Version**: 0.2.1
**Target**: Foundation for Week 0 (M1)

## Current Schema Analysis

### BdgOutput Schema (v0.2.1)

The current output schema is defined in `src/types.ts:46-62`:

```typescript
export interface BdgOutput {
  version: string;        // Package version for schema tracking
  success: boolean;
  timestamp: string;
  duration: number;
  target: {
    url: string;
    title: string;
  };
  data: {
    dom?: DOMData;
    network?: NetworkRequest[];
    console?: ConsoleMessage[];
  };
  error?: string;
  partial?: boolean;      // Flag for partial/incomplete data (live preview)
}
```

### Supporting Types

**DOMData** (`src/types.ts:20-24`):
```typescript
export interface DOMData {
  url: string;
  title: string;
  outerHTML: string;
}
```

**NetworkRequest** (`src/types.ts:26-37`):
```typescript
export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  timestamp: number;
  status?: number;
  mimeType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
}
```

**ConsoleMessage** (`src/types.ts:39-44`):
```typescript
export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
  args?: unknown[];      // Raw console arguments from CDP
}
```

### Schema Usage Points

1. **Session Output** (`src/session/output.ts`) - Final JSON written on stop
2. **Peek Command** (`src/ipc/types.ts:124-142`) - Live preview data
3. **Command Responses** (`src/commands/shared/CommandRunner.ts`) - Individual command outputs

## Future Command Requirements

Based on the roadmap (`docs/roadmap/01_AGENTS_FOUNDATION.md`), we need to support:

### 1. DOM Screenshot Command (`bdg dom screenshot`)

**Purpose**: Capture visual screenshots of the page (complements DOM HTML capture).

**Rationale**: While DOM HTML (`data.dom.outerHTML`) provides semantic content, screenshots capture the visual rendering including:
- External CSS stylesheets and computed styles
- Images, canvas elements, video frames
- Actual layout and visual state
- Useful for visual regression testing and debugging layout issues

**New output fields needed:**
```typescript
interface ScreenshotData {
  path: string;            // File path where screenshot was saved
  format: 'png' | 'jpeg';
  quality?: number;        // JPEG quality (0-100)
  width: number;           // Image width in pixels
  height: number;          // Image height in pixels
  size: number;            // File size in bytes
  viewport?: {             // If fullPage is false
    width: number;
    height: number;
  };
  fullPage: boolean;
}
```

**Exit codes:**
- 0: Screenshot captured successfully
- 81: Invalid arguments (invalid format, quality, path)
- 82: Permission denied (cannot write to path)
- 103: SESSION_FILE_ERROR (File write failed)
- 102: CDP timeout

**Note**: Page readiness (waiting for DOM to be ready) is already implemented as a default feature in the page readiness logic (see commit `dd12c7e`). No additional `bdg dom wait` command is needed for basic DOM readiness.

## Migration Strategy

### Phase 1: Backward Compatible Extensions (v0.3.0)

**Goal**: Add new command-specific schemas without breaking v0.2.x consumers.

**Approach**: Additive changes only, no removals or breaking modifications.

**Changes**:
1. Add `ScreenshotData` interface to `src/types.ts`
2. Register new command in `src/ipc/commands.ts`:
   ```typescript
   dom_screenshot: {
     requestSchema: {} as DomScreenshotCommand,
     responseSchema: {} as ScreenshotData,
   }
   ```
3. Keep `BdgOutput` structure unchanged
4. Individual commands return their specific data types

**Compatibility**:
- ✅ Existing `session.json` format unchanged
- ✅ Existing peek/status commands unchanged
- ✅ New commands return specific data types in `CommandResult<T>` wrapper
- ✅ `BdgOutput.data` remains the same (dom, network, console)

### Phase 2: Enhanced Metadata (v0.4.0)

**Goal**: Add optional metadata for advanced use cases.

**Approach**: Add optional fields to existing types.

**Potential additions to BdgOutput**:
```typescript
export interface BdgOutput {
  version: string;
  success: boolean;
  timestamp: string;
  duration: number;
  target: {
    url: string;
    title: string;
    // NEW: Optional viewport info
    viewport?: {
      width: number;
      height: number;
      deviceScaleFactor: number;
    };
  };
  data: {
    dom?: DOMData;
    network?: NetworkRequest[];
    console?: ConsoleMessage[];
    // NEW: Optional screenshot references
    screenshots?: Array<{
      path: string;
      timestamp: number;
      type: 'manual' | 'auto';
    }>;
  };
  error?: string;
  partial?: boolean;
  // NEW: Optional performance metrics
  performance?: {
    firstContentfulPaint?: number;
    domContentLoaded?: number;
    loadComplete?: number;
  };
}
```

**Compatibility**:
- ✅ All new fields are optional
- ✅ v0.3.x consumers can ignore new fields
- ✅ No breaking changes to existing fields

### Phase 3: Schema Versioning (v1.0.0)

**Goal**: Introduce formal schema versioning for future evolution.

**Approach**: Add `schemaVersion` field and deprecation policy.

**Changes**:
```typescript
export interface BdgOutput {
  version: string;         // Package version (e.g., "1.0.0")
  schemaVersion: string;   // Schema version (e.g., "1.0")
  // ... rest of schema
}
```

**Deprecation Policy** (documented in `docs/SCHEMA.md`):
1. Schema changes require minor version bump (0.3.x → 0.4.0)
2. Breaking changes require major version bump (0.x → 1.0)
3. Deprecated fields announced 3 months in advance
4. `--schema-version` flag for negotiation (future)
5. Contract tests lock JSON shape with golden files

## Exit Code Mappings

### New Commands Exit Codes

**DOM Screenshot** (`bdg dom screenshot <path>`):
| Code | Constant | Meaning | Suggestion |
|------|----------|---------|------------|
| 0 | SUCCESS | Screenshot captured | - |
| 81 | INVALID_ARGUMENTS | Invalid format/quality | Use png/jpeg, quality 0-100 |
| 82 | PERMISSION_DENIED | Cannot write to path | Check directory permissions |
| 103 | SESSION_FILE_ERROR | File write failed | Check disk space, path exists |
| 102 | CDP_TIMEOUT | CDP command timeout | Retry operation |

**Existing Commands** (from `src/utils/exitCodes.ts`):

**User Errors (80-99)**:
- 80: `INVALID_URL` - Malformed URL
- 81: `INVALID_ARGUMENTS` - Invalid CLI arguments
- 82: `PERMISSION_DENIED` - Insufficient permissions
- 83: `RESOURCE_NOT_FOUND` - Resource not found
- 84: `RESOURCE_ALREADY_EXISTS` - Resource already exists
- 85: `RESOURCE_BUSY` - Resource is busy
- 86: `DAEMON_ALREADY_RUNNING` - Daemon already running

**Software Errors (100-119)**:
- 100: `CHROME_LAUNCH_FAILURE` - Chrome failed to launch
- 101: `CDP_CONNECTION_FAILURE` - CDP connection failed
- 102: `CDP_TIMEOUT` - CDP operation timeout
- 103: `SESSION_FILE_ERROR` - Session file I/O error
- 104: `UNHANDLED_EXCEPTION` - Unhandled exception
- 105: `SIGNAL_HANDLER_ERROR` - Signal handler error

## Testing Strategy

### Contract Tests

✅ **IMPLEMENTED**: Golden files and contract tests now in place.

**File**: `src/__tests__/fixtures/schema-v0.2.1.golden.json` (created 2025-11-06)
- Canonical example of v0.2.1 BdgOutput schema
- Includes all telemetry types (network, console, dom)
- Used by contract tests to prevent schema drift

**Test**: `src/__tests__/schema.contract.test.ts` (created 2025-11-06)
- ✅ Validates BdgOutput structure matches TypeScript interfaces
- ✅ Ensures all required fields are present with correct types
- ✅ Detects unexpected fields (potential breaking changes)
- ✅ Tests error and partial output formats
- ✅ Validates nested structures (NetworkRequest, ConsoleMessage, DOMData)
- ✅ Runs as part of `npm test`

**Build Integration**: `package.json` postbuild script
- Automatically copies `*.json` fixtures to `dist/__tests__/fixtures/`
- Ensures golden files are available for compiled tests

### Migration Tests

**File**: `src/__tests__/schema-migration.test.ts`
- Test that v0.3.0 can read v0.2.1 output
- Test that new optional fields don't break old consumers
- Test that new commands return valid schemas

## Implementation Checklist

### Week 0 (Current) ✅ COMPLETE
- [x] Test `bdg cdp Runtime.evaluate` with real examples
- [x] Create golden example script showing full raw CDP workflow
- [x] Audit existing output schema (`BdgOutput` in `src/types.ts`)
- [x] Plan schema migration path (this document)
- [x] Document exit code mappings for new commands (this document)
- [x] Create contract tests with golden files (`src/__tests__/schema.contract.test.ts`)
- [x] Design schema versioning strategy (hybrid approach: implicit now, explicit at v1.0.0)

### Week 1-2 (Screenshot Implementation)
- [ ] Add `ScreenshotData` interface to `src/types.ts`
- [ ] Register `dom_screenshot` command in `src/ipc/commands.ts`
- [ ] Implement worker handler in `src/daemon/worker.ts`
- [ ] Add CLI command `bdg dom screenshot` in `src/commands/dom.ts`
- [ ] Add golden file for screenshot response
- [ ] Update contract tests to validate ScreenshotData
- [ ] Document usage in `docs/agents/dom-screenshot.md`

### Week 5-6 (Documentation & Polish)
- [ ] Create `docs/SCHEMA.md` with formal schema documentation
- [ ] Add migration guide for consumers
- [ ] Update exit code reference in CLI_REFERENCE.md
- [ ] Create integration tests using golden workflow script
- [ ] Validate with real agent workflows (bash, node, python)

## Recommendations

1. **Keep it simple**: Don't add schema complexity unless there's clear value
2. **Additive only**: No breaking changes until 1.0.0
3. **Test first**: Create contract tests before implementing new commands
4. **Document early**: Update docs as schemas evolve, not after
5. **Agent validation**: Test with real agent scripts to ensure usability

## Decisions Made (Previously Open Questions)

1. **Should `BdgOutput.data` be extended with command-specific results, or should individual commands return their own types?**
   - ✅ **Decision**: Individual commands return their own types (current pattern). `BdgOutput` is for final session output only.
   - **Rationale**: Keeps `BdgOutput` focused on session-level telemetry. Command-specific data doesn't belong in the final output.

2. **Do we need a `--schema-version` flag now, or wait until 1.0?**
   - ✅ **Decision**: Wait until 1.0. Use hybrid approach: implicit versioning via package version (0.x), explicit `schemaVersion` field at 1.0.
   - **Rationale**: Current additive approach doesn't require negotiation. Adding `schemaVersion` field can be done at 1.0 when we formalize the contract.

3. **Should screenshot metadata be included in `session.json`, or kept separate?**
   - ✅ **Decision**: Keep separate. Screenshots are artifacts (binary files), not telemetry data.
   - **Rationale**: `session.json` is for structured telemetry. Phase 2 (v0.4.0) may add optional `screenshots[]` array with file references if needed.

4. **How should we handle CDP errors vs command errors?**
   - ✅ **Decision**: Use semantic exit codes. CDP errors: 102 (timeout), 101 (connection failure). Include CDP error details in `error` field.
   - **Rationale**: Exit codes enable agent-friendly error handling. Human-readable error messages in `error` field provide context.

## Related Documents

- [CLI Reference](../CLI_REFERENCE.md) - Exit code documentation
- [Agent-Friendly Tools](../AGENT_FRIENDLY_TOOLS.md) - Design principles
- [M1 Implementation Guide](M1_IMPLEMENTATION_GUIDE.md) - Week 0-4 tasks
- [01 Agents Foundation](01_AGENTS_FOUNDATION.md) - M1 deliverables
