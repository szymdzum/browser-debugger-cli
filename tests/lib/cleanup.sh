#!/usr/bin/env bash
# Robust cleanup utility with polling for shell tests.
#
# Replaces hard-coded sleep patterns with adaptive polling that waits
# for actual cleanup completion (port release, PID removal, file deletion).
#
# Usage:
#   source "$(dirname "$0")/../lib/cleanup.sh"
#   trap cleanup_with_polling EXIT INT TERM

set -euo pipefail

cleanup_with_polling() {
  local exit_code=$?
  local max_wait=10
  local poll_interval=0.5
  local elapsed=0

  echo "[cleanup] Starting cleanup..." >&2

  # Step 1: Graceful stop attempt
  if command -v bdg >/dev/null 2>&1; then
    bdg stop 2>/dev/null || true
    sleep 1
  fi

  # Step 2: Poll for port release
  local port="${BDG_TEST_PORT:-9222}"
  if command -v lsof >/dev/null 2>&1; then
    while lsof -ti:"$port" >/dev/null 2>&1; do
      if (( $(echo "$elapsed >= $max_wait" | bc -l) )); then
        echo "[cleanup] Warning: Port $port still in use after ${max_wait}s, forcing..." >&2
        lsof -ti:"$port" | xargs kill -9 2>/dev/null || true
        break
      fi
      sleep "$poll_interval"
      elapsed=$(echo "$elapsed + $poll_interval" | bc -l)
    done
    echo "[cleanup] Port $port released (${elapsed}s)" >&2
  fi

  # Step 3: Force cleanup
  if command -v bdg >/dev/null 2>&1; then
    bdg cleanup --force 2>/dev/null || true
  fi

  # Step 4: Poll for PID file removal
  elapsed=0
  while [ -f "$HOME/.bdg/daemon.pid" ]; do
    if (( $(echo "$elapsed >= $max_wait" | bc -l) )); then
      echo "[cleanup] Warning: Stale PID file after ${max_wait}s, removing manually" >&2
      rm -f "$HOME/.bdg/daemon.pid" 2>/dev/null || true
      break
    fi
    sleep "$poll_interval"
    elapsed=$(echo "$elapsed + $poll_interval" | bc -l)
  done

  # Step 5: Poll for socket file removal
  elapsed=0
  while [ -S "$HOME/.bdg/daemon.sock" ]; do
    if (( $(echo "$elapsed >= $max_wait" | bc -l) )); then
      echo "[cleanup] Warning: Stale socket file after ${max_wait}s, removing manually" >&2
      rm -f "$HOME/.bdg/daemon.sock" 2>/dev/null || true
      break
    fi
    sleep "$poll_interval"
    elapsed=$(echo "$elapsed + $poll_interval" | bc -l)
  done

  echo "[cleanup] Cleanup complete" >&2
  exit "$exit_code"
}

cleanup_with_port() {
  local port="$1"
  export BDG_TEST_PORT="$port"
  cleanup_with_polling
}
