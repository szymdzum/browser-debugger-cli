#!/usr/bin/env bash
# Recovery and retry patterns for agent benchmarks

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

# Ensure Chrome processes are killed
kill_chrome_processes() {
  log_step "Killing Chrome processes"
  
  # Kill Chrome processes gracefully first
  if pkill -TERM "Google Chrome" 2>/dev/null; then
    sleep 2
  fi
  
  # Force kill if still running
  if pkill -KILL "Google Chrome" 2>/dev/null; then
    log_warn "Force killed Chrome processes"
  else
    log_info "No Chrome processes to kill"
  fi
}

# Full environment reset
reset_environment() {
  log_step "Resetting environment"
  
  cleanup_sessions
  kill_chrome_processes
  
  # Wait for cleanup to settle
  sleep 1
  
  log_success "Environment reset complete"
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
    echo "=== Port 9222 ==="
    lsof -i :9222 || echo "Port 9222 not in use"
    echo ""
    echo "=== Session Files ==="
    ls -la ~/.bdg/ 2>&1 || echo "No session directory"
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
