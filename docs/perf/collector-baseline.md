# bdg Performance Benchmark Baseline

**Generated:** 2025-11-02T20:32:39.857Z

**Node Version:** v20.19.5

## Scenarios

### all-collectors

**Description:** All collectors (DOM + Network + Console)

**Active Collectors:** 

| Metric | Value |
|--------|-------|
| Total Duration | 3688ms |
| Collector Init | 0.00ms |
| Preview JSON Stringify | 0.00ms |
| Full JSON Stringify | 0.00ms |
| Preview Write Time | 0.00ms |
| Full Write Time | 0.00ms |
| Preview File Size | 0 B |
| Full File Size | 0 B |
| Final File Size | 1.53 KB |
| Heap Used | 0.00 MB |
| RSS | 0.00 MB |

### network-only

**Description:** Network collector only

**Active Collectors:** 

| Metric | Value |
|--------|-------|
| Total Duration | 3211ms |
| Collector Init | 0.00ms |
| Preview JSON Stringify | 0.00ms |
| Full JSON Stringify | 0.00ms |
| Preview Write Time | 0.00ms |
| Full Write Time | 0.00ms |
| Preview File Size | 0 B |
| Full File Size | 0 B |
| Final File Size | 1011.46 KB |
| Heap Used | 0.00 MB |
| RSS | 0.00 MB |

### dom-only

**Description:** DOM collector only

**Active Collectors:** 

| Metric | Value |
|--------|-------|
| Total Duration | 3217ms |
| Collector Init | 0.00ms |
| Preview JSON Stringify | 0.00ms |
| Full JSON Stringify | 0.00ms |
| Preview Write Time | 0.00ms |
| Full Write Time | 0.00ms |
| Preview File Size | 0 B |
| Full File Size | 0 B |
| Final File Size | 1.49 KB |
| Heap Used | 0.00 MB |
| RSS | 0.00 MB |

### console-only

**Description:** Console collector only

**Active Collectors:** 

| Metric | Value |
|--------|-------|
| Total Duration | 3255ms |
| Collector Init | 0.00ms |
| Preview JSON Stringify | 0.00ms |
| Full JSON Stringify | 0.00ms |
| Preview Write Time | 0.00ms |
| Full Write Time | 0.00ms |
| Preview File Size | 0 B |
| Full File Size | 0 B |
| Final File Size | 1.82 KB |
| Heap Used | 0.00 MB |
| RSS | 0.00 MB |

### network-console

**Description:** Network + Console (skip DOM)

**Active Collectors:** 

| Metric | Value |
|--------|-------|
| Total Duration | 3231ms |
| Collector Init | 0.00ms |
| Preview JSON Stringify | 0.00ms |
| Full JSON Stringify | 0.00ms |
| Preview Write Time | 0.00ms |
| Full Write Time | 0.00ms |
| Preview File Size | 0 B |
| Full File Size | 0 B |
| Final File Size | 1012.18 KB |
| Heap Used | 0.00 MB |
| RSS | 0.00 MB |

## Comparison

| Scenario | Duration | Preview Size | Full Size | Final Size | Collectors |
|----------|----------|--------------|-----------|------------|------------|
| all-collectors | 3688ms | 0 B | 0 B | 1.53 KB |  |
| network-only | 3211ms | 0 B | 0 B | 1011.46 KB |  |
| dom-only | 3217ms | 0 B | 0 B | 1.49 KB |  |
| console-only | 3255ms | 0 B | 0 B | 1.82 KB |  |
| network-console | 3231ms | 0 B | 0 B | 1012.18 KB |  |

## Notes

- All scenarios run for 3 seconds against the benchmark test server
- Preview and Full files written every 5 seconds during collection
- Final file written on session stop
- File sizes and timing may vary based on network activity and page complexity
