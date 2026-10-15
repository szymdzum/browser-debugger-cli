#!/usr/bin/env bash
# Local fixture server for the shell suites, so they need no outside network.
#
# run-all-tests.sh sources this, calls start_fixture_server (free port, PID file)
# and stop_fixture_server on exit. The URL is exported as BDG_FIXTURE_URL, e.g.
# http://127.0.0.1:53211/. A suite run on its own needs BDG_FIXTURE_URL
# exported (npx tsx src/__testutils__/serveFixtures.ts prints one).

FIXTURE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE_PID_FILE=""
FIXTURE_LOG=""

start_fixture_server() {
  if [ -n "${BDG_FIXTURE_URL:-}" ]; then
    return 0
  fi
  FIXTURE_PID_FILE="$(mktemp /tmp/bdg-it-fixtures-XXXXXX.pid)"
  FIXTURE_LOG="$(mktemp /tmp/bdg-it-fixtures-XXXXXX.log)"
  (cd "$FIXTURE_ROOT" && exec node --import tsx src/__testutils__/serveFixtures.ts) > "$FIXTURE_LOG" 2>&1 &
  echo $! > "$FIXTURE_PID_FILE"

  local waited=0
  while ! grep -q '^fixtures:' "$FIXTURE_LOG"; do
    if ! kill -0 "$(cat "$FIXTURE_PID_FILE")" 2>/dev/null || [ "$waited" -ge 300 ]; then
      echo "Fixture server did not start:" >&2
      cat "$FIXTURE_LOG" >&2
      return 1
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  BDG_FIXTURE_URL="$(sed -n 's/^fixtures: *//p' "$FIXTURE_LOG" | head -1)"
  export BDG_FIXTURE_URL
}

stop_fixture_server() {
  if [ -n "$FIXTURE_PID_FILE" ] && [ -f "$FIXTURE_PID_FILE" ]; then
    kill "$(cat "$FIXTURE_PID_FILE")" 2>/dev/null || true
    command rm -f "$FIXTURE_PID_FILE" "$FIXTURE_LOG"
  fi
}

require_fixture_url() {
  if [ -z "${BDG_FIXTURE_URL:-}" ]; then
    echo "BDG_FIXTURE_URL is not set: run via tests/run-all-tests.sh" >&2
    return 1
  fi
}
