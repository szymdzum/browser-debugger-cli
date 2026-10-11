/**
 * The query cache file (#610): a write replaces the whole file at once, so a
 * command reading it while another one writes sees the old list or the new
 * one, never "no cache"; the file is private and a symlink in its place is
 * replaced, not followed.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { QueryCacheManager } from '@/session/QueryCacheManager.js';
import type { DomQueryResult } from '@/types.js';

const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-qcache-'));
const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-qcache-out-'));
const savedSessionDir = process.env['BDG_SESSION_DIR'];
const cachePath = path.join(sessionDir, 'query-cache.json');

before(() => {
  process.env['BDG_SESSION_DIR'] = sessionDir;
});
after(() => {
  if (savedSessionDir === undefined) delete process.env['BDG_SESSION_DIR'];
  else process.env['BDG_SESSION_DIR'] = savedSessionDir;
  fs.rmSync(sessionDir, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

/** Rounds of parallel writes and reads; old non-atomic writes tore a read in the first rounds */
const ROUNDS = 40;

/** Writers and readers per round */
const WRITERS = 4;
const READERS = 8;

/**
 * A query result big enough that writing it takes several chunks (2 MB).
 *
 * @param selector - Selector recorded with it
 * @returns Query result of 1000 nodes
 */
function bigResult(selector: string): DomQueryResult {
  const nodes = Array.from({ length: 1000 }, (_, index) => ({
    index,
    nodeId: index + 1,
    tag: 'div',
    classes: ['card', 'item', `n${index}`],
    preview: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit '.repeat(40),
  }));
  return { selector, count: nodes.length, nodes };
}

void describe('QueryCacheManager writes', () => {
  void it('never lets a parallel reader see "no cache" while a valid cache exists', async () => {
    const cache = new QueryCacheManager();
    await cache.set(bigResult('seed'), 'doc');
    const misses: string[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const writes = Array.from({ length: WRITERS }, (_, w) =>
        cache.set(bigResult(`w${round}-${w}`), 'doc')
      );
      const reads = Array.from({ length: READERS }, () => cache.validate());
      const [, validations] = await Promise.all([Promise.all(writes), Promise.all(reads)]);
      for (const validation of validations) {
        if (!validation.valid) misses.push(`round ${round}: ${validation.error ?? 'invalid'}`);
      }
    }
    assert.deepEqual(misses, [], 'every read saw a whole cache');
  });

  void it('leaves no temporary files behind', async () => {
    const cache = new QueryCacheManager();
    await Promise.all(Array.from({ length: 5 }, (_, i) => cache.set(bigResult(`t${i}`))));
    assert.deepEqual(
      fs.readdirSync(sessionDir).filter((name) => name !== 'query-cache.json'),
      []
    );
  });

  void it('keeps the cache private to the user', async () => {
    await new QueryCacheManager().set(bigResult('mode'));
    assert.equal(fs.statSync(cachePath).mode & 0o077, 0);
  });

  void it('replaces a symlink in place of the cache instead of writing through it', async () => {
    const target = path.join(outsideDir, 'target.json');
    fs.writeFileSync(target, 'untouched');
    fs.rmSync(cachePath, { force: true });
    fs.symlinkSync(target, cachePath);

    await new QueryCacheManager().set(bigResult('link'));

    assert.equal(fs.readFileSync(target, 'utf-8'), 'untouched');
    assert.equal(fs.lstatSync(cachePath).isSymbolicLink(), false);
  });
});
