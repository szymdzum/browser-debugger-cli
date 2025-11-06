# Week 0 Foundation - Completion Report

**Date**: 2025-11-06
**Branch**: `foundation/week-0-cdp-validation`
**Status**: ✅ All acceptance criteria met

## Deliverables

### ✅ 1. Raw CDP Works End-to-End

**Test Command**:
```bash
bdg cdp Runtime.evaluate --params '{"expression":"document.title","returnByValue":true}'
```

**Result**:
```json
{
  "result": {
    "type": "string",
    "value": "Example Domain"
  }
}
```

**Validated Operations**:
- ✅ Query document title
- ✅ Check element existence
- ✅ Extract data from multiple elements
- ✅ Get cookies (`Network.getCookies`)
- ✅ Get frame tree (`Page.getFrameTree`)
- ✅ Complex array/object extraction

**Key Findings**:
1. **Shell escaping required**: Double quotes in JSON params must be escaped (`\"`)
2. **Timeout handling**: Default worker response timeout is 10s (sufficient for most operations)
3. **Pure JSON output**: All CDP responses are raw JSON (pipe-friendly for agents)
4. **Exit codes working**: Invalid JSON params return exit code 81 (INVALID_ARGUMENTS)

### ✅ 2. Golden Example Script

**File**: `examples/agents/golden-cdp-workflow.sh`

**Features**:
- 7 comprehensive sections demonstrating end-to-end CDP workflow
- Color-coded output with success/error indicators
- Graceful cleanup with trap handlers
- Optional jq integration for pretty JSON processing
- Real-world examples: title extraction, element queries, link scraping
- Session statistics summary

**Test Run**:
```bash
./examples/agents/golden-cdp-workflow.sh https://example.com
```

**Output Highlights**:
- ✅ Session started successfully
- ✅ Extracted document title: "Example Domain"
- ✅ Found h1 element and extracted text
- ✅ Extracted 2 paragraphs
- ✅ Found 1 link with URL and text
- ✅ Session completed: 2695ms duration, 2 network requests

**Agent-Friendly Features**:
- Pure JSON responses (no parsing needed)
- Semantic exit codes (0 = success)
- Composable with Unix tools (jq, grep, awk)
- No intermediate file writes (IPC-based)

### ✅ 3. Output Schema Audit

**Current Schema** (`src/types.ts:46-62`):
```typescript
export interface BdgOutput {
  version: string;        // Package version: "0.2.1"
  success: boolean;
  timestamp: string;      // ISO 8601
  duration: number;       // Milliseconds
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
  partial?: boolean;      // Live preview flag
}
```

**Key Observations**:
1. **Stable structure**: No changes needed for v0.2.x
2. **Optional fields**: `dom`, `network`, `console` are optional (telemetry-dependent)
3. **Error handling**: `error` field present when `success: false`
4. **Version tracking**: `version` field enables schema evolution
5. **Partial data**: `partial` flag used by `peek` command for live previews

**Validated Against Real Output**:
```bash
cat ~/.bdg/session.json | jq 'keys'
# ["data", "duration", "success", "target", "timestamp", "version"]
```

All expected fields present and types match schema.

### ✅ 4. Schema Migration Plan

**Document**: `docs/roadmap/SCHEMA_MIGRATION_PLAN.md`

**Key Decisions**:

**Phase 1: Backward Compatible Extensions (v0.3.0)**
- Add new command-specific schemas (`DomWaitData`, `ScreenshotData`)
- Register in `src/ipc/commands.ts` command registry
- Keep `BdgOutput` structure unchanged
- Individual commands return specific types via `CommandResult<T>`

**Phase 2: Enhanced Metadata (v0.4.0)**
- Add optional fields to existing types (viewport, screenshots, performance)
- All new fields optional (backward compatible)
- No breaking changes to v0.3.x consumers

**Phase 3: Schema Versioning (v1.0.0)**
- Introduce `schemaVersion` field
- Formal deprecation policy (3-month notice)
- `--schema-version` flag for negotiation
- Contract tests with golden files

**Migration Strategy**:
- ✅ Additive changes only (no removals)
- ✅ Optional fields for new features
- ✅ Contract tests to lock schema shape
- ✅ Documentation updated with each change

### ✅ 5. Exit Code Mappings

**Documented in**: `SCHEMA_MIGRATION_PLAN.md` (Exit Code Mappings section)

**New Commands**:

**DOM Wait** (`bdg dom wait <selector>`):
| Code | Constant | Meaning |
|------|----------|---------|
| 0 | SUCCESS | Element found |
| 81 | INVALID_ARGUMENTS | Invalid selector |
| 83 | RESOURCE_NOT_FOUND | Element not found |
| 102 | CDP_TIMEOUT | Wait timeout exceeded |

**Page Screenshot** (`bdg page screenshot <path>`):
| Code | Constant | Meaning |
|------|----------|---------|
| 0 | SUCCESS | Screenshot captured |
| 81 | INVALID_ARGUMENTS | Invalid format/quality |
| 82 | PERMISSION_DENIED | Cannot write to path |
| 103 | SESSION_FILE_ERROR | File write failed |
| 102 | CDP_TIMEOUT | CDP timeout |

**Existing Codes** (from `src/utils/exitCodes.ts`):
- **User Errors (80-99)**: Invalid URL, arguments, permissions, resource issues
- **Software Errors (100-119)**: Chrome launch, CDP connection, timeouts, exceptions

**Agent-Friendly Properties**:
- Semantic ranges make error categorization easy
- Consistent across all commands
- Documented in code and user-facing docs

## Acceptance Criteria Status

From `docs/roadmap/01_AGENTS_FOUNDATION.md` Week 0:

- [x] Raw CDP works: `bdg cdp Runtime.evaluate --params '{"expression": "document.title", "returnByValue": true}'`
- [x] Golden example script runs successfully (query title, check element existence, extract data)
- [x] Schema migration plan documented (incremental evolution, not breaking change)
- [x] Exit code table created for `dom.wait` and `page.screenshot`

**All acceptance criteria met!** ✅

## Technical Insights

### 1. CDP Command Architecture

**Flow**: CLI → IPC Client → Daemon → Worker → CDP Connection → Chrome

**Key Files**:
- `src/commands/cdp.ts` - CLI command handler
- `src/ipc/client.ts:303-308` - `callCDP()` function
- `src/daemon/worker.ts:503-507` - `cdp_call` handler
- `src/ipc/commands.ts:195-198` - Command registry entry

**Benefits**:
- Worker maintains persistent CDP connection (no reconnection overhead)
- IPC enables live queries during active sessions
- Pure JSON responses (no formatting, agent-friendly)

### 2. Error Handling

**Pattern**: CommandRunner + validateIPCResponse + semantic exit codes

```typescript
// src/commands/cdp.ts:30-59
await runCommand(
  async (opts) => {
    const response = await callCDP(method, params);
    validateIPCResponse(response);  // Throws on error
    return { success: true, data: response.data?.result };
  },
  { ...options, json: true }  // Force JSON output
);
```

**Exit Code Flow**:
1. Invalid JSON params → 81 (INVALID_ARGUMENTS)
2. CDP error → 102 (CDP_TIMEOUT) or 101 (CDP_CONNECTION_FAILURE)
3. Worker timeout → 104 (UNHANDLED_EXCEPTION)

### 3. JSON Output Consistency

**All CDP responses**:
- Pure JSON to stdout (no wrapper, no formatting)
- Status messages to stderr (separated from data)
- Exit code indicates success (0) or error category (80-99, 100-119)

**Agent Script Pattern**:
```bash
RESULT=$(bdg cdp Runtime.evaluate --params '{"expression":"...","returnByValue":true}')
if [ $? -eq 0 ]; then
  VALUE=$(echo "$RESULT" | jq -r '.result.value')
  # Process value...
fi
```

## Next Steps

### Week 1-2: DOM Wait Implementation

1. **Add DomWaitData schema** to `src/types.ts`
2. **Register command** in `src/ipc/commands.ts`
3. **Implement worker handler** in `src/daemon/worker.ts`:
   ```typescript
   dom_wait: async (cdp, params) => {
     const startTime = Date.now();
     const timeout = params.timeout ?? 5000;

     while (Date.now() - startTime < timeout) {
       const nodeIds = await queryBySelector(cdp, params.selector);
       if (nodeIds.length > 0) {
         return {
           selector: params.selector,
           found: true,
           waitTime: Date.now() - startTime,
           nodeId: nodeIds[0],
         };
       }
       await new Promise(resolve => setTimeout(resolve, 100));
     }

     return {
       selector: params.selector,
       found: false,
       waitTime: Date.now() - startTime,
       timedOut: true,
     };
   }
   ```
4. **Add CLI command** in `src/commands/dom.ts`
5. **Create contract tests** with golden files
6. **Document usage** in `docs/agents/dom-wait.md`

### Week 3-4: Screenshot Implementation

Follow same pattern as DOM Wait, using `Page.captureScreenshot` CDP method.

### Week 5-6: Documentation & Polish

- Create `docs/SCHEMA.md`
- Update `docs/CLI_REFERENCE.md` with exit codes
- Create integration tests
- Validate with real agent workflows

## Files Changed

### New Files
- ✅ `examples/agents/golden-cdp-workflow.sh` - Golden example script
- ✅ `docs/roadmap/SCHEMA_MIGRATION_PLAN.md` - Schema evolution plan
- ✅ `docs/roadmap/WEEK_0_COMPLETION_REPORT.md` - This report

### Modified Files
- None (Week 0 is validation and planning only)

## Recommendations

1. **Merge to main**: Week 0 validation complete, foundation solid
2. **Start Week 1**: DOM Wait implementation ready to begin
3. **Contract tests first**: Create golden files before implementing new commands
4. **Document as you go**: Update docs with each schema change
5. **Agent validation**: Test with bash/node/python scripts throughout

## Conclusion

Week 0 Foundation is **complete and validated**. All acceptance criteria met:

✅ Raw CDP works end-to-end
✅ Golden example script demonstrates full workflow
✅ Schema audited and stable
✅ Migration plan documented with backward compatibility
✅ Exit codes mapped for new commands

**Ready to proceed to Week 1**: DOM Wait implementation.

---

**Branch**: `foundation/week-0-cdp-validation`
**Status**: Ready for review and merge
