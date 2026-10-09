/**
 * The bounded CDP event buffer of `bdg cdp --listen` and the output budget
 * of `--collect`/`--events`: the buffer drops its oldest events at its event
 * and byte caps and counts them; a read returns events in order within a
 * character budget, cutting only a first event that alone is over it, and
 * takes out of the buffer only the events it returned.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EventBuffer, EventPage, eventJsonLength } from '@/daemon/session/cdpEventBuffer.js';
import type { CdpEventRecord } from '@/ipc/protocol/cdpEventTypes.js';

/**
 * An event with a payload of a given length.
 *
 * @param method - Event name
 * @param n - Sequence number (also the timestamp)
 * @param payload - Characters of payload
 * @returns Event record
 */
function event(method: string, n: number, payload = 10): CdpEventRecord {
  return { method, params: { n, data: 'x'.repeat(payload) }, ts: n };
}

const all = (): boolean => true;
const named =
  (name: string) =>
  (method: string): boolean =>
    method === name;

void describe('EventPage', () => {
  void it('keeps events in order within the budget and counts the rest as omitted', () => {
    const size = eventJsonLength(event('A.b', 1));
    const page = new EventPage(size * 2 + 1);
    assert.equal(page.add(event('A.b', 1)), true);
    assert.equal(page.add(event('A.b', 2)), true);
    assert.equal(page.add(event('A.b', 3)), false);
    assert.equal(page.add(event('A.b', 4, 0)), false, 'nothing after an omitted event is added');
    assert.deepEqual(
      page.events.map((e) => (e.params as { n: number }).n),
      [1, 2]
    );
    assert.equal(page.omitted, 2);
  });

  void it('cuts a first event over the budget to the start of its JSON text', () => {
    const big = event('Tracing.dataCollected', 1, 5000);
    const page = new EventPage(1000);
    assert.equal(page.add(big), true);
    assert.equal(page.add(event('Tracing.dataCollected', 2)), false);
    const [first] = page.events;
    assert.equal(typeof first?.params, 'string');
    assert.ok((first?.params as string).startsWith('{"n":1,"data":"xxx'));
    assert.ok((first?.params as string).length <= 1000);
    assert.equal(first?.truncatedFrom, JSON.stringify(big.params).length);
    assert.equal(page.omitted, 1);
  });
});

void describe('EventBuffer', () => {
  void it('drops the oldest events beyond its event cap and counts them', () => {
    const buffer = new EventBuffer({ maxEvents: 3, maxBytes: 1_000_000 });
    for (let n = 1; n <= 5; n++) buffer.push(event('A.b', n));
    assert.equal(buffer.size, 3);
    assert.equal(buffer.dropped, 2);
    assert.deepEqual(
      buffer.take(all).map((e) => e.ts),
      [3, 4, 5]
    );
  });

  void it('drops the oldest events beyond its byte budget', () => {
    const size = eventJsonLength(event('A.b', 1, 100));
    const buffer = new EventBuffer({ maxEvents: 100, maxBytes: size * 2 + 10 });
    for (let n = 1; n <= 4; n++) buffer.push(event('A.b', n, 100));
    assert.equal(buffer.size, 2);
    assert.equal(buffer.dropped, 2);
    assert.ok(buffer.bytes <= size * 2 + 10);
  });

  void it('measures its budget in UTF-8 bytes, not characters', () => {
    const accented = (n: number): CdpEventRecord => ({
      method: 'A.b',
      params: 'é'.repeat(100),
      ts: n,
    });
    const chars = eventJsonLength(accented(1));
    const buffer = new EventBuffer({ maxEvents: 100, maxBytes: chars * 2 + 10 });
    buffer.push(accented(1));
    buffer.push(accented(2));
    assert.equal(buffer.size, 1, 'two events of 100 two-byte letters are over the byte budget');
    assert.equal(buffer.bytes, Buffer.byteLength(JSON.stringify(accented(2))));
  });

  void it('drops an event alone over the byte budget', () => {
    const buffer = new EventBuffer({ maxEvents: 100, maxBytes: 50 });
    buffer.push(event('A.b', 1, 500));
    assert.equal(buffer.size, 0);
    assert.equal(buffer.dropped, 1);
  });

  void it('takes only matching events, leaving the others buffered', () => {
    const buffer = new EventBuffer({ maxEvents: 10, maxBytes: 1_000_000 });
    buffer.push(event('A.x', 1));
    buffer.push(event('B.y', 2));
    buffer.push(event('A.x', 3));
    assert.equal(buffer.count(named('A.x')), 2);
    assert.deepEqual(
      buffer.take(named('A.x')).map((e) => e.ts),
      [1, 3]
    );
    assert.equal(buffer.size, 1);
    assert.equal(buffer.count(named('B.y')), 1);
  });

  void it('takes out of the buffer only the events a page returned', () => {
    const buffer = new EventBuffer({ maxEvents: 10, maxBytes: 1_000_000 });
    for (let n = 1; n <= 4; n++) buffer.push(event('A.b', n));
    const page = new EventPage(eventJsonLength(event('A.b', 1)) * 2 + 1);
    buffer.take(all, page);
    assert.equal(page.events.length, 2);
    assert.equal(page.omitted, 2);
    assert.deepEqual(
      buffer.take(all).map((e) => e.ts),
      [3, 4]
    );
  });

  void it('clears matching events and reports how many', () => {
    const buffer = new EventBuffer({ maxEvents: 10, maxBytes: 1_000_000 });
    buffer.push(event('A.x', 1));
    buffer.push(event('B.y', 2));
    assert.equal(buffer.clear(named('A.x')), 1);
    assert.equal(buffer.size, 1);
    assert.equal(buffer.clear(all), 1);
    assert.equal(buffer.bytes, 0);
  });
});
