# Daemon = Session Migration

**Status:** Implemented (pending review)
**Started:** 2026-10-03
**Target version:** 0.8.0

Collapse the three-tier process model into two, and make the daemon's lifetime
equal to the session's. Liveness is decided by the socket, not by PID files.

```text
before:  CLI ──socket──► daemon (proxy) ──stdin/stdout──► worker ──► Chrome
after:   CLI ──socket──► daemon = session (Chrome + CDP + telemetry, one process)
```

## Why

A code review found that most of the defects in process management come from the
daemon/worker split and from PID-file bookkeeping, not from isolated mistakes:

- Worker timeouts reply with the wrong response type (`worker_status_response`), which the client rejects.
- Launch listeners are never removed, so stdout is parsed twice and the stderr buffer grows without limit.
- The worker is spawned with `node` from PATH, while the daemon uses `process.execPath`.
- Pre-start cleanup deletes the `daemon.lock` it was just called under, so two concurrent starts can spawn two daemons.
- Stopping during startup, or SIGTERM to the daemon, leaves the worker and Chrome running.
- The orphaned-daemon scan (`ps | grep dist/daemon.js`) SIGKILLs unrelated processes on macOS, where `/proc` is unavailable.
- PID reuse can make a stale PID file look alive and get an unrelated process killed.

## Principles

1. **The daemon is the session.** Only `bdg <url>` spawns it. It exits on `stop`, on Chrome disconnect, on `--timeout`, or if no `start_session` arrives shortly after spawn. Other commands never spawn anything: no socket means no session (exit 83; `bdg status` reports `active: false` with exit 0, as on main).
2. **Liveness = socket.** If a connection succeeds, the daemon is alive. `ECONNREFUSED` means the socket is stale and can be removed.
3. **Chrome cleanup is in-process.** Teardown runs in `try/finally` and in signal handlers. After a hard crash, the only trace is `chrome.pid`. It is killed only if `ps -o command= -p PID` shows the `--bdg-session-dir=<session dir>` marker flag bdg adds to every Chrome it launches.

## Stages

Each stage is a separate, green step. Smoke tests must pass before moving on.

### Stage 0: Safety net

- [x] Fix the `npm test` glob. Patterns must be quoted so Node expands `**`, not `sh`; around 11 test files currently never run.
- [x] Fix the 4 failing `PatternDetector` tests that this uncovers.
- [x] Run smoke tests on PRs, not only on `main`.
- [x] Isolate smoke tests via `BDG_SESSION_DIR`. No `pkill -9 -f "node.*dist/daemon"` and no `cleanup --aggressive` against the developer's real sessions.
- [x] Add an e2e test of the core agent loop on the fixture page: start → `dom query` → `dom fill/click <index>` → `network list` → `status` → `stop` → no processes or files left.
- [x] Fix the index resolver so the e2e test passes. Today `dom query` caches the text preview, which is then used as a CSS selector, and `index + 1` is sent to 0-based page scripts.

### Stage 1: Worker in-process (CLI ↔ daemon protocol unchanged)

- [x] Introduce `Session`, which owns `chrome`, `cdp`, `TelemetryStore`, `cleanupFunctions` and `commandRegistry`. Built from `setupChromeConnection`, `setupCDPAndNavigate` and `cleanupWorker`.
- [x] Daemon handlers call registry handlers directly, wrapped in a timeout. Keep the mapping from `CommandError` to the response's exitCode and suggestion.
- [x] Remove `worker.ts`, `startSession.ts`, `WorkerManager`, `lifecycle/workerIpc.ts`, `daemon/workerIpc.ts`, `JsonlParser`, `PendingRequestManager`, `ResponseHandler`, and `BaseHandler.forwardToWorker`.

### Stage 2: Daemon lifecycle = session

- [x] In `src/index.ts`, spawn the daemon only for the start command, and use `parseAsync`. (A JSON envelope for daemon startup failure is out of scope: the start command has no `--json` mode yet.)
- [x] Single instance via socket. Connect to the existing socket: success means "already running". Otherwise remove the stale socket and `listen`. Close the race window atomically: listen on a temporary path, then `link()` to the final path, where `EEXIST` means we lost. Verify `link()` on socket files on macOS and Linux; the fallback is a short `O_EXCL` lock with age-based expiry.
- [x] Daemon SIGTERM/SIGINT handlers run full, idempotent teardown.
- [x] Remove the lock dance in `daemon/launcher.ts`, `daemon.lock`, `session.lock`, `session.pid`, `preStart.ts`, `sessionProbe.ts`, and the reconcile/recover logic in `SessionHandlers`.

### Stage 3: Cleanup

- [x] Delete `orphanedDaemons.ts`.
- [x] Reduce `bdg cleanup` to three steps: remove a dead socket, kill the verified Chrome from `chrome.pid`, and clear metadata.
- [x] Validate `pid > 0` wherever PIDs are still read.
- [x] Single JSONL implementation for the client and the server.
- [x] Update `docs/CLI_REFERENCE.md`, `CLAUDE.md`, `.claude/skills/bdg/SKILL.md` and `CHANGELOG.md`.

## User-visible changes

- Commands with no session no longer spawn a daemon. They report "no active session" (exit 83). `bdg status` keeps main's behavior: `active: false`, exit 0.
- `workerPid` in the start response now carries the daemon PID. The field name is kept for compatibility.
- `session.pid`, `daemon.lock` and `session.lock` disappear from `~/.bdg`.
- `--chrome-ws-url`, `--headless`, `--timeout` and the other start flags are unchanged.

## Notes from implementation

- `link()` on Unix socket files works on macOS and Linux, so the atomic claim is used. There is no lock-file fallback.
- A stale socket plus two simultaneous starts leave a narrow window: both daemons may remove the stale file and claim the path in turn. Both CLIs then talk to the last claimant. The other daemon exits after its 10 s idle timeout and never removes a socket or PID file it no longer owns (inode/PID checked).
- The final DOM snapshot taken on stop was removed. Its only consumer was `session.json`, which no code ever wrote. `TelemetryStore.domData`/`buildOutput` and `peek --dom` are now vestigial and can be removed in a follow-up.
- Internal command keys keep their `worker_*` names (e.g. `worker_peek`) to leave the CLI ↔ daemon protocol untouched.

## Out of scope

Functional bugs found in the same review are fixed in separate PRs. These are wrong key modifier bits, exceptions shown only as "Uncaught", redirect hops being overwritten, HAR cookies and timings, and JSON envelope gaps. The index resolver is the exception: it is part of Stage 0.
