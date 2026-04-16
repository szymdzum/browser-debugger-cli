/**
 * Unit tests for `--user-data-dir` extraction from merged chrome flags.
 *
 * Regression coverage for issue #160: `--user-data-dir` supplied via
 * `BDG_CHROME_FLAGS` or `--chrome-flags` must be promoted to the canonical
 * `userDataDir` field and stripped from the flag list, so Chrome never
 * receives duplicate `--user-data-dir` switches.
 */

import * as assert from 'node:assert';
import * as os from 'node:os';
import { describe, test } from 'node:test';

import { expandHome, extractUserDataDirFromFlags } from '@/commands/start.js';

describe('extractUserDataDirFromFlags', () => {
  test('returns undefined path and untouched flags when no user-data-dir present', () => {
    const result = extractUserDataDirFromFlags(['--ignore-certificate-errors', '--flag=value']);
    assert.strictEqual(result.userDataDir, undefined);
    assert.deepStrictEqual(result.rest, ['--ignore-certificate-errors', '--flag=value']);
  });

  test('extracts --user-data-dir=<path> form', () => {
    const result = extractUserDataDirFromFlags(['--user-data-dir=/tmp/profile', '--other']);
    assert.strictEqual(result.userDataDir, '/tmp/profile');
    assert.deepStrictEqual(result.rest, ['--other']);
  });

  test('extracts --user-data-dir <path> space-separated form', () => {
    const result = extractUserDataDirFromFlags(['--user-data-dir', '/tmp/profile', '--other']);
    assert.strictEqual(result.userDataDir, '/tmp/profile');
    assert.deepStrictEqual(result.rest, ['--other']);
  });

  test('expands leading ~/ in extracted path', () => {
    const result = extractUserDataDirFromFlags(['--user-data-dir=~/my-profile']);
    assert.strictEqual(result.userDataDir, `${os.homedir()}/my-profile`);
    assert.deepStrictEqual(result.rest, []);
  });

  test('last occurrence wins when flag is specified multiple times', () => {
    const result = extractUserDataDirFromFlags([
      '--user-data-dir=/first',
      '--other',
      '--user-data-dir=/second',
    ]);
    assert.strictEqual(result.userDataDir, '/second');
    assert.deepStrictEqual(result.rest, ['--other']);
  });

  test('preserves flag order for non-matching entries', () => {
    const result = extractUserDataDirFromFlags(['--a', '--user-data-dir=/p', '--b', '--c=1']);
    assert.deepStrictEqual(result.rest, ['--a', '--b', '--c=1']);
  });

  test('leaves --user-data-dir as final token unmatched (no path follows)', () => {
    const result = extractUserDataDirFromFlags(['--other', '--user-data-dir']);
    assert.strictEqual(result.userDataDir, undefined);
    assert.deepStrictEqual(result.rest, ['--other', '--user-data-dir']);
  });
});

describe('expandHome', () => {
  test('expands leading ~/', () => {
    assert.strictEqual(expandHome('~/foo'), `${os.homedir()}/foo`);
  });

  test('leaves absolute paths unchanged', () => {
    assert.strictEqual(expandHome('/abs/path'), '/abs/path');
  });

  test('leaves relative paths unchanged', () => {
    assert.strictEqual(expandHome('relative/path'), 'relative/path');
  });

  test('does not expand ~ without trailing slash', () => {
    assert.strictEqual(expandHome('~user'), '~user');
  });
});
