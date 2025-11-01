% Detached Session Feature Plan

## Overview

Implement an optional detached/background mode for `bdg` so users can start a collection session without blocking the originating shell. When invoked with `--detach` (or a future `bdg start` alias), the CLI forks a background worker process that owns the Chrome/CDP session while the parent process exits immediately after confirming successful startup.

## Goals

- Preserve current foreground behaviour unless `--detach` is specified.
- Allow interaction commands (`bdg status`, `bdg query`, `bdg stop`, future previews) to keep working with a detached session.
- Provide clear feedback on startup success/failure.

## High-Level Architecture

1. **Parent Process (CLI entrypoint)**
   - Parse `--detach`.
   - If not detaching, execute the existing `run()` workflow (no change).
   - If detaching, spawn a new Node process with a hidden flag (e.g., `--child-run`) to execute the run loop, then exit when the child signals readiness.

2. **Child Process (Session Worker)**
   - Executes the existing `run()` logic.
   - Registers signal handlers (`SIGINT`, `SIGTERM`) and writes session metadata including its PID.
   - Performs normal cleanup on exit.

3. **Handshake**
   - The parent waits for a short timeout (e.g., 3–5 seconds) for the child to acquire the session lock and write metadata.
   - If the child exits or fails to report readiness, parent surfaces the error to the user.

## Key Tasks

### CLI & Process Management
- Add a `--detach` flag to the root command (and optionally create a dedicated `start` alias).
- Introduce an internal `--child-run` flag that bypasses the spawn step to prevent recursive forking.
- Implement `launchDetachedSession()` utility using `child_process.spawn(process.execPath, ...)` with `{ detached: true, stdio: 'ignore' }` and `child.unref()` to free the parent shell.
- Ensure parent gracefully handles existing session lock errors and surfaces informative output.

### Session Metadata Enhancements
- Extend `SessionMetadata` (in `src/utils/session.ts`) with:
  - `detached: boolean`
  - Optional `readyAt` timestamp (for status/debugging)
- Verify metadata read/write paths handle the new fields.
- Update stale-session detection to auto-clean dead detached sessions (ties into “Auto-Cleanup” quick win).

### Interaction Commands
- Confirm `bdg stop`, `bdg query`, and planned `bdg status` use the stored PID/WebSocket info; no behaviour change expected.
- Consider improving error messaging for detached sessions (e.g., session not ready yet, child crashed).

### Documentation & Help
- Update `README.md` and CLI help text to describe `--detach`, usage examples, and expected workflow.
- Mention that the foreground command now returns immediately when detached, and users can interact via other commands.

## Testing Strategy

1. **Automated**
   - Unit test `launchDetachedSession()` logic with mocks to ensure correct command assembly and error handling.
   - Integration tests that:
     - Start a detached session (with headless Chrome fixture).
     - Assert metadata reflects detached mode and PID is alive.
     - Run `bdg status` / `bdg query` / `bdg stop` to confirm interaction.
     - Validate stale-session cleanup when the worker PID is killed manually.
2. **Manual**
   - macOS/Linux: run `bdg <url> --detach`, issue commands from the same shell immediately.
   - Windows (`cmd.exe` and PowerShell): confirm detached spawn works as expected.

## Rollout Steps

1. Implement core spawning utility and metadata changes.
2. Add `--detach` flag handling; ensure default workflow untouched.
3. Update tests (unit + smoke).
4. Refresh documentation/help text.
5. Perform manual cross-platform validation.
6. Release new version (likely minor bump) once verified.

## Open Questions

- Do we want to autobuffer logs from the detached worker into a file so the parent can display success/failure messages? (Optional enhancement.)
- Should detached mode become the default once stable, or remain opt-in?
- How do we surface chrome-launcher errors back to the parent during the readiness handshake?

