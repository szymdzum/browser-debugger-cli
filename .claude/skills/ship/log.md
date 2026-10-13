# PR log

One row per merged PR, appended with `ship log <pr> …` right after the merge. The retro reads it to decide what to keep: which step found what, what each PR cost, and what escaped to `main`.

- **review:** blocking/should-fix/nit from the first review; a tier-3 second review is added after `+`.
- **tester:** bugs about the change found by the fresh-agent test (friction and older-code findings not counted).
- **rounds:** fix rounds before the merge (a rebase alone doesn't count).
- **tokens:** subagent tokens for the PR (implementer, reviewers, tester), from the agents' usage lines.

| merged | PR | issues | tier | review | tester | rounds | model | tokens | note |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-12 | #672 | #635 | 2 | 0/0/3 | 0 | 1 | sonnet | 132k | reviewer matrix 35×19, 0 wrong |
| 2026-10-12 | #673 | #611 | 3 | 0/1/2+0/1/1 | 2 | 2 | opus | 285k | tester: stop wording, start-cancel envelope without suggestion; repeat=10 green |
| 2026-10-12 | #674 | #632 | 2 | 0/1/3 | 2 | 1 | sonnet | 148k | tester: --index messages inconsistent across commands |
| 2026-10-12 | #675 | #612 | 2 | 0/0/3 | 0 | 1 | sonnet | 179k | key-event matrix 23 keys, 0 wrong; one clean rebase |
| 2026-10-12 | #676 | #657 | 2 | 0/1/3 | 2 | 1 | sonnet | 186k | reviewer env matrix and tester both found the start path skipping validation (exit 110) |
| 2026-10-12 | #680 | #678 | 3 | 0/2/3 | 0 | 1 | opus | 400k | sync-created tracked temp file closed the pending-open gap (reviewer); tester couldn't hit the 0.25 s window by hand, child-process test did |
| 2026-10-12 | #681 | #487 | 3 | 0/2/5 | 1 | 2 | opus | 430k | attach-mode socket-error kept as crash (review); tester asked whether Chrome was left running → status line says it was closed; main red from a port-substring flake (#682) |
| 2026-10-12 | #682 | - | 1 | 0/1/1 | - | 1 | orchestrator | 31k | main red: /4111/ matched random fixture port :44111; reviewer caught partial-card gap in the first fix |
| 2026-10-12 | #683 | #669 | 2 | 0/1/2 | 1 | 2 | sonnet | 200k | argv check before parse; tester found argParser options still gave commander's message (round 2); reviewer matrix 54 cells caught short-flag suggestion |
| 2026-10-12 | #684 | #677 | 2 | 0/2/2 | 0 | 0 | sonnet | 180k | one builder; exit 83 still from error text (filed as older code); misclassification matrix 0/5 |
| 2026-10-12 | #685 | #630 | 2 | 0/3/3 | 1 | 2 | sonnet | 420k | user chose real selector for data.selector (contract); review: ancestor-id branch dead, builder moved to bdg world, remote object leak; tester: human echo shows a class-only descriptor matching 8 nodes |
| 2026-10-12 | #689 | #686 | 3 | 0/2/5 | 0 | 2 | opus | 560k | entry split into dist/index.js + dist/cli.js so the interrupt report exists before the CLI loads; reviewer risk resume found nothing; CLAUDE.md line by orchestrator after implementer refused (needs user's word) |
| 2026-10-12 | #690 | #687 | 2 | 0/1/2 | 0 | 1 | sonnet | 330k | eval awaitPromise:false + liveness probe; reviewer 82-run eval matrix vs base: only intended changes; V8 parse message leaked response fragments (fixed); tester: --full on 200 MB OOMs the CLI (older code) |
| 2026-10-12 | #691 | #688 | 2 | 0/0/2 | 0 | 1 | sonnet | 280k | implicit type omitted from human output; CI caught an assertion the implementer missed (element-classes smoke); agent died once on API ECONNRESET and resumed |
| 2026-10-12 | #696 | - | 1 | 1/1/2 | - | 1 | sonnet | 150k | retro S4: gh retry on reads only, ship log inserted rows under Escaped (fixed), 50x matched PR numbers (fixed) |
| 2026-10-12 | #697 | #695 | 2 | 0/1/3 | 0 | 2 | sonnet | 220k | user chose option A; review matrix caught --session value cases masked by the new bare check; tester filed #698 (help/group JSON gaps) |
| 2026-10-13 | #700 | #699 | 1 | 0/2/6 | - | 2 | sonnet | ~205k | #699 gh/git calls get a 60 s timeout (writes 180 s, merge rechecks state), waiter deadlines incl. run-wait --timeout; left: bare --timeout = 1 min |
| 2026-10-13 | #701 | #660 | 2 | 1/1/2 | 0 | 1 | sonnet | ~470k | #660 shared withTimeout/raceTimeout/waitForProcessExit/abortOnInterrupt; screenshot --follow SIGTERM regression caught by review; tester older findings (follow --json envelopes) → verifier |
| 2026-10-13 | #702 | #693 | 2 | 0/6/5 | 1 | 2 | sonnet | ~560k | #693 --full 50 MiB cap (page early stop + daemon byte backstop, exit 81); review found 4 bypasses (Map/Set, floats, multibyte, replaced built-ins); tester: '50 MB' vs MiB wording left → file |
| 2026-10-13 | #703 | #659 | 3 | 0/2/5 | 0 | 1 | opus | ~900k | #659 ResourceStack + startSequence (11 throwIfStopping gone) + one runShutdown; fix round found re-entrant shutdown recursion (stack overflow) via new caller tests; adjacent: shutdown steps isolated; tester daemonStillRunning hint once, not reproduced in 30 runs |

## Escaped

Bugs found after the merge in behaviour a logged PR changed: the PR, the issue that reports it, and which step should have caught it.

| found | PR | issue | should have been caught by |
|---|---|---|---|
