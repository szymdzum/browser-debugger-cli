/**
 * The source map reader (#848, part 2): the size limits (declared and
 * streamed), the timeout, what a failed read leaves behind, the cache budget
 * and its eviction, a `clear()` during a read, the key of an inline map, and
 * a lookup that does not wait for maps that never answer.
 */

import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import {
  mapKey,
  readLimitedText,
  SourceMapReader,
  type ScriptWithMap,
} from '@/daemon/session/logpointSourceMaps.js';

/**
 * A map as an inline script.
 *
 * @param name - Script name
 * @param sources - `sources` of the map
 * @param mappings - `mappings` of the map
 * @returns Script with an inline map
 */
function inlineScript(name: string, sources: string[], mappings = 'AAAA'): ScriptWithMap {
  const json = JSON.stringify({ version: 3, sources, mappings, names: [] });
  return {
    url: `http://h/${name}.js`,
    sourceMapURL: `data:application/json;base64,${Buffer.from(json).toString('base64')}`,
  };
}

const ANY_FILE = /(^|\/)src\/cart\.ts$/;

void describe('readLimitedText', () => {
  void it('gives up on a stream past the limit without reading it all', async () => {
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    await assert.rejects(readLimitedText(new Response(stream), 3 * 1024 * 1024), /over 3 MB/);
    assert.equal(cancelled, true);
    assert.ok(pulled <= 6, `pulled ${pulled} chunks`);
  });

  void it('refuses a declared length past the limit', async () => {
    const response = new Response('x', { headers: { 'content-length': '5000' } });
    await assert.rejects(readLimitedText(response, 1000), /over/);
  });

  void it('counts bytes, not characters', async () => {
    await assert.rejects(readLimitedText(new Response('€'.repeat(400)), 1000), /over/);
    assert.equal(await readLimitedText(new Response('€'.repeat(300)), 1000), '€'.repeat(300));
  });
});

void describe('SourceMapReader', () => {
  let server: http.Server;
  let base = '';
  let mode: 'ok' | 'hang' | 'chunked' = 'hang';
  const mapJson = JSON.stringify({ version: 3, sources: ['src/cart.ts'], mappings: 'AAAA' });

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/hang') return;
      if (req.url === '/switch' && mode === 'hang') return;
      if (req.url === '/chunked') {
        res.writeHead(200);
        const timer = setInterval(() => res.write('x'.repeat(400)), 5);
        res.on('close', () => clearInterval(timer));
        return;
      }
      res.writeHead(200);
      res.end(mapJson);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  const hung = (name: string): ScriptWithMap => ({
    url: `${base}/${name}.js`,
    sourceMapURL: `${base}/hang`,
  });

  const remote = (path: string): ScriptWithMap => ({
    url: `${base}/${path}.js`,
    sourceMapURL: `${base}/${path}`,
  });

  void it('times out a map that never answers, and keeps no entry for it', async () => {
    const reader = new SourceMapReader({ timeoutMs: 100 });
    await assert.rejects(reader.index(remote('hang')), /no answer in 0.1s/);
    assert.deepEqual(reader.cached, { count: 0, size: 0 });
  });

  void it('reads a failed map again once the server answers', async () => {
    const reader = new SourceMapReader({ timeoutMs: 100 });
    mode = 'hang';
    await assert.rejects(reader.index(remote('switch')), /no answer/);
    mode = 'ok';
    assert.deepEqual((await reader.index(remote('switch'))).sources.length, 1);
  });

  void it('stops a chunked answer without a length at the limit', async () => {
    const reader = new SourceMapReader({ maxBytes: 2000 });
    await assert.rejects(reader.index(remote('chunked')), /over/);
  });

  void it('keeps indexes within the budget, the oldest going first', async () => {
    const reader = new SourceMapReader({ cacheBudget: 250 });
    const long = 'AAAA,'.repeat(20).slice(0, -1);
    const [a, b, c] = ['a', 'b', 'c'].map((name) => inlineScript(name, ['src/cart.ts'], long));
    for (const script of [a, b, c]) await reader.index(script as ScriptWithMap);
    assert.deepEqual(reader.cached, { count: 2, size: 2 * long.length });
    const before = reader.cached;
    await reader.index(b as ScriptWithMap);
    assert.deepEqual(reader.cached, before, 'b is still cached');
    await reader.index(a as ScriptWithMap);
    assert.equal(reader.cached.count, 2, 'a was read again, c (the oldest) went');
  });

  void it('does not keep an index over the budget, but returns it', async () => {
    const reader = new SourceMapReader({ cacheBudget: 50 });
    const index = await reader.index(inlineScript('big', ['src/cart.ts'], 'AAAA,'.repeat(40)));
    assert.equal(index.sources.length, 1);
    assert.equal(reader.cached.count, 0);
  });

  void it('a read in flight when clear() runs is not counted afterwards', async () => {
    const reader = new SourceMapReader();
    const pending = reader.index(remote('slow'));
    reader.clear();
    await pending;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(reader.cached, { count: 0, size: 0 });
  });

  void it('answers as soon as one map names the file, without waiting for hung ones', async () => {
    const reader = new SourceMapReader({ timeoutMs: 10000, lookupMs: 10000 });
    const started = Date.now();
    const resolution = await reader.resolve(
      [hung('one'), inlineScript('real', ['src/cart.ts']), hung('two')],
      ANY_FILE,
      1
    );
    assert.equal(resolution.targets.length, 1);
    assert.ok(Date.now() - started < 3000);
  });

  void it('stops waiting after the budget and reports the maps still loading', async () => {
    const reader = new SourceMapReader({ timeoutMs: 10000, lookupMs: 150 });
    const started = Date.now();
    const resolution = await reader.resolve([hung('one'), hung('two')], ANY_FILE, 1);
    assert.deepEqual(resolution.targets, []);
    assert.equal(resolution.unread.length, 2);
    assert.ok(Date.now() - started < 3000);
  });
});

void describe('mapKey', () => {
  void it('stands for an inline map by a hash, not by its content', () => {
    const big = inlineScript('a', ['src/cart.ts'], 'AAAA,'.repeat(20000));
    assert.ok(mapKey(big).length < 200);
    assert.equal(mapKey(big), mapKey({ ...big }));
    assert.notEqual(mapKey(big), mapKey(inlineScript('a', ['src/cart.ts'], 'AAAA')));
  });

  void it('includes the content hash, so a rebuilt bundle is another key', () => {
    const script = { url: 'http://h/a.js', sourceMapURL: 'a.js.map' };
    assert.notEqual(mapKey({ ...script, hash: 'one' }), mapKey({ ...script, hash: 'two' }));
  });

  void it('is the script, the map URL and the hash for an external map', () => {
    assert.equal(
      mapKey({ url: 'http://h/a.js', sourceMapURL: 'a.js.map', hash: 'h1' }),
      'http://h/a.js\na.js.map\nh1'
    );
  });
});
