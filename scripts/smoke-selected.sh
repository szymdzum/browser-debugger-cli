#!/usr/bin/env bash
# Run selected smoke tests several times (CI workflow_dispatch).
#   SMOKE_FILES   space-separated test files or globs
#   NAME_PATTERN  only tests whose name matches (empty = all)
#   REPEAT        how many times to run the selection
# Exits non-zero when any run failed.
set -u
REPEAT="${REPEAT:-1}"
args=(--test --test-concurrency=1)
if [ -n "${NAME_PATTERN:-}" ]; then args+=(--test-name-pattern "$NAME_PATTERN"); fi
failed=0
for i in $(seq 1 "$REPEAT"); do
  echo "::group::run $i of $REPEAT"
  # shellcheck disable=SC2086 # SMOKE_FILES is a glob on purpose
  npx tsx "${args[@]}" $SMOKE_FILES || failed=$((failed + 1))
  echo "::endgroup::"
done
echo "failed runs: $failed of $REPEAT"
[ "$failed" -eq 0 ]
