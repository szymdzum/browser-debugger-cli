#!/usr/bin/env bash
# Assertion helpers for agent benchmarks

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Die with error message
die() {
  echo -e "${RED}[FATAL] $1${NC}" >&2
  exit 1
}

# Log levels
log_error() {
  echo -e "${RED}[ERROR] $1${NC}" >&2
}

log_warn() {
  echo -e "${YELLOW}[WARN] $1${NC}" >&2
}

log_info() {
  echo -e "${BLUE}[INFO] $1${NC}"
}

log_success() {
  echo -e "${GREEN}[OK] $1${NC}"
}

log_step() {
  echo -e "${BLUE}[STEP] $1${NC}"
}

# Assert greater than or equal
assert_gte() {
  local actual="$1"
  local expected="$2"
  local message="${3:-Assertion failed: $actual >= $expected}"
  
  if [ "$actual" -lt "$expected" ]; then
    log_error "$message"
    return 1
  fi
  return 0
}

# Assert not empty
assert_not_empty() {
  local value="$1"
  local message="${2:-Value should not be empty}"
  
  if [ -z "$value" ]; then
    log_error "$message"
    return 1
  fi
  return 0
}

# Assert has field (for JSON)
assert_has_field() {
  local json="$1"
  local field="$2"
  local message="${3:-JSON missing required field: $field}"
  
  local value
  value=$(echo "$json" | jq -r ".$field" 2>/dev/null)
  
  if [ "$value" = "null" ] || [ -z "$value" ]; then
    log_error "$message"
    return 1
  fi
  return 0
}

# Assert exit code
assert_exit_code() {
  local actual="$1"
  local expected="$2"
  local message="${3:-Expected exit code $expected, got $actual}"
  
  if [ "$actual" -ne "$expected" ]; then
    log_error "$message"
    return 1
  fi
  return 0
}

# Assert command succeeds
assert_success() {
  local command="$1"
  local message="${2:-Command failed: $command}"
  
  if ! eval "$command" > /dev/null 2>&1; then
    log_error "$message"
    return 1
  fi
  return 0
}

# Assert command fails
assert_failure() {
  local command="$1"
  local message="${2:-Command should have failed but succeeded: $command}"
  
  if eval "$command" > /dev/null 2>&1; then
    log_error "$message"
    return 1
  fi
  return 0
}
