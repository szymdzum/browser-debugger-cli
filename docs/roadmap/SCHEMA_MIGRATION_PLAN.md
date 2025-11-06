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

### 1. DOM Wait Command (`bdg dom wait`)

**New output fields needed:**
```typescript
interface DomWaitData {
  selector: string;
  found: boolean;
  waitTime: number;        // Milliseconds waited
  timeout?: number;        // Timeout value if provided
  nodeId?: number;         // If found
  timedOut?: boolean;      // True if wait exceeded timeout
}
```

**Exit codes:**
- 0: Element found
- 83: Element not found (RESOURCE_NOT_FOUND)
- 102: Wait timeout exceeded (CDP_TIMEOUT)

### 2. Page Screenshot Command (`bdg page screenshot`)

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
- 102: CDP timeout

## Migration Strategy

### Phase 1: Backward Compatible Extensions (v0.3.0)

**Goal**: Add new command-specific schemas without breaking v0.2.x consumers.

**Approach**: Additive changes only, no removals or breaking modifications.

**Changes**:
1. Add `DomWaitData` interface to `src/types.ts`
2. Add `ScreenshotData` interface to `src/types.ts`
3. Register new commands in `src/ipc/commands.ts`:
   ```typescript
   dom_wait: {
     requestSchema: {} as DomWaitCommand,
     responseSchema: {} as DomWaitData,
   },
   page_screenshot: {
     requestSchema: {} as PageScreenshotCommand,
     responseSchema: {} as ScreenshotData,
   }
   ```
4. Keep `BdgOutput` structure unchanged
5. Individual commands return their specific data types

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

**DOM Wait** (`bdg dom wait <selector>`):
| Code | Constant | Meaning | Suggestion |
|------|----------|---------|------------|
| 0 | SUCCESS | Element found | - |
| 81 | INVALID_ARGUMENTS | Invalid selector syntax | Check selector format |
| 83 | RESOURCE_NOT_FOUND | Element not found | Increase timeout or check selector |
| 102 | CDP_TIMEOUT | Wait timeout exceeded | Increase --timeout value |

**Page Screenshot** (`bdg page screenshot <path>`):
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

Create golden files to lock schema shape:

**File**: `src/__tests__/fixtures/session-output.golden.json`
```json
{
  "version": "0.2.1",
  "success": true,
  "timestamp": "2025-11-06T19:35:52.438Z",
  "duration": 2695,
  "target": {
    "url": "https://example.com/",
    "title": "Example Domain"
  },
  "data": {
    "network": [...],
    "console": [...],
    "dom": {...}
  }
}
```

**Test**: `src/__tests__/schema.contract.test.ts`
- Validate BdgOutput structure matches schema
- Ensure all fields are present with correct types
- Check for unexpected fields (breaking changes)
- Verify exit codes match documented values

### Migration Tests

**File**: `src/__tests__/schema-migration.test.ts`
- Test that v0.3.0 can read v0.2.1 output
- Test that new optional fields don't break old consumers
- Test that new commands return valid schemas

## Implementation Checklist

### Week 0 (Current)
- [x] Test `bdg cdp Runtime.evaluate` with real examples
- [x] Create golden example script showing full raw CDP workflow
- [x] Audit existing output schema (`BdgOutput` in `src/types.ts`)
- [ ] Plan schema migration path (this document)
- [ ] Document exit code mappings for new commands (this document)

### Week 1-2 (DOM Wait Implementation)
- [ ] Add `DomWaitData` interface to `src/types.ts`
- [ ] Register `dom_wait` command in `src/ipc/commands.ts`
- [ ] Implement worker handler in `src/daemon/worker.ts`
- [ ] Add CLI command in `src/commands/dom.ts`
- [ ] Create contract tests with golden files
- [ ] Document usage in `docs/agents/dom-wait.md`

### Week 3-4 (Screenshot Implementation)
- [ ] Add `ScreenshotData` interface to `src/types.ts`
- [ ] Register `page_screenshot` command in `src/ipc/commands.ts`
- [ ] Implement worker handler in `src/daemon/worker.ts`
- [ ] Add CLI command in `src/commands/page.ts`
- [ ] Create contract tests with golden files
- [ ] Document usage in `docs/agents/page-screenshot.md`

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

## Open Questions

1. Should `BdgOutput.data` be extended with command-specific results, or should individual commands return their own types?
   - **Recommendation**: Individual commands return their own types (current pattern). `BdgOutput` is for final session output only.

2. Do we need a `--schema-version` flag now, or wait until 1.0?
   - **Recommendation**: Wait until we have breaking changes. Current additive approach doesn't require versioning yet.

3. Should screenshot metadata be included in `session.json`, or kept separate?
   - **Recommendation**: Keep separate. Screenshots are artifacts, not telemetry. Reference via `screenshots` array if needed.

4. How should we handle CDP errors vs command errors?
   - **Recommendation**: Use exit codes (102 for CDP timeouts, 101 for connection failures). Include CDP error details in `error` field.

## Related Documents

- [CLI Reference](../CLI_REFERENCE.md) - Exit code documentation
- [Agent-Friendly Tools](../AGENT_FRIENDLY_TOOLS.md) - Design principles
- [M1 Implementation Guide](M1_IMPLEMENTATION_GUIDE.md) - Week 0-4 tasks
- [01 Agents Foundation](01_AGENTS_FOUNDATION.md) - M1 deliverables
