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
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const REPO_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const execFileAsync = promisify(execFile);
const GH_TIMEOUT_MS = 60_000;
const DEFAULT_RUNS = 20;
const CHILD_EXIT_WAIT_MS = 2000;
/** @type {Set<import('node:child_process').ChildProcess>} */
const running = new Set();
let stopping = false;

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
 * Relative change of the newer median against the older one.
 *
 * @param {number[]} recent - Seconds in the newer half
 * @param {number[]} past - Seconds in the older half
 * @returns {number | undefined} Undefined when either half has no timing or the older median is 0
 */
function trend(recent, past) {
  if (!recent.length || !past.length) return undefined;
  const base = median(past);
  return base ? (median(recent) - base) / base : undefined;
}

/**
 * Tells "the run has no timings artifact" (expired, never uploaded) from a failure.
 *
 * @param {string} message - Error text of `gh run download`
 * @returns {boolean}
 */
export function isMissingArtifact(message) {
  return /no (valid )?artifacts? (found|match)|no artifact/i.test(message);
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
    const min = Math.min(...all);
    const max = Math.max(...all);
    return {
      file,
      runs: all.length,
      median: median(all),
      min,
      max,
      spread: max - min,
      trend: trend(recent, past),
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
 * Runs `gh` in the repository checkout (so gh resolves the repo) with a timeout.
 *
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function gh(args) {
  if (stopping) throw new Error('interrupted');
  const call = execFileAsync('gh', args, {
    cwd: REPO_DIR,
    encoding: 'utf8',
    timeout: GH_TIMEOUT_MS,
  });
  running.add(call.child);
  try {
    const { stdout } = await call;
    return stdout;
  } finally {
    running.delete(call.child);
  }
}

/**
 * First line of an error's message, for one-line reporting.
 *
 * @param {unknown} error
 * @returns {string}
 */
function reason(error) {
  const text = error instanceof Error ? error.stderr || error.message : String(error);
  return String(text).trim().split('\n')[0];
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
 * Kills the running `gh` children and waits (bounded) for them to exit, so
 * none is still writing into the temp directory.
 *
 * @returns {Promise<void>}
 */
async function stopChildren() {
  const exits = [...running].map(
    (child) =>
      new Promise((resolve) => (child.exitCode === null ? child.once('exit', resolve) : resolve()))
  );
  for (const child of running) child.kill('SIGTERM');
  await Promise.race([
    Promise.all(exits),
    new Promise((resolve) => setTimeout(resolve, CHILD_EXIT_WAIT_MS)),
  ]);
}

/**
 * Removes the temp directory on SIGINT/SIGTERM and exits 130/143.
 *
 * @param {string} dir
 */
function cleanOnSignal(dir) {
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    process.once(signal, async () => {
      stopping = true;
      await stopChildren();
      rmSync(dir, { recursive: true, force: true });
      process.exit(code);
    });
  }
}

/**
 * Downloads and merges the timings of the last N successful CI runs on main.
 *
 * @param {number} count
 * @returns {Promise<{ runs: Record<string, number>[], missing: number, failed: number, firstFailure: string | undefined }>} Runs newest first
 */
async function collectRuns(count) {
  const ids = JSON.parse(
    await gh([
      'run',
      'list',
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
  cleanOnSignal(tmp);
  const result = { runs: [], missing: 0, failed: 0, firstFailure: undefined };
  try {
    for (const id of ids) {
      try {
        const dir = join(tmp, String(id));
        await gh(['run', 'download', String(id), '--pattern', 'smoke-timings-*', '--dir', dir]);
        const shards = readShards(dir);
        if (shards.length) result.runs.push(mergeShards(shards));
        else result.missing++;
      } catch (error) {
        if (isMissingArtifact(reason(error))) {
          result.missing++;
          continue;
        }
        result.failed++;
        result.firstFailure ??= `run ${id}: ${reason(error)}`;
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return result;
}

/**
 * CLI entry.
 *
 * @param {string[]} argv
 * @returns {Promise<number>} Exit code
 */
async function main(argv) {
  const at = argv.indexOf('--runs');
  const count = at === -1 ? DEFAULT_RUNS : Number(argv[at + 1]);
  if (argv.length !== (at === -1 ? 0 : 2) || !Number.isInteger(count) || count < 1) {
    console.error('Usage: node scripts/smoke-timings-trend.mjs [--runs N]');
    return 1;
  }
  try {
    const { runs, missing, failed, firstFailure } = await collectRuns(count);
    const total = runs.length + missing + failed;
    console.log(
      `${runs.length} of ${total} CI runs on main had timings (${missing} without a smoke-timings artifact, ${failed} failed to download).\n`
    );
    if (firstFailure) console.error(`smoke-timings-trend: ${firstFailure}`);
    if (runs.length) console.log(formatTable(fileStats(runs)));
    return 0;
  } catch (error) {
    console.error(`smoke-timings-trend: ${reason(error)}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2));
