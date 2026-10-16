/**
 * node:test reporter that records how long each test file ran, in seconds, as
 * one JSON object keyed by file name: the file's own duration when the runner
 * reports it, else the sum of its top-level tests. `scripts/smoke-selected.sh`
 * uses it when `SMOKE_TIMINGS` is set; `scripts/smoke-shard.mjs --update`
 * merges the output into `scripts/smoke-timings.json`.
 */
import { basename } from 'node:path';

/**
 * Yields the per-file seconds once the run ends.
 *
 * @param source - Test runner events
 */
export default async function* fileTimings(source) {
  /** @type {Map<string, { own: number, tests: number }>} */
  const byFile = new Map();
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const { name, nesting, file, details } = event.data ?? {};
    if (!file || nesting !== 0 || typeof details?.duration_ms !== 'number') continue;
    const key = basename(file);
    const entry = byFile.get(key) ?? { own: 0, tests: 0 };
    if (name === file) entry.own = details.duration_ms;
    else entry.tests += details.duration_ms;
    byFile.set(key, entry);
  }
  const seconds = Object.fromEntries(
    [...byFile].map(([f, t]) => [f, Math.round(Math.max(t.own, t.tests) / 100) / 10])
  );
  yield `${JSON.stringify(seconds, null, 2)}\n`;
}
