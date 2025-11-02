# bdg Performance Benchmark Baseline

**Generated:** 2025-11-02T21:11:19.159Z

**Node Version:** v20.19.5

**Commit:** 6748407ef3e6974be1c47cfe41d2ac004688c614

**Collection Timeout:** 6s

## Scenarios

### all-collectors

**Description:** All collectors (DOM + Network + Console)

**Active Collectors:** dom, network, console

| Metric | Value |
|--------|-------|
| Total Duration | 6260ms |
| Collector Init | 5.00ms |
| Preview JSON Stringify | 0.00ms |
| Full JSON Stringify | 0.00ms |
| Preview Write Time | 2.00ms |
| Full Write Time | 1.00ms |
| Preview File Size | 0 B |
| Full File Size | 0 B |
| Final File Size | 1.53 KB |
| Heap Used | 0.00 MB |
| RSS | 0.00 MB |

### network-only

**Description:** Network collector only

**Active Collectors:** network

| Metric | Value |
|--------|-------|
| Total Duration | 6207ms |
| Collector Init | 1.00ms |
| Preview JSON Stringify | 0.00ms |
| Full JSON Stringify | 0.00ms |
| Preview Write Time | 2.00ms |
| Full Write Time | 2.00ms |
| Preview File Size | 0 B |
| Full File Size | 0 B |
| Final File Size | 241 B |
| Heap Used | 0.00 MB |
| RSS | 0.00 MB |

### dom-only

**Description:** DOM collector only

**Active Collectors:** dom

| Metric | Value |
|--------|-------|
| Total Duration | 6205ms |
| Collector Init | 3.00ms |
| Preview JSON Stringify | 0.00ms |
| Full JSON Stringify | 0.00ms |
| Preview Write Time | 1.00ms |
| Full Write Time | 1.00ms |
| Preview File Size | 0 B |
| Full File Size | 0 B |
| Final File Size | 1.49 KB |
| Heap Used | 0.00 MB |
| RSS | 0.00 MB |

### console-only

**Description:** Console collector only

**Active Collectors:** console

| Metric | Value |
|--------|-------|
| Total Duration | 6189ms |
| Collector Init | 2.00ms |
| Preview JSON Stringify | 0.00ms |
| Full JSON Stringify | 0.00ms |
| Preview Write Time | 1.00ms |
| Full Write Time | 0.00ms |
| Preview File Size | 0 B |
| Full File Size | 0 B |
| Final File Size | 241 B |
| Heap Used | 0.00 MB |
| RSS | 0.00 MB |

### network-console

**Description:** Network + Console (skip DOM)

**Active Collectors:** network, console

| Metric | Value |
|--------|-------|
| Total Duration | 6195ms |
| Collector Init | 2.00ms |
| Preview JSON Stringify | 0.00ms |
| Full JSON Stringify | 0.00ms |
| Preview Write Time | 1.00ms |
| Full Write Time | 1.00ms |
| Preview File Size | 0 B |
| Full File Size | 0 B |
| Final File Size | 260 B |
| Heap Used | 0.00 MB |
| RSS | 0.00 MB |

## Comparison

| Scenario | Duration | Preview Size | Full Size | Final Size | Collectors |
|----------|----------|--------------|-----------|------------|------------|
| all-collectors | 6260ms | 0 B | 0 B | 1.53 KB | dom, network, console |
| network-only | 6207ms | 0 B | 0 B | 241 B | network |
| dom-only | 6205ms | 0 B | 0 B | 1.49 KB | dom |
| console-only | 6189ms | 0 B | 0 B | 241 B | console |
| network-console | 6195ms | 0 B | 0 B | 260 B | network, console |

## Notes

- All scenarios run for 6 seconds against the benchmark test server
- Preview and Full files written every 5 seconds during collection
- Final file written on session stop
- File sizes and timing may vary based on network activity and page complexity
- Preview and full file size columns reflect on-disk artifacts after cleanup (0 B because bdg removes them). Use the “PERF” size rows above for the serialized payload sizes captured during the run.
