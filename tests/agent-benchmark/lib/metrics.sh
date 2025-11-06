#!/usr/bin/env bash
# Metrics tracking for agent benchmarks

# Global metrics storage
declare -A METRICS
BENCHMARK_START_TIME=0

# Initialize benchmark
start_benchmark() {
  local scenario_name="$1"
  BENCHMARK_START_TIME=$(date +%s)  # seconds (macOS date doesn't support milliseconds)
  METRICS["scenario"]="$scenario_name"
  METRICS["start_time"]=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  log_info "Starting benchmark: $scenario_name"
}

# End benchmark
end_benchmark() {
  local scenario_name="$1"
  local status="${2:-success}"

  local end_time=$(date +%s)
  local duration=$((end_time - BENCHMARK_START_TIME))

  METRICS["end_time"]=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  METRICS["duration_seconds"]="$duration"
  METRICS["status"]="$status"

  log_info "Benchmark complete: $scenario_name (${duration}s, status: $status)"
}

# Record a metric
record_metric() {
  local key="$1"
  local value="$2"
  METRICS["$key"]="$value"
  log_info "Metric recorded: $key=$value"
}

# Get a metric value
get_metric() {
  local key="$1"
  echo "${METRICS[$key]}"
}

# Export metrics to JSON
export_metrics() {
  local output_file="$1"
  
  # Build JSON manually (bash doesn't have jq for writing)
  {
    echo "{"
    echo "  \"scenario\": \"${METRICS[scenario]}\","
    echo "  \"status\": \"${METRICS[status]}\","
    echo "  \"start_time\": \"${METRICS[start_time]}\","
    echo "  \"end_time\": \"${METRICS[end_time]}\","
    echo "  \"duration_seconds\": ${METRICS[duration_seconds]},"
    echo "  \"metrics\": {"
    
    local first=true
    for key in "${!METRICS[@]}"; do
      # Skip meta fields
      if [[ "$key" =~ ^(scenario|status|start_time|end_time|duration_seconds)$ ]]; then
        continue
      fi
      
      if [ "$first" = false ]; then
        echo ","
      fi
      first=false
      
      echo -n "    \"$key\": "
      # Try to detect if value is numeric
      if [[ "${METRICS[$key]}" =~ ^[0-9]+$ ]]; then
        echo -n "${METRICS[$key]}"
      else
        echo -n "\"${METRICS[$key]}\""
      fi
    done
    
    echo ""
    echo "  }"
    echo "}"
  } > "$output_file"
}

# Record error
record_error() {
  local error_message="$1"
  local error_type="${2:-unknown}"
  
  METRICS["error_message"]="$error_message"
  METRICS["error_type"]="$error_type"
  
  log_error "Error recorded: $error_type - $error_message"
}
