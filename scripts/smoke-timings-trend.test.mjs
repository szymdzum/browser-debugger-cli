import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fileStats, formatTable, mergeShards } from './smoke-timings-trend.mjs';

test('mergeShards combines the shards of one run', () => {
  assert.deepEqual(mergeShards([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });
});

test('fileStats sorts by spread and reports median, min, max', () => {
  const rows = fileStats([
    { steady: 10, flaky: 8 },
    { steady: 11, flaky: 40 },
    { steady: 10, flaky: 9 },
  ]);
  assert.deepEqual(
    rows.map((r) => r.file),
    ['flaky', 'steady']
  );
  assert.deepEqual(
    {
      runs: rows[0].runs,
      median: rows[0].median,
      min: rows[0].min,
      max: rows[0].max,
      spread: rows[0].spread,
    },
    { runs: 3, median: 9, min: 8, max: 40, spread: 32 }
  );
});

test('fileStats trend compares the newer half with the older half, newest run first', () => {
  const rows = fileStats([{ a: 6 }, { a: 6 }, { a: 99 }, { a: 10 }, { a: 10 }]);
  assert.equal(rows[0].trend, -0.4);
});

test('fileStats counts only the runs that timed a file, and has no trend for a single run', () => {
  const [row] = fileStats([{ a: 5 }]);
  assert.equal(row.runs, 1);
  assert.equal(row.trend, undefined);
  assert.equal(fileStats([{ a: 5 }, { b: 1 }]).find((r) => r.file === 'a').runs, 1);
});

test('formatTable prints a Markdown row with one decimal and a signed trend', () => {
  const table = formatTable(fileStats([{ a: 6 }, { a: 10 }]));
  assert.match(table, /^\| a \| 2 \| 8\.0 \| 6\.0 \| 10\.0 \| 4\.0 \| -40% \|$/m);
});
