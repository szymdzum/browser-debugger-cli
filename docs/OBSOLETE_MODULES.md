# Obsolete Modules Analysis

## Overview
After migrating to daemon/worker architecture, several modules from the old in-process CLI flow are no longer used.

## Architecture Comparison

### OLD (In-Process CLI)
```
bdg <url>
  ↓
src/cli/commands/start.ts
  ↓
src/cli/handlers/sessionController.ts::startSession()
  ↓
src/cli/handlers/SessionLock.ts
  ↓
src/cli/handlers/ChromeBootstrap.ts
  ↓
src/cli/handlers/TargetSetup.ts
  ↓
src/connection/tabs.ts::createOrFindTarget()
  ↓
src/session/BdgSession.ts
  ↓
src/cli/handlers/SessionLoop.ts
```

### NEW (Daemon/Worker)
```
bdg <url>
  ↓
src/cli/commands/start.ts
  ↓
src/cli/handlers/daemonSessionController.ts::startSessionViaDaemon()
  ↓
src/daemon/launcher.ts (starts daemon)
  ↓
src/daemon/ipcServer.ts (daemon IPC)
  ↓
src/daemon/startSession.ts::launchSessionInWorker()
  ↓
src/daemon/worker.ts
  ↓
src/connection/launcher.ts::launchChrome()
  ↓
src/utils/http.ts::fetchCDPTargets()
  ↓
(simple hostname matching, no tabs.ts)
```

## Obsolete Modules

### 1. **src/connection/tabs.ts** ❌ OBSOLETE
- **Status**: Not imported by any daemon/worker code
- **Old Usage**: Complex tab reuse/navigation logic
- **New Approach**: Worker launches Chrome with URL directly
- **Functions**:
  - `createOrFindTarget()` - tab reuse with scoring (100/90/70/50/30)
  - `findBestTarget()` - scored tab matching
  - `createNewTab()` - CDP Target.createTarget + HTTP fallback
  - `navigateToUrl()` - CDP Page.navigate
  - `waitForTargetReady()` - polling for navigation completion
  - `waitForNetworkIdle()` - React hydration detection
- **Dependencies**:
  - Only used by `TargetSetup.ts` (also obsolete)
- **Can Delete**: Yes (after confirming no direct imports)

### 2. **src/cli/handlers/TargetSetup.ts** ❌ OBSOLETE
- **Status**: Not used in daemon flow
- **Old Usage**: Bridge between sessionController and tabs.ts
- **Functions**:
  - `TargetSetup.setup()` - creates temp CDP connection, finds/creates target
- **Dependencies**:
  - Only called by `sessionController.ts::startSession()` (obsolete)
- **Can Delete**: Yes

### 3. **src/cli/handlers/sessionController.ts::startSession()** ❌ OBSOLETE FUNCTION
- **Status**: Export exists but NEVER CALLED
- **Line**: 215-380
- **Old Usage**: Main session orchestration
- **New Replacement**: `daemonSessionController.ts::startSessionViaDaemon()`
- **Dependencies**:
  - No imports of `startSession` found in codebase
- **Can Delete**: Yes, the function
- **Keep**: `cleanupStaleChrome()` export (used by cleanup command)

### 4. **src/cli/handlers/SessionLock.ts** ⚠️ PARTIALLY OBSOLETE
- **Status**: Used by old sessionController.startSession() only
- **Old Usage**: Global session lock via file
- **New Approach**: Daemon handles session locking
- **Can Delete**: Likely yes (verify no other usages)

### 5. **src/cli/handlers/ChromeBootstrap.ts** ⚠️ PARTIALLY OBSOLETE
- **Status**: Used by old sessionController.startSession() only
- **Old Usage**: Chrome launch wrapper
- **New Approach**: Worker calls `launchChrome()` directly
- **Can Delete**: Likely yes (verify no other usages)

### 6. **src/cli/handlers/SessionLoop.ts** ⚠️ PARTIALLY OBSOLETE
- **Status**: Used by old sessionController.startSession() only
- **Old Usage**: Keeps CLI process alive, monitors CDP
- **New Approach**: Worker handles session loop
- **Can Delete**: Likely yes (verify no other usages)

### 7. **src/session/BdgSession.ts** ⚠️ STILL USED?
- **Status**: Need to verify if worker uses this
- **Old Usage**: CDP connection + collector management
- **New Approach**: Worker might use it OR has its own logic
- **Can Delete**: VERIFY FIRST

## Still Active (Keep These)

### src/cli/handlers/sessionController.ts
- **Keep**: `cleanupStaleChrome()` function (line 66)
- **Delete**: `startSession()` function (line 215-380)
- **Used By**: `cleanup.ts` command

### src/connection/launcher.ts
- **Keep**: Used by worker to launch Chrome

### src/collectors/*.ts
- **Keep**: Used by worker for data collection

### src/daemon/*.ts
- **Keep**: Active daemon/worker architecture

## Verification Commands

```bash
# Check if tabs.ts is imported anywhere
grep -r "from.*tabs" src/daemon/

# Check if TargetSetup is imported
grep -r "TargetSetup" src/daemon/

# Check if startSession function is called
grep -r "sessionController.*startSession" src/

# Check SessionLock usage
grep -r "SessionLock" src/

# Check ChromeBootstrap usage
grep -r "ChromeBootstrap" src/

# Check SessionLoop usage
grep -r "SessionLoop" src/

# Check BdgSession usage in worker
grep -r "BdgSession" src/daemon/
```

## Deletion Plan

### Phase 1: Safe Deletions (Confirmed Obsolete)
1. Delete `src/connection/tabs.ts` (+ tests)
2. Delete `src/cli/handlers/TargetSetup.ts`
3. Remove `startSession()` function from `sessionController.ts` (keep `cleanupStaleChrome`)

### Phase 2: Verify Then Delete
4. Verify no BdgSession usage in worker, then decide
5. Verify SessionLock, ChromeBootstrap, SessionLoop not used elsewhere
6. Delete if confirmed obsolete

### Phase 3: Cleanup
7. Remove unused imports from remaining files
8. Update documentation

## Estimated Impact

- **Files to delete**: 2-6 files
- **Lines of code removed**: ~2000-3000 LOC
- **Tests to delete**: Corresponding test files
- **Documentation updates**: Update ARCHITECTURE.md to remove old flow

## Benefits

1. **Reduced codebase size**: ~30% reduction in CLI handler code
2. **Clearer architecture**: Single code path (daemon/worker)
3. **Easier maintenance**: No dead code confusion
4. **Better onboarding**: New devs don't need to understand obsolete flow

## Risks

- **Accidental deletion of shared utilities**: Some modules might have mixed usage
- **Hidden dependencies**: Need thorough grep/search verification
- **Test breakage**: Some tests might still reference old flow

## Recommendation

**Proceed with Phase 1 deletions** after running all verification commands and confirming:
1. All tests pass without the modules
2. No grep hits for the modules in active code paths
3. Worker architecture is fully functional without them

## Verification Results

### Confirmed Obsolete (Phase 1 - Safe to Delete)
1. ✅ **src/connection/tabs.ts** - Zero daemon/worker imports
2. ✅ **src/cli/handlers/TargetSetup.ts** - Only used by obsolete startSession()
3. ✅ **src/cli/handlers/SessionLock.ts** - Only used by obsolete startSession()
4. ✅ **src/cli/handlers/ChromeBootstrap.ts** - Only used by obsolete startSession()
5. ✅ **src/cli/handlers/SessionLoop.ts** - Only used by obsolete startSession()
6. ✅ **sessionController.ts::startSession()** function - Never called

### Still Active (DO NOT DELETE)
- ✅ **src/session/BdgSession.ts** - NOT used by worker (worker has own logic)
- ✅ **src/session/lock.ts** (acquireSessionLock/releaseDaemonLock) - Used by daemon
- ✅ **sessionController.ts::cleanupStaleChrome()** - Used by cleanup command

## Confirmed Dead Code

```
Files to delete: 5 files + 1 function
Lines removed: ~2500 LOC
Tests affected: 1 test file (tabs.contract.test.ts)
```

### Deletion Checklist

```bash
# Phase 1: Delete obsolete files
rm src/connection/tabs.ts
rm src/connection/__tests__/tabs.contract.test.ts
rm src/cli/handlers/TargetSetup.ts
rm src/cli/handlers/SessionLock.ts
rm src/cli/handlers/ChromeBootstrap.ts
rm src/cli/handlers/SessionLoop.ts

# Phase 2: Remove startSession() function from sessionController.ts
# Keep cleanupStaleChrome() export
# Lines 215-380 to delete

# Phase 3: Remove related imports
# - SessionLock, ChromeBootstrap, SessionLoop, TargetSetup from sessionController.ts
# - Any other files that imported these

# Phase 4: Update docs
# - Remove references in ARCHITECTURE.md
# - Update README if needed
```

