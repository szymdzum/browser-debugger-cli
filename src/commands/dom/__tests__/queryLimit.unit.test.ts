/**
 * Which `dom query` matches are listed, and what the output says about the rest.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { listedMatches } from '@/commands/dom/query.js';
import { cachedIndexOutOfRangeError } from '@/errors/messages.js';

const described = Array.from({ length: 1000 }, (_, index) => ({ index, nodeId: index, tag: 'li' }));

void describe('listedMatches', () => {
  void it('lists the first `limit`, counting the rest and how many can be used by index', () => {
    const listed = listedMatches({ selector: 'li', count: 50003, nodes: described }, 50);
    assert.equal(listed.nodes.length, 50);
    assert.equal(listed.count, 50003);
    assert.equal(listed.omitted, 49953);
    assert.equal(listed.indexed, 1000);
  });

  void it('lists all with 0, and adds nothing when every match is listed and indexed', () => {
    const all = listedMatches({ selector: 'li', count: 60, nodes: described.slice(0, 60) }, 0);
    assert.equal(all.nodes.length, 60);
    assert.equal(all.omitted, undefined);
    assert.equal(all.indexed, undefined);
  });

  void it('says an index past the indexed matches can be indexed with a higher limit', () => {
    const source = { index: 1500, command: 'dom query' as const, query: 'li' };
    const err = cachedIndexOutOfRangeError(source, 1000, 50003);
    assert.match(err.message, /Index 1500 is past the 1000 matches of .+ \(50003 in all\)/);
    assert.match(err.suggestion, /--limit 1501 \(or --limit 0\)/);
    assert.match(cachedIndexOutOfRangeError(source, 1000, 1000).message, /out of range/);
  });
});
