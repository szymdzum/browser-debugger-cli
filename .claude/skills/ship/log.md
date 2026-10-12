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

## Escaped

Bugs found after the merge in behaviour a logged PR changed: the PR, the issue that reports it, and which step should have caught it.

| found | PR | issue | should have been caught by |
|---|---|---|---|
