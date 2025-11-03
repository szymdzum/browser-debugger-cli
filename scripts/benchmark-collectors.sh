#!/bin/bash

# Benchmark script for bdg collectors
# Captures data from localhost:3000 and generates comparative analysis

set -e

BENCHMARK_DIR="benchmarks/$(date +%Y%m%d-%H%M%S)"
CAPTURE_DURATION=${CAPTURE_DURATION:-10}
TARGET_URL=${TARGET_URL:-localhost:3000}

echo "═══════════════════════════════════════════════════════════"
echo "          BDG COLLECTOR BENCHMARK"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Target URL: $TARGET_URL"
echo "Capture Duration: ${CAPTURE_DURATION}s"
echo "Output Directory: $BENCHMARK_DIR"
echo ""

# Check if target is accessible
if ! curl -s -o /dev/null -w "%{http_code}" "http://$TARGET_URL" | grep -q "200"; then
  echo "❌ Error: $TARGET_URL is not accessible"
  exit 1
fi

# Create benchmark directory
mkdir -p "$BENCHMARK_DIR/captures"
mkdir -p "$BENCHMARK_DIR/reports"

# Save benchmark metadata
cat > "$BENCHMARK_DIR/metadata.json" << METADATA
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "target_url": "$TARGET_URL",
  "capture_duration_seconds": $CAPTURE_DURATION,
  "git_commit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "git_branch": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')",
  "bdg_version": "$(node dist/index.js --version 2>&1 || echo 'unknown')"
}
METADATA

echo "✓ Metadata saved"
echo ""

# Build if needed
if [ ! -f "dist/index.js" ]; then
  echo "Building bdg..."
  npm run build > /dev/null 2>&1
  echo "✓ Build complete"
  echo ""
fi

# Function to run a capture
run_capture() {
  local name=$1
  local flags=$2
  local desc=$3
  
  echo "Running: $desc"
  echo "  Flags: $flags"
  
  timeout ${CAPTURE_DURATION}s node dist/index.js "$TARGET_URL" $flags \
    2>"$BENCHMARK_DIR/captures/${name}.stderr.log" \
    >"$BENCHMARK_DIR/captures/${name}.json" || true
  
  local size=$(du -h "$BENCHMARK_DIR/captures/${name}.json" | cut -f1)
  echo "  Output: $size"
  echo ""
}

# Run all capture scenarios
echo "Starting captures..."
echo ""

run_capture "01-dom-only" "--dom" "DOM only"
run_capture "02-network-only" "--network" "Network only"
run_capture "03-console-only" "--console" "Console only"
run_capture "04-dom-network" "--dom --network" "DOM + Network"
run_capture "05-all-collectors" "--dom --network --console" "All collectors"
run_capture "06-all-compact" "--dom --network --console --compact" "All collectors (compact)"

echo "✓ All captures complete"
echo ""

# Generate analysis report
echo "Generating analysis report..."

cat > "$BENCHMARK_DIR/reports/analysis.sh" << 'ANALYSIS'
#!/bin/bash

BENCHMARK_DIR="$1"

echo "═══════════════════════════════════════════════════════════"
echo "          BENCHMARK ANALYSIS"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Benchmark: $(basename $BENCHMARK_DIR)"
echo "Timestamp: $(jq -r '.timestamp' $BENCHMARK_DIR/metadata.json)"
echo "Target: $(jq -r '.target_url' $BENCHMARK_DIR/metadata.json)"
echo "Git Commit: $(jq -r '.git_commit' $BENCHMARK_DIR/metadata.json | cut -c1-8)"
echo ""

analyze_capture() {
  local file=$1
  local name=$2
  
  if [ ! -f "$file" ]; then
    echo "  ❌ File not found: $file"
    return
  fi
  
  local size=$(du -h "$file" | cut -f1)
  local size_bytes=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
  local duration=$(jq -r '.duration // 0' "$file")
  local success=$(jq -r '.success' "$file")
  
  echo "───────────────────────────────────────────────────────────"
  echo "  $name"
  echo "───────────────────────────────────────────────────────────"
  echo "  File Size: $size ($size_bytes bytes)"
  echo "  Duration: ${duration}ms"
  echo "  Success: $success"
  
  # DOM stats
  if jq -e '.data.dom' "$file" > /dev/null 2>&1; then
    local dom_size=$(jq -r '.data.dom.outerHTML' "$file" | wc -c)
    echo "  DOM: $(numfmt --to=iec $dom_size 2>/dev/null || echo $dom_size bytes)"
  fi
  
  # Network stats
  if jq -e '.data.network' "$file" > /dev/null 2>&1; then
    local total_requests=$(jq '.data.network | length' "$file")
    local fetched_bodies=$(jq '[.data.network[] | select(.responseBody != null)] | length' "$file")
    local skipped_bodies=$(( total_requests - fetched_bodies ))
    local fetch_rate=$(echo "scale=1; $fetched_bodies * 100 / $total_requests" | bc 2>/dev/null || echo "N/A")
    
    echo "  Network:"
    echo "    - Total requests: $total_requests"
    echo "    - Fetched bodies: $fetched_bodies"
    echo "    - Skipped bodies: $skipped_bodies"
    echo "    - Fetch rate: ${fetch_rate}%"
    
    # Top 3 largest
    echo "    - Top 3 largest responses:"
    jq -r '[.data.network[] | select(.responseBody != null) | {url: .url, size: (.responseBody | length)}] | sort_by(.size) | reverse | .[:3] | .[] | "      \((.size / 1024 / 1024 * 100 | floor) / 100)MB - \(.url | split("/") | .[-1] | .[0:50])"' "$file"
  fi
  
  # Console stats
  if jq -e '.data.console' "$file" > /dev/null 2>&1; then
    local total_logs=$(jq '.data.console | length' "$file")
    echo "  Console: $total_logs messages"
    
    if [ "$total_logs" -gt 0 ]; then
      echo "    - By type:"
      jq -r '[.data.console[] | .type] | group_by(.) | map({type: .[0], count: length}) | sort_by(.count) | reverse | .[:5] | .[] | "      \(.type): \(.count)"' "$file"
    fi
  fi
  
  echo ""
}

cd "$(dirname $BENCHMARK_DIR)"

analyze_capture "$BENCHMARK_DIR/captures/01-dom-only.json" "1. DOM Only"
analyze_capture "$BENCHMARK_DIR/captures/02-network-only.json" "2. Network Only"
analyze_capture "$BENCHMARK_DIR/captures/03-console-only.json" "3. Console Only"
analyze_capture "$BENCHMARK_DIR/captures/04-dom-network.json" "4. DOM + Network"
analyze_capture "$BENCHMARK_DIR/captures/05-all-collectors.json" "5. All Collectors"
analyze_capture "$BENCHMARK_DIR/captures/06-all-compact.json" "6. All Collectors (compact)"

echo "═══════════════════════════════════════════════════════════"
echo "          SIZE COMPARISON"
echo "═══════════════════════════════════════════════════════════"
echo ""

for f in $BENCHMARK_DIR/captures/*.json; do
  local name=$(basename $f .json)
  local size=$(du -h "$f" | cut -f1)
  local size_bytes=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null)
  printf "  %-25s %10s  (%'d bytes)\n" "$name" "$size" "$size_bytes"
done

echo ""
echo "═══════════════════════════════════════════════════════════"

ANALYSIS

chmod +x "$BENCHMARK_DIR/reports/analysis.sh"

# Run the analysis
bash "$BENCHMARK_DIR/reports/analysis.sh" "$BENCHMARK_DIR" | tee "$BENCHMARK_DIR/reports/analysis.txt"

echo ""
echo "✓ Benchmark complete!"
echo ""
echo "Results saved to: $BENCHMARK_DIR"
echo ""
echo "To compare with previous benchmarks:"
echo "  ./scripts/compare-benchmarks.sh $BENCHMARK_DIR benchmarks/YYYYMMDD-HHMMSS"
echo ""

