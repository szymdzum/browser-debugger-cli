# Cloud round: red team

A cloud round runs five red-team agents in Claude cloud routines, which are billed to the subscription. Each agent tries to make bdg lie or crash in one area. Every finding needs proof: the page, the bdg command with its output and exit code, and an independent check that contradicts it (raw CDP via `bdg cdp`, a screenshot, or the page's own script output). The agents may read the source (white box). The rounds so far:

- S24 gave agents user tasks and truth files: no finding was reproduced.
- S27 used this kit: 23 of 23 findings were reproduced, three of them high (#890–#892).

## Files

- `routine-template.md`: the prompt. It covers setup (`bdg` as a PATH script, `BDG_ATTACH_REQUIRE_WS_URL=1`), the agent's own pages, the rules of evidence, and the report on branch `cloud-round/<round>-<agent>`, with a fallback in parts of at most 1800 characters, one part per message.
- `agents/<agent>.md`: `AREA`, `TARGETS` (attack ideas) and `COVERED` (what tests already cover).
  - `smoke` is the environment check.
  - `r1-nav` covers navigation and load failures.
  - `r2-verdicts` covers action verdicts and the press and cover checks.
  - `r3-forms` covers forms, shadow DOM and iframes.
  - `r4-network` covers network list, details, HAR and timing.
  - `r5-cli` covers arguments, exit codes, `--json`, sessions and interrupts.
- `render.mjs`: `SHIP_CLOUD_ENV=<environment id> node render.mjs <round> <agent> <sha> > /tmp/<round>-<agent>.json` prints the `RemoteTrigger create` body, and `--prompt` prints only the prompt. The environment id is in the cloud-routines memory note. This repo is public, so the id is never written here.

The session's working files go to `.tmp/cloud-round-<round>/` in the main checkout (git-ignored): `reports/<agent>/`, `candidates/` (pages that reproduce a real bug, which become fixtures or matrix rows), `triggers.txt` (routine ids and their state) and `SUMMARY.md`.

## Before a round

Update every agent's `COVERED` with what the previous round found and what its "Held" lists showed bdg handling correctly. Add new `TARGETS` for features merged since then. This is a PR to this skill.

## Running it

1. `main` must be green, and all routines test one SHA. Render a body, then make one `RemoteTrigger create` call per routine. The tool echoes the whole prompt about three times (~20k tokens per call), so call it yourself instead of passing prompts through a subagent. A subagent also loses `RemoteTrigger` when its process restarts (S27).
2. Run `smoke` first and check that the branch `cloud-round/<round>-smoke` is on origin. Pushes need the Claude GitHub App, which has access since S24. If the branch is missing, read the report parts with `get_run_log`.
3. After the owner's yes, start the five agents at once (5 concurrent routines worked in S24 and S27).
4. **Disable each routine after it fires** (`update` with `enabled: false`): after a run_once, `next_run_at` still shows +1 day.
5. Collect the reports with `git fetch origin 'refs/heads/cloud-round/<round>-*:refs/remotes/origin/cloud-round/<round>-*'` and copy `reports/<agent>/` into the working directory.
6. uitestingplayground.com is blocked from the cloud. Traffic there goes through a proxy, so `Remote Address` shows 127.0.0.1.

## Verifying and triage

One local verifier (macOS, Chrome, same SHA) reproduces every finding from its evidence: `ship brief verifier FINDINGS=<report.md,report.md…> HEAD=<sha> DATE=<round>`. Triage follows "Fix, file or record". Only high and medium findings become issues, each with the local command and output. Write `SUMMARY.md`, post a summary comment on the round's issue and on #466, and ask the owner before deleting the `cloud-round/<round>-*` branches.
