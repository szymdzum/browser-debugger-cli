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
| 2026-10-13 | #707 | - | 1 | 0/1/3 | - | 1 | sonnet | ~175k | retro S5: SIGINT via Node spawner, snapshot --accept, briefs as files, Not-checked resume tier 3 only; log rows S4/S5 |
| 2026-10-13 | #708 | #704 | 2 | 0/1/2 | 0 | 1 | sonnet | 330k | screenshot --follow 130/143; reviewer race fix; tester older-code nits (Captured 1 frames, console --follow JSON help) to verifier |
| 2026-10-13 | #709 | #606 | 3 | 0/4/9 | 0 | 2 | opus | 820k | shared releaseObjectGroup + daemon sweeps groups of exited CLI pids (user accepted pid over connection); 2nd reviewer found 2 should-fix; adjacent Date.now() group names |
| 2026-10-13 | #710 | #705 | 2 | 1/2/3 | 1 | 2 | sonnet | 560k | eval fails fast: page-side size cap 256 MiB (101→81, user OK), ping+12 s grace for lost strings (reviewer caught false 102 on slow sync scripts); tester's wrong 'drop --full' hint → #706 |
| 2026-10-13 | #711 | #706 | 2 | 0/3/4 | 2 | 2 | sonnet | 420k | MiB wording + suggestions that work (slice in chars, Map by keys); folded #705's wrong 'drop --full' hint; state file limit documented; filed #715 |
| 2026-10-13 | #718 | #543 | 1 | 0/0/3 | - | 1 | sonnet | ~140k | #543 shared waitForCommand (product hasArgument) replaces isProcessAlive waits + a 300 ms sleep in sessionOwnership; Linux fork+exec vs macOS posix_spawn, no local repro (200×) |
| 2026-10-13 | #719 | #714 | 2 | 0/2/1 | 1 | 2 | sonnet | ~245k | #714 Captured 1 frame + FOLLOW_BEHAVIOR per update/backlog per command + Ctrl-C window; review caught 'default 100' false for peek (10); tester: 50 ms window overclaims under load (docs reworded); tester's 'help says nothing' claim wrong again (per-command --help --json has it) |
| 2026-10-13 | #720 | #713 | 3 | 0/3/3 | 1 | 1 | opus | ~500k | #713 dom_eval uses the abandoned signal: terminatePageScripts only while pending, after earlier evals, page not answering 500 ms; 18 s -> 0.5 s; review: pre-aborted signal, overclaiming message, queue tests; rebase conflict with #719 docs blocked pull_request CI; implementer hit API session limit once; tester: bdg cdp Runtime.evaluate still keeps page busy 25 s (older code, file) |
| 2026-10-13 | #724 | - | 3 | 0/2/1 | 0 | 0 | opus | ~330k | regression fix of #720 (main red, run 38446912926, Node 24/26): stop tracking once answered; stop only while own script may run; merged by hand: gate 5 'main is green' can't hold for the PR that fixes main; should-fixes (await-script blocks later stop, mentionsAwait text search, fixed sleep in unit test) filed |
| 2026-10-13 | #721 | #599 #609 | 3 | 1/6/5 | 1 | 3 | opus | ~900k | #609+#599 one visibility verdict from what an element paints (inspect/layout/:visible); owner chose B (opacity/clip-path hidden in inspect+layout, :visible Playwright) and an approved 3rd round (:visible skips ancestor-clipped); 2nd reviewer found blocking alpha bug (endsWith ', 0)' treated red/green as transparent); matrices 42+3 cases; follow-ups filed |
| 2026-10-14 | #722 | #640 | 2 | 0/1/4 | 0 | 1 | sonnet | ~400k | #640 open item: status/peek show the loading state (same words as page navigate, on-demand probe bounded 1 s) + peek Page: header; fixture swapped busy loop -> slow script (busy page can't answer, documented); macOS smoke hit the 30-min job limit once, rerun passed; ship merge hung twice on transient gh calls |
| 2026-10-14 | #723 | #712 | 3 | 0/3/5 | 0 | 2 | sonnet | ~600k | #712 daemon caps a reply line at 256 MiB (exit 81), CLI overflow -> exit 81, lost-reply check for sync Runtime.evaluate (Chrome never sends >256 MiB) -> 81 instead of 110; 250e6 OOM was escapeControlChars (rope per char), now prints in 5 s; review: awaitPromise limit documented, debugger-paused false 81 fixed + tested; rebased over #724 conflict in evalHelpers |

## Escaped

Bugs found after the merge in behaviour a logged PR changed: the PR, the issue that reports it, and which step should have caught it.

| found | PR | issue | should have been caught by |
|---|---|---|---|
| 2026-10-13 | #720 | - (main red, fixed by #724) | reviewer saw the stale-terminate window and rated it a nit; tester never ran a lost eval next to another client; PR CI smoke runs Node 22 only |
