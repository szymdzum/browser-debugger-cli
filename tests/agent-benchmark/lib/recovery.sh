#!/usr/bin/env bash
# Recovery and retry patterns for agent benchmarks

# Tests run in a session directory of their own, never the user's ~/.bdg:
# run-all-tests.sh gives each test one; a test run on its own creates one
# here (removed by remove_own_session_dir in its cleanup).
if [ -z "${BDG_SESSION_DIR:-}" ]; then
  BDG_SESSION_DIR="$(mktemp -d /tmp/bdg-it-XXXXXX)"
  export BDG_SESSION_DIR
  BDG_OWN_SESSION_DIR="$BDG_SESSION_DIR"
fi

# Remove the session directory this file created (nothing when run-all-tests.sh gave it)
remove_own_session_dir() {
  if [ -n "${BDG_OWN_SESSION_DIR:-}" ]; then
    command rm -rf "$BDG_OWN_SESSION_DIR"
  fi
}

# Retry a command with exponential backoff
# Usage: retry_with_backoff <max_attempts> <command>
retry_with_backoff() {
  local max_attempts="$1"
  shift
  local command="$*"
  
  local attempt=1
  local delay=1
  
  while [ $attempt -le "$max_attempts" ]; do
    log_info "Attempt $attempt/$max_attempts: $command"
    
    if eval "$command"; then
      log_success "Command succeeded on attempt $attempt"
      return 0
    fi
    
    if [ $attempt -lt "$max_attempts" ]; then
      log_warn "Command failed, retrying in ${delay}s..."
      sleep "$delay"
      delay=$((delay * 2))  # Exponential backoff
    fi
    
    attempt=$((attempt + 1))
  done
  
  log_error "Command failed after $max_attempts attempts"
  return 1
}

# Retry with fixed delay
# Usage: retry_fixed <max_attempts> <delay_seconds> <command>
retry_fixed() {
  local max_attempts="$1"
  local delay="$2"
  shift 2
  local command="$*"
  
  local attempt=1
  
  while [ $attempt -le "$max_attempts" ]; do
    log_info "Attempt $attempt/$max_attempts: $command"
    
    if eval "$command"; then
      log_success "Command succeeded on attempt $attempt"
      return 0
    fi
    
    if [ $attempt -lt "$max_attempts" ]; then
      log_warn "Command failed, retrying in ${delay}s..."
      sleep "$delay"
    fi
    
    attempt=$((attempt + 1))
  done
  
  log_error "Command failed after $max_attempts attempts"
  return 1
}

# Clean up stale bdg sessions
cleanup_sessions() {
  log_step "Cleaning up stale sessions"
  
  if bdg cleanup --force > /dev/null 2>&1; then
    log_success "Session cleanup complete"
  else
    log_warn "Session cleanup had issues (may be expected)"
  fi
}

# Graceful session stop with retry
stop_session_gracefully() {
  local max_attempts=3
  local attempt=1
  
  while [ $attempt -le $max_attempts ]; do
    if bdg stop > /dev/null 2>&1; then
      log_success "Session stopped successfully"
      return 0
    fi
    
    log_warn "Failed to stop session (attempt $attempt/$max_attempts)"
    sleep 1
    attempt=$((attempt + 1))
  done
  
  # Force cleanup as last resort
  log_warn "Graceful stop failed, forcing cleanup"
  cleanup_sessions
  return 1
}

# Wait for condition with timeout
# Usage: wait_for_condition <timeout_seconds> <check_command> <description>
wait_for_condition() {
  local timeout="$1"
  local check_command="$2"
  local description="${3:-condition}"
  
  local elapsed=0
  local interval=1
  
  log_step "Waiting for $description (timeout: ${timeout}s)"
  
  while [ $elapsed -lt "$timeout" ]; do
    if eval "$check_command" > /dev/null 2>&1; then
      log_success "$description met after ${elapsed}s"
      return 0
    fi
    
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  
  log_error "$description not met after ${timeout}s"
  return 1
}

# Capture error context for debugging
capture_error_context() {
  local scenario_name="$1"
  local error_message="$2"
  
  log_error "Capturing error context for $scenario_name"
  
  # Create error context file
  local context_file="results/${scenario_name}-error-context.txt"
  
  {
    echo "=== Error Context ==="
    echo "Scenario: $scenario_name"
    echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo "Error: $error_message"
    echo ""
    echo "=== Session Status ==="
    bdg status 2>&1 || echo "Failed to get status"
    echo ""
    echo "=== Chrome Processes ==="
    ps aux | grep -i chrome | grep -v grep || echo "No Chrome processes"
    echo ""
    echo "=== Session port ==="
    local port
    port=$(jq -r '.port // empty' "$BDG_SESSION_DIR/session.meta.json" 2>/dev/null)
    if [ -n "$port" ]; then lsof -i :"$port" || echo "Port $port not in use"; else echo "No session port"; fi
    echo ""
    echo "=== Session Files ==="
    ls -la "$BDG_SESSION_DIR"/ 2>&1 || echo "No session directory"
  } > "$context_file"
  
  log_info "Error context saved to: $context_file"
}

# Fallback wait implementation (when dom.wait doesn't exist)
fallback_wait() {
  local selector="$1"
  local timeout="${2:-10}"

  log_warn "Using fallback wait (dom.wait not implemented yet)"
  log_info "Waiting ${timeout}s for selector: $selector"

  # Simple sleep fallback
  sleep "$timeout"

  # TODO: Could implement polling with CDP here
  # For now, just sleep and hope

  return 0
}

# Wait for session.json to be created and valid
# Usage: wait_for_session_json <timeout_seconds>
wait_for_session_json() {
  local timeout="${1:-10}"
  local session_json="$BDG_SESSION_DIR/session.json"

  log_step "Waiting for session.json to be created and valid (timeout: ${timeout}s)"

  # First, wait for file to exist
  if ! wait_for_condition "$timeout" "[ -f '$session_json' ]" "session.json file existence"; then
    return 1
  fi

  # Wait a bit for file to be fully written
  sleep 0.5

  # Then validate it's valid JSON with retry
  local max_attempts=5
  local attempt=1

  while [ $attempt -le $max_attempts ]; do
    if jq -e . "$session_json" >/dev/null 2>&1; then
      log_success "session.json is valid (attempt $attempt/$max_attempts)"
      return 0
    fi

    if [ $attempt -lt $max_attempts ]; then
      log_warn "session.json not valid yet (attempt $attempt/$max_attempts), retrying..."
      sleep 0.5
    fi

    attempt=$((attempt + 1))
  done

  log_error "session.json exists but contains invalid JSON after $max_attempts attempts"
  return 1
}
