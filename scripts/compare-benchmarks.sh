#!/bin/bash

# Compare two benchmark runs to show improvements/regressions

if [ $# -lt 2 ]; then
  echo "Usage: $0 <benchmark1> <benchmark2>"
  echo ""
  echo "Example:"
  echo "  $0 benchmarks/20251103-082000 benchmarks/20251103-091500"
  echo ""
  echo "Available benchmarks:"
  ls -1d benchmarks/*/ 2>/dev/null | sed 's|^|  |' || echo "  (none yet)"
  exit 1
fi

BENCH1="$1"
BENCH2="$2"

if [ ! -d "$BENCH1" ]; then
  echo "❌ Benchmark not found: $BENCH1"
  exit 1
fi

if [ ! -d "$BENCH2" ]; then
  echo "❌ Benchmark not found: $BENCH2"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "          BENCHMARK COMPARISON"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Baseline: $(basename $BENCH1)"
echo "  Timestamp: $(jq -r '.timestamp' $BENCH1/metadata.json)"
echo "  Commit: $(jq -r '.git_commit' $BENCH1/metadata.json | cut -c1-8)"
echo ""
echo "Current:  $(basename $BENCH2)"
echo "  Timestamp: $(jq -r '.timestamp' $BENCH2/metadata.json)"
echo "  Commit: $(jq -r '.git_commit' $BENCH2/metadata.json | cut -c1-8)"
echo ""

compare_sizes() {
  local file1="$BENCH1/captures/$1"
  local file2="$BENCH2/captures/$1"
  local name="$2"
  
  if [ ! -f "$file1" ] || [ ! -f "$file2" ]; then
    echo "  $name: ⚠️  Missing in one benchmark"
    return
  fi
  
  local size1=$(stat -f%z "$file1" 2>/dev/null || stat -c%s "$file1" 2>/dev/null)
  local size2=$(stat -f%z "$file2" 2>/dev/null || stat -c%s "$file2" 2>/dev/null)
  
  local diff=$(( size2 - size1 ))
  local pct=$(echo "scale=1; ($diff * 100.0 / $size1)" | bc 2>/dev/null || echo "0")
  
  local size1_h=$(numfmt --to=iec $size1 2>/dev/null || echo "${size1}B")
  local size2_h=$(numfmt --to=iec $size2 2>/dev/null || echo "${size2}B")
  
  local indicator="→"
  if (( $(echo "$pct < -5" | bc -l 2>/dev/null || echo 0) )); then
    indicator="✅" # Significant decrease (good)
  elif (( $(echo "$pct > 5" | bc -l 2>/dev/null || echo 0) )); then
    indicator="⚠️ " # Significant increase (bad)
  fi
  
  printf "  %-30s %10s → %10s  %+7.1f%%  %s\n" "$name" "$size1_h" "$size2_h" "$pct" "$indicator"
}

echo "───────────────────────────────────────────────────────────"
echo "  File Size Changes"
echo "───────────────────────────────────────────────────────────"
echo ""

compare_sizes "01-dom-only.json" "DOM only"
compare_sizes "02-network-only.json" "Network only"
compare_sizes "03-console-only.json" "Console only"
compare_sizes "04-dom-network.json" "DOM + Network"
compare_sizes "05-all-collectors.json" "All collectors"
compare_sizes "06-all-compact.json" "All collectors (compact)"

echo ""
echo "Legend:"
echo "  ✅ = Improvement (>5% reduction)"
echo "  ⚠️  = Regression (>5% increase)"
echo "  → = No significant change (±5%)"
echo ""

# Compare network stats
echo "───────────────────────────────────────────────────────────"
echo "  Network Collector Stats"
echo "───────────────────────────────────────────────────────────"
echo ""

compare_network_stats() {
  local file1="$BENCH1/captures/02-network-only.json"
  local file2="$BENCH2/captures/02-network-only.json"
  
  if [ ! -f "$file1" ] || [ ! -f "$file2" ]; then
    echo "  ⚠️  Network captures missing"
    return
  fi
  
  local reqs1=$(jq '.data.network | length' "$file1")
  local reqs2=$(jq '.data.network | length' "$file2")
  
  local fetched1=$(jq '[.data.network[] | select(.responseBody != null)] | length' "$file1")
  local fetched2=$(jq '[.data.network[] | select(.responseBody != null)] | length' "$file2")
  
  local rate1=$(echo "scale=1; $fetched1 * 100 / $reqs1" | bc 2>/dev/null || echo "0")
  local rate2=$(echo "scale=1; $fetched2 * 100 / $reqs2" | bc 2>/dev/null || echo "0")
  
  echo "  Total requests:    $reqs1 → $reqs2"
  echo "  Fetched bodies:    $fetched1 → $fetched2"
  echo "  Fetch rate:        ${rate1}% → ${rate2}%"
  
  if (( $(echo "$rate2 < $rate1" | bc -l 2>/dev/null || echo 0) )); then
    echo "  ✅ Fetch rate decreased (auto-skip improved)"
  elif (( $(echo "$rate2 > $rate1" | bc -l 2>/dev/null || echo 0) )); then
    echo "  ⚠️  Fetch rate increased"
  fi
}

compare_network_stats

echo ""

# Compare console stats
echo "───────────────────────────────────────────────────────────"
echo "  Console Collector Stats"
echo "───────────────────────────────────────────────────────────"
echo ""

compare_console_stats() {
  local file1="$BENCH1/captures/03-console-only.json"
  local file2="$BENCH2/captures/03-console-only.json"
  
  if [ ! -f "$file1" ] || [ ! -f "$file2" ]; then
    echo "  ⚠️  Console captures missing"
    return
  fi
  
  local msgs1=$(jq '.data.console | length' "$file1")
  local msgs2=$(jq '.data.console | length' "$file2")
  
  local groups1=$(jq '[.data.console[] | select(.type == "startGroupCollapsed" or .type == "endGroup")] | length' "$file1")
  local groups2=$(jq '[.data.console[] | select(.type == "startGroupCollapsed" or .type == "endGroup")] | length' "$file2")
  
  local group_pct1=$(echo "scale=1; $groups1 * 100 / $msgs1" | bc 2>/dev/null || echo "0")
  local group_pct2=$(echo "scale=1; $groups2 * 100 / $msgs2" | bc 2>/dev/null || echo "0")
  
  echo "  Total messages:    $msgs1 → $msgs2"
  echo "  Group messages:    $groups1 → $groups2 (${group_pct1}% → ${group_pct2}%)"
  
  if (( groups2 < groups1 )); then
    echo "  ✅ Group messages reduced (filtering improved)"
  elif (( groups2 > groups1 )); then
    echo "  ⚠️  Group messages increased"
  fi
}

compare_console_stats

echo ""
echo "═══════════════════════════════════════════════════════════"

