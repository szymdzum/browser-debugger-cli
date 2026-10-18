/**
 * Prints how the run time of every smoke test file varies across recent CI
 * runs, as a Markdown table that can be pasted into a GitHub comment. Not a
 * CI gate.
 *
 * Usage: `node scripts/smoke-timings-trend.mjs [--runs N]` (default 20).
 *
 * Reads: the `smoke-timings-*` artifacts (one JSON object per shard, file name
 * to seconds, written by `scripts/smoke-timings-reporter.mjs`, kept 30 days)
 * of the last N successful `CI` push runs on `main`, through `gh`. The shards
 * of one run are merged into one number per file. Only the Linux Node 22
 * shards upload timings, so the table is Linux only. A run whose artifacts
 * expired or are missing is skipped and counted in the header line.
 *
 * Columns, one row per file, widest spread first:
 * - runs: runs in which the file was timed
 * - median, min, max: seconds across those runs
 * - spread: max - min. A wide spread (8 s one run, 40 s the next) usually
 *   means a wait that sometimes runs into its timeout: a flake candidate.
 *   Max - min is used rather than p90 because a flake shows up as a rare
 *   outlier, which p90 of 20 runs would hide.
 * - trend: median of the newer half of the runs against the older half (the
 *   middle run of an odd count is left out), e.g. `-42%` after a change such
 *   as sharing one session per file (#809). `-` when fewer than 2 runs.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'szymdzum/browser-debugger-cli';
const GH_TIMEOUT_MS = 60_000;
const DEFAULT_RUNS = 20;

/**
 * Median of a non-empty list of numbers.
 *
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Merges the shard files of one run into one seconds map.
 *
 * @param {Record<string, number>[]} shards
 * @returns {Record<string, number>}
 */
export function mergeShards(shards) {
  return Object.assign({}, ...shards);
}

/**
 * Per-file statistics over runs, sorted by spread, widest first.
 *
 * @param {Record<string, number>[]} runs - One merged seconds map per run, newest first
 * @returns {{ file: string, runs: number, median: number, min: number, max: number, spread: number, trend: number | undefined }[]}
 */
export function fileStats(runs) {
  const half = runs.length >> 1;
  const newer = runs.slice(0, half);
  const older = runs.slice(runs.length - half);
  const files = new Set(runs.flatMap((run) => Object.keys(run)));
  const secondsIn = (set, file) => set.flatMap((run) => (file in run ? [run[file]] : []));
  const rows = [...files].map((file) => {
    const all = secondsIn(runs, file);
    const [recent, past] = [secondsIn(newer, file), secondsIn(older, file)];
    const base = past.length && median(past);
    const min = Math.min(...all);
    const max = Math.max(...all);
    return {
      file,
      runs: all.length,
      median: median(all),
      min,
      max,
      spread: max - min,
      trend: recent.length && base ? (median(recent) - base) / base : undefined,
    };
  });
  return rows.sort((a, b) => b.spread - a.spread || a.file.localeCompare(b.file));
}

/**
 * Formats the statistics as a Markdown table.
 *
 * @param {ReturnType<typeof fileStats>} rows
 * @returns {string}
 */
export function formatTable(rows) {
  const s = (n) => n.toFixed(1);
  const pct = (t) => {
    const rounded = t === undefined ? undefined : Math.round(t * 100);
    return rounded === undefined ? '-' : `${rounded > 0 ? '+' : ''}${rounded}%`;
  };
  return [
    '| file | runs | median s | min s | max s | spread s | trend |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...rows.map(
      (r) =>
        `| ${r.file} | ${r.runs} | ${s(r.median)} | ${s(r.min)} | ${s(r.max)} | ${s(r.spread)} | ${pct(r.trend)} |`
    ),
  ].join('\n');
}

/**
 * Runs `gh` with a timeout.
 *
 * @param {string[]} args
 * @returns {string}
 */
function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    timeout: GH_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Reads every JSON file below a directory.
 *
 * @param {string} dir
 * @returns {Record<string, number>[]}
 */
function readShards(dir) {
  return readdirSync(dir, { recursive: true })
    .map((entry) => join(dir, entry))
    .filter((path) => path.endsWith('.json') && statSync(path).isFile())
    .map((path) => JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Downloads and merges the timings of the last N successful CI runs on main.
 *
 * @param {number} count
 * @returns {{ runs: Record<string, number>[], skipped: number }} Runs newest first
 */
function collectRuns(count) {
  const ids = JSON.parse(
    gh([
      'run',
      'list',
      '--repo',
      REPO,
      '--workflow',
      'CI',
      '--branch',
      'main',
      '--event',
      'push',
      '--status',
      'success',
      '--limit',
      String(count),
      '--json',
      'databaseId',
    ])
  ).map((r) => r.databaseId);
  const tmp = mkdtempSync(join(tmpdir(), 'smoke-trend-'));
  const runs = [];
  try {
    for (const id of ids) {
      const dir = join(tmp, String(id));
      try {
        gh([
          'run',
          'download',
          String(id),
          '--repo',
          REPO,
          '--pattern',
          'smoke-timings-*',
          '--dir',
          dir,
        ]);
        const shards = readShards(dir);
        if (shards.length) runs.push(mergeShards(shards));
      } catch {
        continue;
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { runs, skipped: ids.length - runs.length };
}

/**
 * CLI entry.
 *
 * @param {string[]} argv
 * @returns {number} Exit code
 */
function main(argv) {
  const at = argv.indexOf('--runs');
  const count = at === -1 ? DEFAULT_RUNS : Number(argv[at + 1]);
  if (argv.length !== (at === -1 ? 0 : 2) || !Number.isInteger(count) || count < 1) {
    console.error('Usage: node scripts/smoke-timings-trend.mjs [--runs N]');
    return 1;
  }
  const { runs, skipped } = collectRuns(count);
  console.log(
    `${runs.length} of ${runs.length + skipped} CI runs on main had timings (${skipped} skipped: artifact expired or missing).\n`
  );
  if (runs.length) console.log(formatTable(fileStats(runs)));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
