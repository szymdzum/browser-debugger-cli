# Phase 3 Implementation Plan

**Status:** 🔄 Planning  
**Created:** November 7, 2025  
**Target:** TBD (pending user decision)

---

## Overview

Phase 3 addresses the final 2 architectural issues that affect the user-facing CLI API. Unlike Phase 1 & 2 (internal refactoring), these changes involve **breaking changes** to command behavior.

**Progress:** 11/13 items complete (85%)

---

## Remaining Issues

### TD-001: Remove --kill-chrome Flag from Stop Command
**Priority:** High  
**Category:** Unix Philosophy  
**Effort:** 3 hours  
**Risk:** Low-Medium (breaking change)

#### Current Behavior
```bash
bdg stop                    # Stop session only
bdg stop --kill-chrome      # Stop session AND kill Chrome
```

#### Proposed Behavior
```bash
bdg stop                    # Stop session only
bdg cleanup --aggressive    # Kill Chrome processes

# Composition pattern (Unix philosophy)
bdg stop && bdg cleanup --aggressive
```

#### Impact Analysis

**Pros:**
- ✅ Better Unix philosophy compliance ("do one thing well")
- ✅ Simpler command logic (reduced complexity)
- ✅ Easier to test edge cases
- ✅ Better composability with other tools
- ✅ `cleanup --aggressive` already exists and works

**Cons:**
- ❌ Breaking change for users relying on `--kill-chrome`
- ❌ Requires two commands instead of one
- ❌ Need migration guide in changelog

#### Implementation Steps

1. **Deprecation Phase** (Recommended)
   - Add deprecation warning to `--kill-chrome` flag
   - Update help text to suggest `cleanup --aggressive`
   - Log warning when flag is used
   - Keep functionality working

2. **Documentation Updates**
   - Update CLI_REFERENCE.md
   - Update README.md examples
   - Add migration guide to CHANGELOG.md
   - Update integration tests

3. **Removal Phase** (Next major version)
   - Remove `--kill-chrome` flag entirely
   - Simplify stop.ts logic
   - Update all tests

#### Files to Modify
- `src/commands/stop.ts` - Remove flag and Chrome killing logic
- `docs/CLI_REFERENCE.md` - Update documentation
- `CHANGELOG.md` - Document breaking change
- `tests/integration/stop.test.sh` - Update tests
- `tests/error-scenarios/*.sh` - Update scenarios

#### Testing Checklist
- [ ] Verify `bdg stop` works without flag
- [ ] Verify `bdg cleanup --aggressive` kills Chrome
- [ ] Test composition: `bdg stop && bdg cleanup --aggressive`
- [ ] Verify error messages are clear
- [ ] Run all integration tests

---

### TD-005: Separate Peek and Watch/Tail Commands
**Priority:** Medium  
**Category:** Unix Philosophy  
**Effort:** 3 hours  
**Risk:** Medium (new command + deprecation)

#### Current Behavior
```bash
bdg peek                # One-time snapshot
bdg peek --follow       # Continuous monitoring (infinite loop)
```

#### Proposed Behavior

**Option A: Create `bdg watch` command**
```bash
bdg peek                # One-time snapshot (no changes)
bdg watch               # Continuous monitoring
bdg watch --interval 2  # Custom polling interval
```

**Option B: Create `bdg tail` command (more Unix-like)**
```bash
bdg peek                # One-time snapshot (no changes)
bdg tail                # Continuous monitoring (like tail -f)
bdg tail -n 50          # Show last 50 items
```

**Recommendation:** Option B (`tail`) for better Unix semantics

#### Impact Analysis

**Pros:**
- ✅ Clearer command semantics
- ✅ Better Unix philosophy ("peek" is a snapshot, "tail" is streaming)
- ✅ Easier to understand for new users
- ✅ Simpler error handling per command
- ✅ Can share `showPreview()` logic

**Cons:**
- ❌ New command to maintain
- ❌ Breaking change for users using `--follow`
- ❌ Need to handle SIGINT in new command

#### Implementation Steps

1. **Create `bdg tail` Command**
   - Copy peek.ts → tail.ts
   - Keep only `--follow` logic
   - Add `--interval <ms>` option
   - Proper SIGINT handling
   - Reuse `showPreview()` helper

2. **Deprecation Phase**
   - Add deprecation warning to `peek --follow`
   - Suggest using `bdg tail` instead
   - Keep functionality working

3. **Refactor Shared Logic**
   - Extract `showPreview()` to `src/commands/shared/previewHelpers.ts`
   - Share between peek and tail
   - Single source of truth for formatting

4. **Documentation Updates**
   - Add `bdg tail` to CLI_REFERENCE.md
   - Update examples in README.md
   - Migration guide in CHANGELOG.md

5. **Removal Phase** (Next major version)
   - Remove `--follow` flag from peek
   - Simplify peek.ts

#### Files to Create/Modify
- `src/commands/tail.ts` - New command
- `src/commands/shared/previewHelpers.ts` - Shared logic
- `src/commands/peek.ts` - Remove --follow logic (later)
- `src/index.ts` - Register tail command
- `docs/CLI_REFERENCE.md` - Document new command
- `tests/integration/tail.test.sh` - New test file

#### Testing Checklist
- [ ] Verify `bdg peek` still works (one-time)
- [ ] Verify `bdg tail` streams continuously
- [ ] Test SIGINT handling (Ctrl+C)
- [ ] Test custom interval: `bdg tail --interval 2000`
- [ ] Test filtering: `bdg tail --network`
- [ ] Run all integration tests

---

## Decision Matrix

### Should We Implement Phase 3?

| Factor | TD-001 (--kill-chrome) | TD-005 (--follow) |
|--------|------------------------|-------------------|
| **User Impact** | Low (cleanup exists) | Medium (new workflow) |
| **Breaking Change** | Yes | Yes |
| **Unix Philosophy** | High improvement | High improvement |
| **Code Complexity** | Reduces | Slight increase |
| **Maintenance** | Easier | Slightly harder |
| **User Value** | Moderate | High (clearer semantics) |

### Recommendation

**Option 1: Implement Both (Full Phase 3)**
- Timeline: 1 week
- Effort: 6 hours development + 2 hours testing
- Deprecation period: 1-2 releases before removal
- Best for: Long-term codebase health

**Option 2: Implement TD-005 Only (Partial Phase 3)**
- Timeline: 3-4 days
- Effort: 3 hours development + 1 hour testing
- Reason: Higher user value, better semantics
- Defer: TD-001 until user feedback shows it's needed

**Option 3: Defer Phase 3 Entirely**
- Keep current behavior
- Mark TD-001 and TD-005 as "Won't Fix / Future Enhancement"
- Focus on new features
- Revisit before v1.0 release

---

## Migration Strategy (If Implemented)

### Version Roadmap

**v0.4.0 - Deprecation Phase**
- Add deprecation warnings
- Keep all functionality working
- Update documentation
- Communicate changes

**v0.5.0 - Transition Phase**
- New `bdg tail` command available
- `--follow` still works with warning
- `--kill-chrome` still works with warning

**v1.0.0 - Removal Phase**
- Remove deprecated flags
- Clean, Unix-philosophy-compliant CLI
- Final migration guide

### User Communication

**Changelog Entry:**
```markdown
## [0.4.0] - YYYY-MM-DD

### Deprecated
- `bdg stop --kill-chrome` - Use `bdg cleanup --aggressive` instead
- `bdg peek --follow` - Use new `bdg tail` command instead

### Added
- New `bdg tail` command for continuous monitoring
- Deprecation warnings for flags that will be removed in v1.0

### Migration Guide
- Replace `bdg stop --kill-chrome` with:
  - `bdg stop && bdg cleanup --aggressive`
- Replace `bdg peek --follow` with:
  - `bdg tail`
```

---

## Implementation Priorities

### Quick Win (If Doing Partial)
1. **TD-005 (bdg tail)** - 3 hours
   - Higher user value
   - Clearer semantics
   - No loss of functionality
   
### Low Hanging Fruit
2. **TD-001 (--kill-chrome)** - 3 hours
   - Simpler than TD-005
   - Alternative already exists
   - Reduces complexity

---

## Open Questions

1. **User Feedback Needed:**
   - How many users rely on `--kill-chrome`?
   - How many users rely on `--follow`?
   - Are deprecation warnings acceptable?

2. **Timing:**
   - Should we wait until v1.0 for breaking changes?
   - Or implement deprecation period now?

3. **Alternatives:**
   - Could we keep both old and new behaviors?
   - Is code complexity worth maintaining compatibility?

---

## Next Steps

**Before Implementation:**
1. Review usage analytics (if available)
2. Check GitHub issues for feature requests
3. Decide on version roadmap
4. Get user feedback on proposed changes

**If Approved:**
1. Create feature branch: `feat/phase3-unix-philosophy`
2. Implement TD-005 (bdg tail) first
3. Add deprecation warnings
4. Update all documentation
5. Run comprehensive tests
6. Submit PR with migration guide

**If Deferred:**
1. Update TECHNICAL_DEBT.md to mark as "Deferred"
2. Add "Future Enhancement" label
3. Revisit before v1.0 planning
4. Focus on new features

---

## Success Criteria

If implemented, Phase 3 is successful when:

- ✅ All 184 tests still pass
- ✅ `bdg tail` command works correctly
- ✅ Deprecation warnings are clear and helpful
- ✅ Documentation updated with examples
- ✅ Migration guide available
- ✅ No regression in functionality
- ✅ Code complexity reduced (TD-001) or maintained (TD-005)
- ✅ User feedback is positive

---

## Related Documents

- **TECHNICAL_DEBT.md** - Issue tracking
- **CLI_REFERENCE.md** - Command documentation
- **REFACTORING_GUIDE.md** - Code patterns
- **CHANGELOG.md** - Version history

---

## Author Notes

**Why This Decision Matters:**

Phase 3 is different from Phase 1 & 2 because it affects the **user-facing API**, not just internal code quality. The questions to answer are:

1. Is Unix philosophy compliance worth breaking changes?
2. Should we wait until v1.0 for this cleanup?
3. Do users value simplicity over convenience?

**Personal Recommendation:**

Implement **TD-005 (bdg tail)** in next release because:
- Adds value (new capability)
- Clearer semantics (peek vs tail)
- Can keep `--follow` working during deprecation

Defer **TD-001 (--kill-chrome)** until user feedback shows it's actually causing issues or confusion.
