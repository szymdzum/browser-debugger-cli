# Chrome Launcher Adoption Plan

**Last updated:** 2025-11-01  
**Owner:** CLI Platform team  
**Status:** Draft

## Objectives
- Reduce bespoke Chrome lifecycle code by delegating to `chrome-launcher`.
- Expose advanced launcher options (retries, logging, prefs, env vars) to unblock automation scenarios.
- Improve diagnostics and cleanup for stale Chrome processes.
- Preserve existing CLI ergonomics (`bdg start`, `bdg stop`, timeouts) while opening room for future features.

## Current Gaps
- Manual readiness polling in `waitForCDP()` duplicates upstream logic and bypasses retry/backoff controls.
- Profile management is hard-coded (`~/.bdg/chrome-profile`) with no way to request temp profiles or inspect actual paths.
- Consumers cannot enable verbose logging, inject Chrome prefs, or use remote debugging pipes without patching the launcher.
- Cleanup lacks integration with `chromeLauncher.killAll()` and installation discovery helpers, limiting recovery tooling.

## Rollout Strategy

### Phase 1 – API Surface & Pass-Through (1 sprint)
**Goals**
- Expand `LaunchOptions` to include pass-through fields for `chrome-launcher`.
- Wire CLI flags/env-vars to those options without changing existing defaults.
- Add unit tests and docs for the new knobs.

**Sample Implementation**
```ts
// src/connection/launcher.ts
import * as chromeLauncher from 'chrome-launcher';
import type { Options as ChromeLaunchOptions } from 'chrome-launcher';

export interface LaunchOptions extends Pick<
  ChromeLaunchOptions,
  | 'logLevel'
  | 'connectionPollInterval'
  | 'maxConnectionRetries'
  | 'portStrictMode'
  | 'prefs'
  | 'envVars'
  | 'handleSIGINT'
> {
  port?: number;
  userDataDir?: string;
  headless?: boolean;
  url?: string;
  ignoreDefaultFlags?: boolean;
  chromeFlags?: string[];
}

const buildChromeOptions = (options: LaunchOptions): ChromeLaunchOptions => ({
  port: options.port,
  startingUrl: options.url,
  userDataDir: options.userDataDir,
  logLevel: options.logLevel ?? 'silent',
  connectionPollInterval: options.connectionPollInterval,
  maxConnectionRetries: options.maxConnectionRetries,
  portStrictMode: options.portStrictMode,
  prefs: options.prefs,
  envVars: options.envVars,
  handleSIGINT: options.handleSIGINT ?? false,
  chromeFlags: buildChromeFlags(options),
});

const buildChromeFlags = (options: LaunchOptions): string[] => {
  const baseFlags = options.ignoreDefaultFlags
    ? []
    : chromeLauncher.Launcher.defaultFlags();

  return [
    ...baseFlags,
    `--remote-debugging-port=${options.port ?? 9222}`,
    ...(options.headless ? ['--headless=new'] : []),
    ...(options.chromeFlags ?? []),
  ];
};
```

### Phase 2 – Launcher Class Adoption (1–2 sprints)
**Goals**
- Replace manual polling with `Launcher.launch()` + `waitUntilReady()`.
- Surface resolved `userDataDir` and `process` handles.
- Ensure kill flows delegate to `launcher.kill()` and clean temp dirs.
- Add integration tests covering headless/persistent profile modes.

**Sample Implementation**
```ts
// src/connection/launcher.ts
export async function launchChrome(options: LaunchOptions = {}): Promise<LaunchedChrome> {
  const launcher = new chromeLauncher.Launcher(buildChromeOptions(options));

  try {
    await launcher.launch();
    await launcher.waitUntilReady();
  } catch (error) {
    launcher.kill();
    launcher.destroyTmp();
    throw new ChromeLaunchError(`Failed to launch Chrome: ${getErrorMessage(error)}`, error);
  }

  return {
    pid: launcher.pid!,
    port: launcher.port!,
    userDataDir: launcher.userDataDir,
    process: launcher.chromeProcess ?? null,
    kill: async (): Promise<void> => {
      launcher.kill();
      launcher.destroyTmp();
    },
  };
}
```
> Uses a shared `getErrorMessage()` helper from `@/utils/errors.js`; replace with the project’s chosen error normalizer.

### Phase 3 – Diagnostics & Cleanup Enhancements (1 sprint)
**Goals**
- Improve error messaging with installation discovery data.
- Provide aggressive cleanup tooling for stale Chrome instances.
- Record telemetry about chosen binaries and retry counts.

**Sample Implementation**
```ts
// src/cli/handlers/sessionController.ts
function reportLauncherFailure(error: Error): void {
  console.error('Chrome launch failed:', error.message);
  const candidates = chromeLauncher.Launcher.getInstallations();
  if (candidates.length === 0) {
    console.error('No Chrome installations detected. Install Chrome or set CHROME_PATH.');
  } else {
    console.error('Detected Chrome binaries:\n', candidates.join('\n'));
  }
  console.error('Default path:', chromeLauncher.getChromePath());
}

async function cleanupStaleChrome(): Promise<void> {
  const errors = chromeLauncher.killAll();
  if (errors.length > 0) {
    console.error('Some Chrome processes resisted cleanup:', errors.map((e) => e.message));
  }
}
```

## Refactor Inventory
- **Default flag management (`src/connection/launcher.ts`)**  
  Replace manual flag assembly with `Launcher.defaultFlags()` and `ignoreDefaultFlags` to inherit upstream automation defaults while layering bdg-specific overrides.

- **Profile handling (`src/connection/launcher.ts`)**  
  Pass `userDataDir` via launch options and surface the resolved directory from `launcher.userDataDir`, enabling temporary profiles and better tooling visibility.

- **Readiness and retries (`src/connection/launcher.ts`)**  
  Remove the bespoke `waitForCDP()` loop in favour of `Launcher.waitUntilReady()` and configurable `connectionPollInterval` / `maxConnectionRetries`.

- **Process handles (`src/connection/launcher.ts`)**  
  Return the underlying `chromeProcess` and optional `remoteDebuggingPipes` so future features (log streaming, pipe transport) can build on them.
  Update `LaunchedChrome` in `src/types.ts` accordingly.

- **Strict port reuse (`src/cli/handlers/sessionController.ts`)**  
  Use `portStrictMode` rather than ad-hoc `isChromeRunning()` checks to decide when to launch versus attach.

- **Diagnostics (`src/cli/handlers/sessionController.ts`)**  
  Surface `Launcher.getInstallations()` and `getChromePath()` in launch failures for clearer guidance on missing or unexpected Chrome installations.

- **Cleanup (`src/cli/handlers/sessionController.ts`)**  
  Integrate `killAll()` as part of stale-session cleanup (opt-in) to prevent orphaned bdg-launched Chrome instances from blocking new sessions.

- **Signal coordination (`src/connection/launcher.ts`, `sessionController`)**  
  Explicitly set `handleSIGINT` to align chrome-launcher’s signal behaviour with bdg’s shutdown handlers and avoid duplicate listeners.

## Validation Plan
- Unit coverage for pass-through options (Phase 1) and launcher lifecycle (Phase 2).
- CLI smoke tests on CI runners for macOS, Ubuntu, and Windows to validate headless/non-headless launches.
- Manual verification with custom Chrome channels (Beta, Canary) to ensure installation discovery works.
- Add regression test to ensure `bdg stop` leaves user-managed Chrome untouched (no killAll when we did not launch).

## Risks & Mitigations
- **Breaking existing defaults:** Validate via local smoke tests before merging; roll forward quickly if regressions appear since there are no other users yet.
- **Platform differences:** Use `chrome-launcher`’s verbose logs during rollout; gather telemetry on failures by platform.
- **User surprise from killAll:** Keep aggressive cleanup behind an explicit opt-in flag (`--aggressive-cleanup`) until safety is verified; document behaviour clearly.

## Open Questions
- Remote debugging pipes: out of scope for now; port-based debugging remains sufficient.
- Should CLI expose Chrome prefs directly or accept a JSON file path?
- How do we surface launcher diagnostics in `bdg status` without overwhelming standard output?

Please add comments or additional considerations in this document before implementation begins.
