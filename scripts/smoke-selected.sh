#!/usr/bin/env bash
# Run the smoke tests, or a selection of them several times (CI).
#   SMOKE_FILES   space-separated test files or globs (default: all smoke tests)
#   NAME_PATTERN  only tests whose name matches (empty = all)
#   REPEAT        how many times to run the selection (default: 1)
#   TEST_TIMEOUT  --test-timeout in ms (default: 300000). Node 24+ applies it
#                 to each test; Node 22 to each test file (its child processes
#                 run without a timeout), so it must exceed the slowest file
#                 (eval.smoke.test.ts, about 126 s on macOS). With
#                 --test-force-exit, a file whose timed-out test left handles
#                 open still exits.
#   SHARD         run only this shard of the files, e.g. 2/4, split by the
#                 recorded run times (scripts/smoke-shard.mjs; empty = all)
#   SHARD_INTEGRATION  non-empty: shard 1 also runs the integration suite
#                 afterwards, so it gets less smoke time (set it on every
#                 shard of a run alike)
#   SMOKE_TIMINGS file to write the seconds per test file to
#                 (scripts/smoke-timings-reporter.mjs; empty = none)
#   SMOKE_CONCURRENCY  how many test files run at once (default: 2). Each file
#                 has its own session directory, Chrome and ports, so files do
#                 not share state; 1 restores one file at a time
# Prints the spec report. In GitHub Actions, the tests that failed are also
# listed in the job summary, per run. Exits non-zero when any run failed.
set -u
SMOKE_FILES="${SMOKE_FILES:-src/__tests__/smoke/*.smoke.test.ts}"
if [ -n "${SHARD:-}" ]; then
  SMOKE_FILES="$(node scripts/smoke-shard.mjs "$SHARD" ${SHARD_INTEGRATION:+--integration})" || exit 2
fi
REPEAT="${REPEAT:-1}"
TEST_TIMEOUT="${TEST_TIMEOUT:-300000}"
SMOKE_CONCURRENCY="${SMOKE_CONCURRENCY:-2}"
case "$SMOKE_CONCURRENCY" in
  '' | *[!0-9]* | 0)
    echo "SMOKE_CONCURRENCY must be a positive integer, got: $SMOKE_CONCURRENCY" >&2
    exit 2
    ;;
esac
failed_list="$(mktemp)"
args=(--test --test-concurrency="$SMOKE_CONCURRENCY" --test-timeout="$TEST_TIMEOUT" --test-force-exit
  --test-reporter=spec --test-reporter-destination=stdout
  --test-reporter=./scripts/failed-tests-reporter.mjs --test-reporter-destination="$failed_list")
if [ -n "${NAME_PATTERN:-}" ]; then args+=(--test-name-pattern "$NAME_PATTERN"); fi
if [ -n "${SMOKE_TIMINGS:-}" ]; then
  args+=(--test-reporter=./scripts/smoke-timings-reporter.mjs --test-reporter-destination="$SMOKE_TIMINGS")
fi

# Appends the failed tests of run $1 to the job summary (GitHub Actions only).
summarize_failure() {
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  {
    echo "### Failed smoke tests: ${GITHUB_JOB:-smoke}, ${RUNNER_OS:-local}, Node $(node --version)${SHARD:+, shard $SHARD} (run $1 of $REPEAT)"
    echo
    if [ -s "$failed_list" ]; then cat "$failed_list"; else echo "No test reported a failure; see the log."; fi
    echo
  } >> "$GITHUB_STEP_SUMMARY"
}

failed=0
for i in $(seq 1 "$REPEAT"); do
  [ "$REPEAT" -gt 1 ] && echo "::group::run $i of $REPEAT"
  # shellcheck disable=SC2086 # SMOKE_FILES is a glob on purpose
  if ! npx tsx "${args[@]}" $SMOKE_FILES; then
    failed=$((failed + 1))
    summarize_failure "$i"
  fi
  [ "$REPEAT" -gt 1 ] && echo "::endgroup::"
done
/bin/rm -f "$failed_list"
echo "failed runs: $failed of $REPEAT"
[ "$failed" -eq 0 ]
