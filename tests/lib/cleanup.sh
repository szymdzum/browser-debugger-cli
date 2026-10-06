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

  # Step 2: Force cleanup (this session's daemon and Chrome only)
  if command -v bdg >/dev/null 2>&1; then
    bdg cleanup --force 2>/dev/null || true
  fi

  # Step 3: Poll for PID file removal
  elapsed=0
  while [ -f "${BDG_SESSION_DIR:-/nonexistent}/daemon.pid" ]; do
    if (( $(echo "$elapsed >= $max_wait" | bc -l) )); then
      echo "[cleanup] Warning: Stale PID file after ${max_wait}s, removing manually" >&2
      rm -f "${BDG_SESSION_DIR:-/nonexistent}/daemon.pid" 2>/dev/null || true
      break
    fi
    sleep "$poll_interval"
    elapsed=$(echo "$elapsed + $poll_interval" | bc -l)
  done

  # Step 4: Poll for socket file removal
  elapsed=0
  while [ -S "${BDG_SESSION_DIR:-/nonexistent}/daemon.sock" ]; do
    if (( $(echo "$elapsed >= $max_wait" | bc -l) )); then
      echo "[cleanup] Warning: Stale socket file after ${max_wait}s, removing manually" >&2
      rm -f "${BDG_SESSION_DIR:-/nonexistent}/daemon.sock" 2>/dev/null || true
      break
    fi
    sleep "$poll_interval"
    elapsed=$(echo "$elapsed + $poll_interval" | bc -l)
  done

  echo "[cleanup] Cleanup complete" >&2
  remove_own_session_dir 2>/dev/null || true
  exit "$exit_code"
}

