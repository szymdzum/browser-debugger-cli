# Agent-Friendly Consistency Plan

> Comprehensive plan to address gaps in principle implementation and prevent regressions

**Branch:** `fix/agent-friendly-consistency`  
**Created:** 2025-11-26  
**Status:** Mostly Complete (2025-11-27)

---

## Implementation Status

| Gap | Description | Status | Notes |
|-----|-------------|--------|-------|
| G1 | Exit code 87 missing from help | ✅ Done | Already in `--help --json` |
| G2 | Inconsistent exit code usage | ⚠️ Acceptable | UNHANDLED_EXCEPTION used appropriately |
| G3 | SOFTWARE_ERROR never used | ✅ Done | Now used in 20+ places |
| G4 | Typo detection only for CDP | ⚠️ Deferred | Low priority, CDP is main use case |
| G5 | Inconsistent JSON structures | ✅ Done | Schema contract tests exist |
| G6 | Commands bypass runCommand | ✅ Reviewed | `tail.ts` intentional (follow mode) |
| G7 | suggestion vs suggestions | ✅ Done | Keeping `suggestion` (singular) |
| G8 | Errors missing suggestions | ✅ Declined | Many errors intentionally have none |
| G9 | stdout/stderr consistency | ⚠️ Acceptable | Current behavior is correct |
| G10 | Hints on stderr | ⚠️ Acceptable | Follows Unix convention |
| G11 | Task mappings missing | ⚠️ Deferred | Low priority |

### Prevention Mechanisms Status

| Mechanism | Status | Notes |
|-----------|--------|-------|
| Custom ESLint rules | ❌ Declined | TypeScript sufficient |
| Type-level enforcement | ✅ In place | Via `ErrorMetadata`, `BdgResponse` |
| Schema validation in CI | ✅ Exists | `schema.contract.test.ts` |
| Pre-commit hooks | ✅ Exists | lint-staged configured |
| Code review checklist | 📋 Reference | In this document |

### Additional Fixes (2025-11-27)

- **Index consistency**: Unified `--index` to 0-based across all commands

---

## Table of Contents

1. [Problem Summary](#problem-summary)
2. [Architecture Changes](#architecture-changes)
3. [Implementation Phases](#implementation-phases)
4. [Prevention Mechanisms](#prevention-mechanisms)
5. [Testing Strategy](#testing-strategy)
6. [Migration Guide](#migration-guide)

---

## Problem Summary

### Gaps Identified

| ID | Gap | Severity | Phase |
|----|-----|----------|-------|
| G1 | Exit code 87 (STALE_CACHE) missing from help docs | LOW | 1 |
| G2 | Inconsistent exit code usage (UNHANDLED_EXCEPTION overused) | MEDIUM | 2 |
| G3 | Exit code 110 (SOFTWARE_ERROR) never used | LOW | 2 |
| G4 | Typo detection only for CDP, not other commands | MEDIUM | 3 |
| G5 | Inconsistent JSON output structures across commands | HIGH | 1 |
| G6 | Some commands bypass `runCommand` pattern | MEDIUM | 1 |
| G7 | Inconsistent suggestion field names (suggestion vs suggestions) | LOW | 2 |
| G8 | Some errors have no suggestions | LOW | 2 |
| G9 | Inconsistent stdout/stderr for errors | MEDIUM | 2 |
| G10 | Hints on stderr may break parsing | LOW | 2 |
| G11 | Task mappings missing some commands | LOW | 3 |

### Root Causes

1. **No enforced output contract** - Commands evolved independently without schema validation
2. **Multiple error handling patterns** - Some commands use `runCommand`, others don't
3. **No lint rules for consistency** - Easy to introduce inconsistencies without noticing
4. **Documentation drift** - EXIT_CODE_DOCS not generated from source of truth

---

## Architecture Changes

### 1. Unified Response Envelope

All commands MUST return responses matching this TypeScript interface:

```typescript
// src/types/response.ts (NEW FILE)

/**
 * Standard response envelope for all bdg commands.
 * 
 * This is a STABLE API CONTRACT - changes require major version bump.
 */
export interface BdgResponse<T = unknown> {
  /** Tool version for schema compatibility */
  version: string;
  
  /** Whether the command succeeded */
  success: boolean;
  
  /** Response data (present when success=true) */
  data?: T;
  
  /** Error message (present when success=false) */
  error?: string;
  
  /** Semantic exit code */
  exitCode?: number;
  
  /** Actionable suggestion for error recovery */
  suggestion?: string;
  
  /** Additional context (rarely needed) */
  context?: Record<string, unknown>;
}

/**
 * Type guard for BdgResponse validation.
 */
export function isBdgResponse(value: unknown): value is BdgResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    'success' in value &&
    typeof (value as BdgResponse).version === 'string' &&
    typeof (value as BdgResponse).success === 'boolean'
  );
}
```

### 2. Centralized Exit Code Registry

Generate EXIT_CODE_DOCS from EXIT_CODES to prevent drift:

```typescript
// src/utils/exitCodes.ts (MODIFY)

export const EXIT_CODES = {
  SUCCESS: 0,
  GENERIC_FAILURE: 1,
  // ... existing codes
} as const;

/**
 * Exit code metadata for documentation and help output.
 * Generated from EXIT_CODES to prevent drift.
 */
export const EXIT_CODE_REGISTRY: Record<number, { name: string; description: string; category: 'success' | 'user' | 'software' }> = {
  [EXIT_CODES.SUCCESS]: {
    name: 'SUCCESS',
    description: 'Operation completed successfully',
    category: 'success',
  },
  [EXIT_CODES.INVALID_URL]: {
    name: 'INVALID_URL',
    description: 'Invalid URL format provided',
    category: 'user',
  },
  // ... all codes with metadata
};

/**
 * Get exit code docs for --help --json output.
 * Single source of truth - no manual EXIT_CODE_DOCS array.
 */
export function getExitCodeDocs(): Array<{ code: number; name: string; description: string }> {
  return Object.entries(EXIT_CODE_REGISTRY)
    .map(([code, meta]) => ({
      code: parseInt(code, 10),
      name: meta.name,
      description: meta.description,
    }))
    .sort((a, b) => a.code - b.code);
}
```

### 3. Enhanced CommandRunner

Extend `runCommand` to enforce response envelope:

```typescript
// src/commands/shared/CommandRunner.ts (MODIFY)

import { VERSION } from '@/utils/version.js';
import type { BdgResponse } from '@/types/response.js';

/**
 * Build a standardized success response.
 */
export function buildSuccess<T>(data: T): BdgResponse<T> {
  return {
    version: VERSION,
    success: true,
    data,
  };
}

/**
 * Build a standardized error response.
 */
export function buildError(
  error: string,
  exitCode: number,
  suggestion?: string
): BdgResponse<never> {
  return {
    version: VERSION,
    success: false,
    error,
    exitCode,
    ...(suggestion && { suggestion }),
  };
}

/**
 * Enhanced runCommand that enforces BdgResponse envelope.
 * 
 * Changes from current implementation:
 * 1. Always wraps output in BdgResponse envelope
 * 2. Validates response structure before output
 * 3. Logs warnings for non-standard responses in dev mode
 */
export async function runCommand<TOptions extends BaseOptions, TResult = unknown>(
  handler: CommandHandler<TOptions, TResult>,
  options: TOptions,
  formatter?: CommandFormatter<TResult>
): Promise<void> {
  // ... implementation with envelope enforcement
}
```

### 4. Suggestion Standardization

Consolidate all suggestion-related fields:

```typescript
// src/ui/errors/CommandError.ts (MODIFY)

export interface ErrorMetadata {
  /** Primary actionable suggestion (ALWAYS use this, not 'suggestions') */
  suggestion?: string;
  
  /** Technical note for debugging */
  note?: string;
  
  /** Alternative command when current fails */
  fallback?: string;
  
  /** CDP equivalent for advanced users */
  cdpAlternative?: string;
  
  // REMOVED: suggestions (plural) - use suggestion (singular)
  // REMOVED: context - use specific fields above
}
```

### 5. Typo Detection Utilities

Create reusable typo detection for any string matching:

```typescript
// src/utils/suggestions.ts (NEW FILE)

import { levenshteinDistance } from '@/utils/levenshtein.js';

/**
 * Find similar strings from a list of candidates.
 * 
 * @param input - User-provided string (potentially with typo)
 * @param candidates - Valid options to match against
 * @param options - Configuration for matching
 * @returns Array of suggestions sorted by similarity
 */
export function findSimilar(
  input: string,
  candidates: string[],
  options: {
    /** Maximum edit distance to consider (default: 3) */
    maxDistance?: number;
    /** Maximum suggestions to return (default: 3) */
    maxSuggestions?: number;
    /** Case-insensitive matching (default: true) */
    ignoreCase?: boolean;
  } = {}
): string[] {
  const { maxDistance = 3, maxSuggestions = 3, ignoreCase = true } = options;
  
  const normalizedInput = ignoreCase ? input.toLowerCase() : input;
  
  return candidates
    .map(candidate => ({
      candidate,
      distance: levenshteinDistance(
        normalizedInput,
        ignoreCase ? candidate.toLowerCase() : candidate
      ),
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxSuggestions)
    .map(({ candidate }) => candidate);
}

/**
 * Format suggestions as "Did you mean: ..." message.
 */
export function formatSuggestions(suggestions: string[], prefix = 'Did you mean'): string | undefined {
  if (suggestions.length === 0) return undefined;
  
  if (suggestions.length === 1) {
    return `${prefix}: ${suggestions[0]}`;
  }
  
  return `${prefix}:\n${suggestions.map(s => `  - ${s}`).join('\n')}`;
}
```

---

## Implementation Phases

### Phase 1: Critical Schema Consistency (HIGH priority)

**Goal:** All commands return consistent JSON structure

**Tasks:**

#### 1.1 Create Response Types
- [ ] Create `src/types/response.ts` with `BdgResponse` interface
- [ ] Add `isBdgResponse` type guard for validation
- [ ] Export from `src/types/index.ts`

#### 1.2 Update OutputBuilder
- [ ] Modify `OutputBuilder.buildJsonSuccess()` to return `BdgResponse`
- [ ] Modify `OutputBuilder.buildJsonError()` to return `BdgResponse`
- [ ] Remove legacy output methods that bypass envelope

#### 1.3 Migrate Commands to runCommand Pattern
- [ ] `peek.ts` - Replace custom error handling with `runCommand`
- [ ] `console.ts` - Replace inline error handling with `runCommand`
- [ ] `network/list.ts` - Replace `handleCommandError` with `runCommand`
- [ ] `tail.ts` - Replace inline error handling with `runCommand`

#### 1.4 Update Existing Commands
- [ ] `status.ts` - Wrap output in `BdgResponse` envelope
- [ ] `cdp.ts` - Already good, verify envelope
- [ ] All `dom/*` commands - Verify envelope consistency

#### 1.5 Add Schema Validation Tests
- [ ] Create `src/__tests__/schema.response.test.ts`
- [ ] Test all commands return valid `BdgResponse` structure
- [ ] Test error responses include `exitCode` and `suggestion`

**Acceptance Criteria:**
- All `--json` output can be validated against `BdgResponse` schema
- No command returns bare arrays or objects without envelope

---

### Phase 2: Exit Codes and Error Handling (MEDIUM priority)

**Goal:** Consistent exit codes and error suggestions

**Tasks:**

#### 2.1 Centralize Exit Code Registry
- [ ] Create `EXIT_CODE_REGISTRY` in `exitCodes.ts`
- [ ] Add `getExitCodeDocs()` function
- [ ] Update `helpJson.ts` to use `getExitCodeDocs()` instead of hardcoded array
- [ ] Verify exit code 87 (STALE_CACHE) is included

#### 2.2 Audit Exit Code Usage
- [ ] Search for `EXIT_CODES.UNHANDLED_EXCEPTION` usages
- [ ] Replace with specific codes where applicable:
  - Daemon errors → `CDP_CONNECTION_FAILURE` or `SOFTWARE_ERROR`
  - Parse errors → `INVALID_ARGUMENTS`
  - File errors → `SESSION_FILE_ERROR`
- [ ] Use `SOFTWARE_ERROR` (110) for generic internal errors
- [ ] Reserve `UNHANDLED_EXCEPTION` (104) for actual unhandled exceptions

#### 2.3 Standardize Error Metadata
- [ ] Rename all `suggestions` (plural) to `suggestion` (singular)
- [ ] Update `CommandError` interface to remove `suggestions`
- [ ] Add ESLint rule to prevent `suggestions` usage (custom rule)

#### 2.4 Add Missing Suggestions
- [ ] Audit all `new CommandError(message, {})` calls
- [ ] Add meaningful suggestions to empty metadata:
  - `formFillHelpers.ts:116` - Add: "Verify element is an input field"
  - `formFillHelpers.ts:185` - Add: "Verify element exists and is clickable"
  - Other occurrences

#### 2.5 Fix stdout/stderr Consistency
- [ ] Ensure JSON errors always go to stdout (for parsing)
- [ ] Ensure human errors always go to stderr
- [ ] Document hint behavior (always stderr)

**Acceptance Criteria:**
- No usage of `UNHANDLED_EXCEPTION` except for actual unhandled exceptions
- All errors have non-empty suggestion field
- EXIT_CODE_DOCS generated from single source of truth

---

### Phase 3: Enhanced Discovery and Polish (LOW priority)

**Goal:** Complete typo detection and task mappings

**Tasks:**

#### 3.1 Create Suggestion Utilities
- [ ] Create `src/utils/suggestions.ts` with `findSimilar()` and `formatSuggestions()`
- [ ] Add unit tests for suggestion utilities

#### 3.2 Add Typo Detection to Commands
- [ ] `network list --preset` - Suggest valid presets on typo
- [ ] `console --level` - Suggest valid levels on typo
- [ ] `dom screenshot --format` - Suggest valid formats on typo

#### 3.3 Update Task Mappings
- [ ] Add `tail` command mapping
- [ ] Add `cleanup` command mapping
- [ ] Add `dom pressKey` command mapping
- [ ] Add `dom screenshot --follow` mapping
- [ ] Fix `network headers` → `details network` discrepancy

#### 3.4 Documentation Updates
- [ ] Update CLAUDE.md with new patterns
- [ ] Update principles docs with implementation notes
- [ ] Add "Contributing: Command Patterns" section

**Acceptance Criteria:**
- All option values with limited choices have typo detection
- All commands discoverable via task mappings or `--help --json`

---

## Prevention Mechanisms

### 1. ESLint Rules (Custom) - EVALUATED AND DECLINED

**Status:** Not implementing. Evaluated 2025-11-27.

**Proposed rules:**

| Rule | Purpose | Decision | Reason |
|------|---------|----------|--------|
| `enforce-bdg-response` | All JSON returns BdgResponse | ❌ Skip | TypeScript already enforces via types |
| `no-plural-suggestions` | Disallow `suggestions` property | ❌ Skip | Not a real problem - `suggestions` used correctly as local variables for building typo hints |
| `require-error-suggestion` | CommandError must have suggestion | ❌ Skip | Too strict - many errors legitimately have no actionable suggestion (e.g., "CDP connection lost") |

**Conclusion:** Custom ESLint rules add maintenance burden without meaningful benefit. TypeScript's type system and code review provide sufficient enforcement.

### 2. Type-Level Enforcement

Use TypeScript to prevent invalid patterns:

```typescript
// Prevent empty metadata
type NonEmptyErrorMetadata = ErrorMetadata & { suggestion: string };

// Require suggestion for user errors (80-99)
function createUserError(
  message: string,
  suggestion: string,  // Required, not optional
  exitCode: 80 | 81 | 82 | 83 | 84 | 85 | 86 | 87
): CommandError;
```

### 3. Schema Validation in CI

Add JSON schema validation to CI pipeline:

```yaml
# .github/workflows/ci.yml
- name: Validate Response Schema
  run: |
    npm run build
    npm run test:schema
```

```typescript
// src/__tests__/schema.contract.test.ts
describe('Response Schema Contract', () => {
  const commands = ['status', 'peek', 'console', 'network list', 'cdp --list'];
  
  for (const cmd of commands) {
    it(`${cmd} --json returns valid BdgResponse`, async () => {
      const result = await runBdgCommand(`${cmd} --json`);
      expect(isBdgResponse(JSON.parse(result.stdout))).toBe(true);
    });
  }
});
```

### 4. Pre-commit Hooks

Add husky pre-commit hook:

```bash
#!/bin/sh
# .husky/pre-commit

# Check for 'suggestions' (plural) in staged files
if git diff --cached --name-only | xargs grep -l 'suggestions:' 2>/dev/null; then
  echo "Error: Use 'suggestion' (singular) not 'suggestions'"
  exit 1
fi

# Run schema tests
npm run test:schema
```

### 5. Code Review Checklist

Add to PR template:

```markdown
## Agent-Friendly Checklist

- [ ] Returns `BdgResponse` envelope for JSON output
- [ ] Uses `runCommand` pattern (not custom error handling)
- [ ] Exit code is specific (not UNHANDLED_EXCEPTION)
- [ ] Error includes `suggestion` field
- [ ] Added to task mappings if new command
- [ ] Typo detection for limited-choice options
```

---

## Testing Strategy

### Unit Tests

```typescript
// src/__tests__/unit/response.test.ts
describe('BdgResponse', () => {
  it('success response has required fields', () => {
    const response = buildSuccess({ data: 'test' });
    expect(response.version).toBeDefined();
    expect(response.success).toBe(true);
    expect(response.data).toBeDefined();
  });

  it('error response has suggestion', () => {
    const response = buildError('test error', EXIT_CODES.INVALID_URL, 'try this');
    expect(response.suggestion).toBe('try this');
  });
});
```

### Integration Tests

```typescript
// src/__tests__/integration/json-output.test.ts
describe('JSON Output Consistency', () => {
  const commands = [
    { cmd: 'status --json', requiresSession: false },
    { cmd: 'peek --json', requiresSession: true },
    { cmd: 'console --json', requiresSession: true },
    { cmd: 'network list --json', requiresSession: true },
    { cmd: 'cdp --list', requiresSession: true },
    { cmd: 'dom query "body" --json', requiresSession: true },
  ];

  for (const { cmd, requiresSession } of commands) {
    it(`${cmd} returns valid BdgResponse`, async () => {
      if (requiresSession) await startTestSession();
      
      const result = await exec(`bdg ${cmd}`);
      const parsed = JSON.parse(result.stdout);
      
      expect(parsed).toHaveProperty('version');
      expect(parsed).toHaveProperty('success');
      
      if (parsed.success) {
        expect(parsed).toHaveProperty('data');
      } else {
        expect(parsed).toHaveProperty('error');
        expect(parsed).toHaveProperty('exitCode');
      }
      
      if (requiresSession) await stopTestSession();
    });
  }
});
```

### Contract Tests

```typescript
// src/__tests__/contract/exit-codes.test.ts
describe('Exit Code Contract', () => {
  it('EXIT_CODES matches EXIT_CODE_REGISTRY', () => {
    const codeValues = Object.values(EXIT_CODES);
    const registryKeys = Object.keys(EXIT_CODE_REGISTRY).map(Number);
    
    expect(codeValues.sort()).toEqual(registryKeys.sort());
  });

  it('getExitCodeDocs returns all codes', () => {
    const docs = getExitCodeDocs();
    expect(docs.length).toBe(Object.keys(EXIT_CODES).length);
  });

  it('user errors are in 80-99 range', () => {
    const docs = getExitCodeDocs();
    const userErrors = docs.filter(d => 
      EXIT_CODE_REGISTRY[d.code]?.category === 'user'
    );
    
    for (const error of userErrors) {
      expect(error.code).toBeGreaterThanOrEqual(80);
      expect(error.code).toBeLessThan(100);
    }
  });
});
```

---

## Migration Guide

### For Existing Commands

**Before (inconsistent):**
```typescript
// network/list.ts
if (options.json) {
  console.log(JSON.stringify({ success: true, data: [], count: 0 }));
} else {
  console.log(noNetworkDataMessage());
}
process.exit(EXIT_CODES.SUCCESS);
```

**After (consistent):**
```typescript
// network/list.ts
await runCommand(
  async () => {
    const requests = await fetchNetworkRequests();
    return { 
      success: true, 
      data: { requests, count: requests.length } 
    };
  },
  options,
  formatNetworkList
);
```

### For New Commands

Always use this pattern:

```typescript
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

export function registerMyCommand(program: Command): void {
  program
    .command('mycommand')
    .option('-j, --json', 'Output as JSON')
    .action(async (options) => {
      await runCommand(
        async () => {
          // Command logic here
          const data = await doSomething();
          
          if (!data) {
            return {
              success: false,
              error: 'No data found',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
              errorContext: {
                suggestion: 'Try: bdg start <url> first',
              },
            };
          }
          
          return { success: true, data };
        },
        options,
        formatMyCommand  // Human-readable formatter
      );
    });
}
```

### Checklist for Command Authors

1. **Use `runCommand` wrapper** - Never handle JSON output manually
2. **Return CommandResult** - Always `{ success, data }` or `{ success: false, error, exitCode }`
3. **Include suggestions** - Every error path must have `errorContext.suggestion`
4. **Use specific exit codes** - Never use `GENERIC_FAILURE` or `UNHANDLED_EXCEPTION` for known errors
5. **Add to task mappings** - Update `taskMappings.ts` for discoverability
6. **Add typo detection** - For options with limited choices, use `findSimilar()`

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1 | 2-3 days | None |
| Phase 2 | 1-2 days | Phase 1 |
| Phase 3 | 1 day | Phase 2 |
| Prevention Mechanisms | 1 day | Phase 1 |
| Testing | Ongoing | Each phase |

**Total:** ~5-7 days of focused work

---

## Success Metrics

After implementation:

1. **Schema Consistency:** 100% of `--json` outputs validate against `BdgResponse`
2. **Error Coverage:** 100% of errors have non-empty `suggestion`
3. **Exit Code Accuracy:** 0 uses of `UNHANDLED_EXCEPTION` for known error conditions
4. **Discovery Coverage:** 100% of commands in task mappings
5. **Typo Detection:** All limited-choice options have suggestions

---

## Related Documents

- [AGENT_FRIENDLY_TOOLS.md](../principles/AGENT_FRIENDLY_TOOLS.md) - Core principles
- [SELF_DOCUMENTING_SYSTEMS.md](../principles/SELF_DOCUMENTING_SYSTEMS.md) - Discovery patterns
- [CLI_REFERENCE.md](../CLI_REFERENCE.md) - Command documentation
