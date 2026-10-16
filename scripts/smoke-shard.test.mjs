import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assignShards, parseShard } from './smoke-shard.mjs';

test('assignShards puts the longest files on different shards', () => {
  const shards = assignShards(['a', 'b', 'c', 'd'], { a: 60, b: 50, c: 10, d: 10 }, 2);
  assert.deepEqual(shards, [
    ['a', 'd'],
    ['b', 'c'],
  ]);
});

test('assignShards counts the reserved seconds against shard 1', () => {
  const shards = assignShards(['a', 'b'], { a: 30, b: 20 }, 2, 100);
  assert.deepEqual(shards, [[], ['a', 'b']]);
});

test('assignShards weighs a file with no timing as the median', () => {
  const shards = assignShards(['a', 'b', 'c', 'new'], { a: 10, b: 20, c: 30 }, 2);
  assert.deepEqual(shards, [
    ['a', 'c'],
    ['b', 'new'],
  ]);
});

test('assignShards places every file exactly once', () => {
  const files = Array.from({ length: 23 }, (_, i) => `f${i}`);
  const seconds = Object.fromEntries(files.map((f, i) => [f, (i * 7) % 13]));
  const shards = assignShards(files, seconds, 4);
  assert.deepEqual(shards.flat().sort(), [...files].sort());
});

test('parseShard accepts i/n with 1 <= i <= n only', () => {
  assert.deepEqual(parseShard('2/4'), { index: 2, count: 4 });
  assert.equal(parseShard('0/4'), undefined);
  assert.equal(parseShard('5/4'), undefined);
  assert.equal(parseShard('2'), undefined);
  assert.equal(parseShard(undefined), undefined);
});
