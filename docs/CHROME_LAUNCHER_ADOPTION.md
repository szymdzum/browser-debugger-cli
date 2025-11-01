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
- Expand `LaunchOptions` to include a typed pass-through for `chrome-launcher` options (`logLevel`, `connectionPollInterval`, `maxConnectionRetries`, `portStrictMode`, `prefs`, `envVars`, `handleSIGINT`).
- Update CLI option parsing to populate the new fields where relevant (e.g., `--chrome-log-level`, hidden `--chrome-pref` for advanced users).
- Add unit tests that assert `launchChrome()` forwards the new options and keeps default behaviour unchanged.
- Document the new flags in CLI help and docs.

### Phase 2 – Launcher Class Adoption (1–2 sprints)
- Refactor `src/connection/launcher.ts` to instantiate `new chromeLauncher.Launcher(opts)` and call `launch()` + `waitUntilReady()` instead of manual polling.
- Remove `waitForCDP()` and reuse upstream retry knobs (configure defaults equivalent to today’s 10s timeout).
- Feed `userDataDir` via launcher options; surface the resolved `launcher.userDataDir` in the returned `LaunchedChrome` object.
- Ensure `LaunchedChrome.kill` awaits `launcher.kill()` and `launcher.destroyTmp()` as needed.
- Regression tests: integration smoke test launching Chrome, verifying CDP availability, and exercising headless + custom profile flows on macOS/Linux runners.

### Phase 3 – Diagnostics & Cleanup Enhancements (1 sprint)
- Expose `chromeLauncher.getChromePath()` and `Launcher.getInstallations()` in error messages when launch fails.
- Add optional `--chrome-diagnostics` CLI flag to emit discovered installations, chosen path, and default flags.
- Call `chromeLauncher.killAll()` during stale-session cleanup (`sessionController.cleanup()`) when bdg previously launched Chrome.
- Capture `chrome.process` and pipe handles in `LaunchedChrome` to allow future streaming of Chrome logs when verbose mode is enabled.
- Update telemetry to record launch retries, selected binary, and whether killAll was used.

## Validation Plan
- Unit coverage for pass-through options (Phase 1) and launcher lifecycle (Phase 2).
- CLI smoke tests on CI runners for macOS, Ubuntu, and Windows to validate headless/non-headless launches.
- Manual verification with custom Chrome channels (Beta, Canary) to ensure installation discovery works.
- Add regression test to ensure `bdg stop` leaves user-managed Chrome untouched (no killAll when we did not launch).

## Risks & Mitigations
- **Breaking existing defaults:** Ship behind feature flag (`BDG_USE_LAUNCHER_CLASS`) during Phase 2, enable in CI before general release.
- **Platform differences:** Use `chrome-launcher`’s verbose logs during rollout; gather telemetry on failures by platform.
- **User surprise from killAll:** Gate new cleanup path behind `--aggressive-cleanup` until we confirm safety; document behaviour clearly.

## Open Questions
- Do we need to support remote debugging pipes for users running on corporate networks that block ports?
- Should CLI expose Chrome prefs directly or accept a JSON file path?
- How do we surface launcher diagnostics in `bdg status` without overwhelming standard output?

Please add comments or additional considerations in this document before implementation begins.
