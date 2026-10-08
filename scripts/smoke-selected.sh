#!/usr/bin/env bash
# Run the smoke tests, or a selection of them several times (CI).
#   SMOKE_FILES   space-separated test files or globs (default: all smoke tests)
#   NAME_PATTERN  only tests whose name matches (empty = all)
#   REPEAT        how many times to run the selection (default: 1)
# Prints the spec report. In GitHub Actions, the tests that failed are also
# listed in the job summary, per run. Exits non-zero when any run failed.
set -u
SMOKE_FILES="${SMOKE_FILES:-src/__tests__/smoke/*.smoke.test.ts}"
REPEAT="${REPEAT:-1}"
failed_list="$(mktemp)"
args=(--test --test-concurrency=1
  --test-reporter=spec --test-reporter-destination=stdout
  --test-reporter=./scripts/failed-tests-reporter.mjs --test-reporter-destination="$failed_list")
if [ -n "${NAME_PATTERN:-}" ]; then args+=(--test-name-pattern "$NAME_PATTERN"); fi

# Appends the failed tests of run $1 to the job summary (GitHub Actions only).
summarize_failure() {
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  {
    echo "### Failed smoke tests: ${GITHUB_JOB:-smoke}, ${RUNNER_OS:-local}, Node $(node --version) (run $1 of $REPEAT)"
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
