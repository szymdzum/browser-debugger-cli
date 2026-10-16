#!/usr/bin/env node
/**
 * Splits the smoke test files into shards of about equal run time, from the
 * per-file seconds in `scripts/smoke-timings.json` (a file with no timing
 * counts as the median). `scripts/smoke-selected.sh` uses it for `SHARD`.
 *
 *   node scripts/smoke-shard.mjs 2/4 [--integration]
 *     Prints the files of shard 2 of 4, one per line. --integration counts the
 *     integration suite (run after shard 1) as part of shard 1; every shard of
 *     a run must get the same flags, or files land in no shard or in two.
 *   node scripts/smoke-shard.mjs --update <timings.json...>
 *     Replaces the timings with those recorded by
 *     `scripts/smoke-timings-reporter.mjs` (the `smoke-timings-*` artifacts of
 *     a CI run) and drops files that no longer exist.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SMOKE_DIR = 'src/__tests__/smoke';
const TIMINGS_FILE = 'scripts/smoke-timings.json';

/**
 * Median of a list of numbers.
 *
 * @param {number[]} values
 * @returns {number} The median, 0 for an empty list
 */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Assigns files to shards, longest first, each to the shard with the least
 * time so far (ties: the lower shard). Deterministic for the same input.
 *
 * @param {string[]} files - File names
 * @param {Record<string, number>} seconds - Known seconds per file name
 * @param {number} count - Number of shards
 * @param {number} [reserved] - Seconds shard 1 already has (the integration suite)
 * @returns {string[][]} The files of each shard, sorted by name
 */
export function assignShards(files, seconds, count, reserved = 0) {
  const fallback = median(files.filter((f) => f in seconds).map((f) => seconds[f]));
  const weight = (f) => seconds[f] ?? fallback;
  const byWeight = [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  const shards = Array.from({ length: count }, (_, i) => ({
    total: i === 0 ? reserved : 0,
    files: [],
  }));
  for (const file of byWeight) {
    const lightest = shards.reduce((min, s) => (s.total < min.total ? s : min));
    lightest.files.push(file);
    lightest.total += weight(file);
  }
  return shards.map((s) => s.files.sort());
}

/**
 * Parses `i/n` (1-based shard of n).
 *
 * @param {string} spec
 * @returns {{ index: number, count: number } | undefined}
 */
export function parseShard(spec) {
  const match = /^(\d+)\/(\d+)$/.exec(spec ?? '');
  if (!match) return undefined;
  const index = Number(match[1]);
  const count = Number(match[2]);
  return index >= 1 && index <= count ? { index, count } : undefined;
}

/**
 * Smoke test file names in the repository.
 *
 * @returns {string[]}
 */
function smokeFiles() {
  return readdirSync(SMOKE_DIR).filter((f) => f.endsWith('.smoke.test.ts'));
}

/**
 * Merges recorded timings into the timings file, keeping only existing files.
 *
 * @param {string[]} recordings - Paths of reporter outputs
 */
function update(recordings) {
  const timings = JSON.parse(readFileSync(TIMINGS_FILE, 'utf8'));
  const existing = new Set(smokeFiles());
  const merged = { ...timings.files };
  for (const path of recordings) Object.assign(merged, JSON.parse(readFileSync(path, 'utf8')));
  const sorted = Object.fromEntries(
    Object.entries(merged)
      .filter(([f]) => existing.has(f))
      .sort(([a], [b]) => a.localeCompare(b))
  );
  writeFileSync(TIMINGS_FILE, `${JSON.stringify({ ...timings, files: sorted }, null, 2)}\n`);
  console.log(`${Object.keys(sorted).length} files in ${TIMINGS_FILE}`);
}

/**
 * Entry point.
 *
 * @param {string[]} argv
 * @returns {number} Exit code
 */
function main(argv) {
  if (argv[0] === '--update' && argv.length > 1) {
    update(argv.slice(1));
    return 0;
  }
  const shard = parseShard(argv[0]);
  if (!shard) {
    console.error('usage: smoke-shard.mjs <i>/<n> [--integration] | --update <timings.json...>');
    return 2;
  }
  const timings = JSON.parse(readFileSync(TIMINGS_FILE, 'utf8'));
  const reserved = argv.includes('--integration') ? timings.integration : 0;
  const shards = assignShards(smokeFiles(), timings.files, shard.count, reserved);
  for (const file of shards[shard.index - 1]) console.log(join(SMOKE_DIR, file));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
