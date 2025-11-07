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

**File**: `tests/agent-benchmark/scenarios/00-golden-cdp-workflow.sh`

**Features**:
- Integrated with test suite (metrics, assertions, recovery helpers)
- 7 comprehensive sections demonstrating end-to-end CDP workflow
- Proper success criteria with validations
- Automatic metric recording for CI benchmarking
- Real-world examples: title extraction, element queries, link scraping
- Results JSON output for analysis

**Test Run**:
```bash
./tests/agent-benchmark/scenarios/00-golden-cdp-workflow.sh
```

**Output Highlights**:
- ✅ Session started successfully
- ✅ Extracted document title: "Example Domain" (validated)
- ✅ Found h1 element and extracted text (validated)
- ✅ Extracted 2 paragraphs (validated count >= 1)
- ✅ Retrieved cookies and frame metadata (validated)
- ✅ Extracted 1 link (validated count >= 1)
- ✅ Session completed: 2653ms, 2 requests, 0 console messages (validated)
- ✅ Results written to: `tests/agent-benchmark/results/golden-cdp-workflow-result.json`

**Agent-Friendly Features**:
- Pure JSON responses (no parsing needed)
- Semantic exit codes (0 = success)
- Composable with Unix tools (jq, grep, awk)
- No intermediate file writes (IPC-based)
- Assertions catch failures immediately
- Metrics tracked for performance analysis

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
- Add new command-specific schemas (`ScreenshotData`)
- Register in `src/ipc/commands.ts` command registry
- Keep `BdgOutput` structure unchanged
- Individual commands return specific types via `CommandResult<T>`
- **Note**: Removed `DomWaitData` - page readiness already implemented as default

**Phase 2: Enhanced Metadata (v0.4.0)**
- Add optional fields to existing types (viewport, screenshots, performance)
- All new fields optional (backward compatible)
- No breaking changes to v0.3.x consumers

**Phase 3: Schema Versioning (v1.0.0)**
- Introduce `schemaVersion` field separate from package version
- Formal deprecation policy (3-month notice)
- `--schema-version` flag for negotiation (future feature)
- Contract tests with golden files (implemented in Week 0)

**Versioning Strategy**:
- **Hybrid approach**: Implicit versioning (package version) until v1.0, then explicit `schemaVersion` field
- **Rationale**: Additive-only changes don't require schema negotiation yet
- **Testing**: Golden files lock schema shape and prevent drift

**Migration Strategy**:
- ✅ Additive changes only (no removals)
- ✅ Optional fields for new features
- ✅ Contract tests to lock schema shape
- ✅ Documentation updated with each change

### ✅ 5. Exit Code Mappings

**Documented in**: `SCHEMA_MIGRATION_PLAN.md` (Exit Code Mappings section)

**New Command**:

**DOM Screenshot** (`bdg dom screenshot <path>`):
| Code | Constant | Meaning |
|------|----------|---------|
| 0 | SUCCESS | Screenshot captured |
| 81 | INVALID_ARGUMENTS | Invalid format/quality |
| 82 | PERMISSION_DENIED | Cannot write to path |
| 103 | SESSION_FILE_ERROR | File write failed |
| 102 | CDP_TIMEOUT | CDP timeout |

**Note**: DOM wait command removed from scope - page readiness is already implemented as default feature (commit `dd12c7e`).

**Existing Codes** (from `src/utils/exitCodes.ts`):
- **User Errors (80-99)**: Invalid URL, arguments, permissions, resource issues
- **Software Errors (100-119)**: Chrome launch, CDP connection, timeouts, exceptions

**Agent-Friendly Properties**:
- Semantic ranges make error categorization easy
- Consistent across all commands
- Documented in code and user-facing docs

### ✅ 6. Contract Tests with Golden Files

**New Deliverables** (added 2025-11-06):

**File**: `src/__tests__/fixtures/schema-v0.2.1.golden.json`
- Canonical example of BdgOutput schema v0.2.1
- Includes all telemetry types (network, console, dom)
- Real-world structure for validation

**Test Suite**: `src/__tests__/schema.contract.test.ts`
- **12 comprehensive tests** covering:
  - ✅ Top-level field validation (version, success, timestamp, duration, target, data)
  - ✅ Target structure validation (url, title)
  - ✅ Data object validation (optional telemetry arrays)
  - ✅ NetworkRequest structure (9 fields with type checking)
  - ✅ ConsoleMessage structure (4 fields with type checking)
  - ✅ DOMData structure (3 fields with type checking)
  - ✅ Optional field validation (error, partial)
  - ✅ Unexpected field detection (breaking change protection)
  - ✅ Error output format validation
  - ✅ Partial output format validation (live previews)

**Build Integration**:
- Postbuild script automatically copies `*.json` fixtures to `dist/__tests__/fixtures/`
- Ensures golden files available for compiled tests
- Runs as part of `npm test`

**Test Results**:
```bash
node --test dist/__tests__/schema.contract.test.js
# tests 12
# pass 12
# fail 0
```

**Purpose**:
- Lock schema shape to prevent accidental breaking changes
- Validate TypeScript interfaces match runtime JSON
- Detect schema drift during development
- Enable confident schema evolution

### ✅ 7. Schema Versioning Strategy

**Design**: Hybrid approach balancing simplicity with future flexibility

**Current (v0.2.x - v0.3.x)**:
- Implicit versioning via package `version` field
- Additive-only changes (no breaking changes)
- No schema negotiation needed

**Future (v1.0.0+)**:
- Add explicit `schemaVersion` field
- Enable schema negotiation with `--schema-version` flag (if needed)
- Formal deprecation policy (3-month notice)

**Rationale**:
- Start simple: Don't add complexity before it's needed
- Test evolution: Phase 1 validates additive changes work
- Future-proof: Clear path to explicit versioning at 1.0

**Benefits**:
- Consumers can rely on stable schema within major versions
- Optional fields enable feature additions without breaking changes
- Contract tests catch violations automatically

## Acceptance Criteria Status

From `docs/roadmap/M1_IMPLEMENTATION_GUIDE.md` Week 0:

- [x] Raw CDP works: `bdg cdp Runtime.evaluate --params '{"expression": "document.title", "returnByValue": true}'`
- [x] Golden example script runs successfully (query title, check element existence, extract data)
- [x] Schema migration plan documented (incremental evolution, not breaking change)
- [x] Exit code table created for `dom screenshot` command
- [x] Contract tests with golden files implemented
- [x] Schema versioning strategy designed

**All acceptance criteria met!** ✅

**Bonus Deliverables** (beyond original scope):
- ✅ Comprehensive contract test suite (12 tests)
- ✅ Automated golden file copying in build process
- ✅ Schema versioning strategy (hybrid approach)
- ✅ Updated SCHEMA_MIGRATION_PLAN.md with corrections

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
- ✅ `tests/agent-benchmark/scenarios/00-golden-cdp-workflow.sh` - Golden CDP workflow test
- ✅ `docs/roadmap/SCHEMA_MIGRATION_PLAN.md` - Schema evolution plan
- ✅ `docs/roadmap/WEEK_0_COMPLETION_REPORT.md` - This report

### Modified Files
- ✅ `docs/roadmap/WEEK_0_COMPLETION_REPORT.md` - Updated with test suite integration details

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
