/**
 * CDP event collection in the daemon: a `--collect` subscribes before the
 * method is sent and ends at its `--until` event or its timeout (a timeout
 * returns the partial events with `complete: false`, not an error); a
 * `--listen` buffer is read and drained by `--events`, optionally waiting
 * for an event. Events of attached child sessions are left out.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import { CdpEventListener, collectEvents, type EventSource } from '@/daemon/session/cdpEvents.js';
import { CommandError } from '@/errors/index.js';
import type { CdpEventRecord } from '@/ipc/protocol/cdpEventTypes.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

type Handler = (params: unknown, sessionId?: string) => void;

/** CDP connection stand-in that emits events on demand */
class FakeSource implements EventSource {
  private readonly handlers = new Map<string, Set<Handler>>();

  on<T = unknown>(event: string, handler: (params: T, sessionId?: string) => void): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(event, set);
    return () => set.delete(handler as Handler);
  }

  emit(event: string, params: unknown, sessionId?: string): void {
    for (const handler of this.handlers.get(event) ?? []) handler(params, sessionId);
  }

  /** Handlers registered, over all events */
  get subscribed(): number {
    return [...this.handlers.values()].reduce((n, set) => n + set.size, 0);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-cdp-events-'));
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

/**
 * Params of the events, by their `n`.
 *
 * @param events - Events
 * @returns Their `params.n`
 */
function ns(events: CdpEventRecord[] | undefined): unknown[] {
  return (events ?? []).map((e) => (e.params as { n?: number }).n);
}

void describe('collectEvents', () => {
  void it('collects events sent while the method runs and ends at --until', async () => {
    const source = new FakeSource();
    const started = Date.now();
    const outcome = await collectEvents(
      source,
      () => {
        source.emit('Tracing.dataCollected', { n: 1 });
        setTimeout(() => {
          source.emit('Tracing.dataCollected', { n: 2 });
          source.emit('Tracing.tracingComplete', { n: 3 });
          source.emit('Tracing.dataCollected', { n: 4 });
        }, 10);
        return Promise.resolve({});
      },
      { events: ['Tracing.dataCollected'], until: 'Tracing.tracingComplete', timeoutMs: 10_000 }
    );
    assert.ok(Date.now() - started < 5000, 'returns at the --until event');
    assert.deepEqual(outcome.result, {});
    assert.equal(outcome.collected.complete, true);
    assert.deepEqual(ns(outcome.collected.events), [1, 2, 3]);
    assert.equal(outcome.collected.count, 3);
    assert.equal(source.subscribed, 0, 'unsubscribed');
  });

  void it('returns the partial events with complete: false when --until never comes', async () => {
    const source = new FakeSource();
    const outcome = await collectEvents(
      source,
      () => {
        source.emit('Tracing.dataCollected', { n: 1 });
        return Promise.resolve({});
      },
      { events: ['Tracing.dataCollected'], until: 'Tracing.tracingComplete', timeoutMs: 50 }
    );
    assert.equal(outcome.collected.complete, false);
    assert.deepEqual(ns(outcome.collected.events), [1]);
    assert.equal(source.subscribed, 0);
  });

  void it('without --until collects for the whole timeout and is complete', async () => {
    const source = new FakeSource();
    const outcome = await collectEvents(
      source,
      () => {
        setTimeout(() => source.emit('Network.responseReceived', { n: 1 }), 5);
        return Promise.resolve({ frameId: 'f' });
      },
      { events: ['Network.responseReceived'], timeoutMs: 100 }
    );
    assert.equal(outcome.collected.complete, true);
    assert.deepEqual(ns(outcome.collected.events), [1]);
  });

  void it('waits for the method to answer even past the timeout', async () => {
    const source = new FakeSource();
    const outcome = await collectEvents(
      source,
      async () => {
        source.emit('HeapProfiler.addHeapSnapshotChunk', { n: 1 });
        await new Promise((resolve) => setTimeout(resolve, 80));
        source.emit('HeapProfiler.addHeapSnapshotChunk', { n: 2 });
        return {};
      },
      { events: ['HeapProfiler.addHeapSnapshotChunk'], timeoutMs: 10 }
    );
    assert.deepEqual(ns(outcome.collected.events), [1, 2]);
  });

  void it('leaves out events of attached child sessions', async () => {
    const source = new FakeSource();
    const outcome = await collectEvents(
      source,
      () => {
        source.emit('Network.requestWillBeSent', { n: 1 });
        source.emit('Network.requestWillBeSent', { n: 2 }, 'worker-session');
        return Promise.resolve({});
      },
      { events: ['Network.requestWillBeSent'], timeoutMs: 20 }
    );
    assert.deepEqual(ns(outcome.collected.events), [1]);
  });

  void it('fails like the method and unsubscribes when the method fails', async () => {
    const source = new FakeSource();
    await assert.rejects(
      collectEvents(source, () => Promise.reject(new Error('Tracing is not started')), {
        events: ['Tracing.dataCollected'],
        until: 'Tracing.tracingComplete',
        timeoutMs: 10_000,
      }),
      /Tracing is not started/
    );
    assert.equal(source.subscribed, 0);
  });

  void it('keeps the output within the budget and counts what it left out', async () => {
    const source = new FakeSource();
    const outcome = await collectEvents(
      source,
      () => {
        for (let n = 1; n <= 50; n++) source.emit('A.b', { n, data: 'x'.repeat(100) });
        return Promise.resolve({});
      },
      { events: ['A.b'], timeoutMs: 10, maxChars: 1000 }
    );
    const shown = outcome.collected.events?.length ?? 0;
    assert.ok(shown > 0 && shown < 50, `${shown} shown`);
    assert.equal(outcome.collected.count, shown);
    assert.equal(outcome.collected.omitted, 50 - shown);
  });

  void it('writes every event to an NDJSON file with --out', async () => {
    const source = new FakeSource();
    const file = path.join(tmpDir, 'nested', 'trace.ndjson');
    const outcome = await collectEvents(
      source,
      () => {
        for (let n = 1; n <= 50; n++) source.emit('A.b', { n, data: 'x'.repeat(100) });
        source.emit('A.done', { n: 51 });
        return Promise.resolve({});
      },
      { events: ['A.b'], until: 'A.done', timeoutMs: 1000, out: file, maxChars: 1000 }
    );
    assert.equal(outcome.collected.events, undefined);
    assert.equal(outcome.collected.file, file);
    assert.equal(outcome.collected.count, 51);
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    assert.equal(lines.length, 51);
    assert.equal(outcome.collected.bytes, fs.statSync(file).size);
    const first = JSON.parse(lines[0] ?? '') as CdpEventRecord;
    assert.equal(first.method, 'A.b');
    assert.equal(typeof first.ts, 'number');
  });

  void it('names the path when the --out file cannot be written', async () => {
    const source = new FakeSource();
    let called = false;
    await assert.rejects(
      collectEvents(
        source,
        () => {
          called = true;
          return Promise.resolve({});
        },
        { events: ['A.b'], timeoutMs: 10, out: tmpDir }
      ),
      (error: unknown) => error instanceof CommandError && error.message.includes(tmpDir)
    );
    assert.equal(called, false, 'the method is not sent');
  });

  void it('ends early, incomplete, when the client leaves', async () => {
    const source = new FakeSource();
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 10);
    const started = Date.now();
    const outcome = await collectEvents(source, () => Promise.resolve({}), {
      events: ['A.b'],
      until: 'A.done',
      timeoutMs: 10_000,
      signal: abort.signal,
    });
    assert.ok(Date.now() - started < 5000);
    assert.equal(outcome.collected.complete, false);
    assert.equal(source.subscribed, 0);
  });
});

void describe('CdpEventListener', () => {
  void it('fails with exit 83 when nothing is listened to', async () => {
    const listener = new CdpEventListener();
    await assert.rejects(
      listener.read({ action: 'read' }),
      (error: unknown) =>
        error instanceof CommandError && error.exitCode === EXIT_CODES.RESOURCE_NOT_FOUND
    );
  });

  void it('buffers events between commands and drains them on read', async () => {
    const source = new FakeSource();
    const listener = new CdpEventListener();
    assert.deepEqual(listener.listen(source, ['Fetch.requestPaused']).listening, [
      'Fetch.requestPaused',
    ]);
    source.emit('Fetch.requestPaused', { n: 1, requestId: 'interception-job-1.0' });
    source.emit('Fetch.requestPaused', { n: 2 }, 'iframe-session');
    const first = await listener.read({ action: 'read' });
    assert.deepEqual(ns(first.events), [1]);
    assert.equal(first.count, 1);
    assert.equal(first.buffered, 0);
    const second = await listener.read({ action: 'read' });
    assert.deepEqual(second.events, []);
  });

  void it('listening twice to an event subscribes once', () => {
    const source = new FakeSource();
    const listener = new CdpEventListener();
    listener.listen(source, ['A.b']);
    const state = listener.listen(source, ['A.b', 'C.d']);
    assert.deepEqual(state.listening, ['A.b', 'C.d']);
    assert.equal(source.subscribed, 2);
  });

  void it('reads only the named events, leaving the others buffered', async () => {
    const source = new FakeSource();
    const listener = new CdpEventListener();
    listener.listen(source, ['A.b', 'C.d']);
    source.emit('A.b', { n: 1 });
    source.emit('C.d', { n: 2 });
    const read = await listener.read({ action: 'read', events: ['C.d'] });
    assert.deepEqual(ns(read.events), [2]);
    assert.equal(read.buffered, 1);
  });

  void it('waits for an event with waitMs', async () => {
    const source = new FakeSource();
    const listener = new CdpEventListener();
    listener.listen(source, ['A.b']);
    setTimeout(() => source.emit('A.b', { n: 1 }), 20);
    const started = Date.now();
    const read = await listener.read({ action: 'read', waitMs: 10_000 });
    assert.ok(Date.now() - started < 5000);
    assert.deepEqual(ns(read.events), [1]);
    assert.equal(read.waitedOut, undefined);
  });

  void it('returns no events, not an error, when the wait runs out', async () => {
    const source = new FakeSource();
    const listener = new CdpEventListener();
    listener.listen(source, ['A.b']);
    const read = await listener.read({ action: 'read', waitMs: 30 });
    assert.deepEqual(read.events, []);
    assert.equal(read.waitedOut, true);
  });

  void it('leaves the events buffered when the client left during the wait', async () => {
    const source = new FakeSource();
    const listener = new CdpEventListener();
    listener.listen(source, ['A.b']);
    const left = new AbortController();
    setTimeout(() => {
      source.emit('A.b', { n: 1 });
      left.abort();
    }, 10);
    await listener.read({ action: 'read', waitMs: 10_000 }, left.signal);
    const next = await listener.read({ action: 'read' });
    assert.deepEqual(ns(next.events), [1]);
  });

  void it('counts events dropped at the cap', async () => {
    const source = new FakeSource();
    const listener = new CdpEventListener({ maxEvents: 2, maxBytes: 1_000_000 });
    listener.listen(source, ['A.b']);
    for (let n = 1; n <= 5; n++) source.emit('A.b', { n });
    const read = await listener.read({ action: 'read' });
    assert.deepEqual(ns(read.events), [4, 5]);
    assert.equal(read.dropped, 3);
  });

  void it('leaves events over the output budget buffered for the next read', async () => {
    const source = new FakeSource();
    const listener = new CdpEventListener(undefined, 1000);
    listener.listen(source, ['A.b']);
    for (let n = 1; n <= 30; n++) source.emit('A.b', { n, data: 'x'.repeat(100) });
    const first = await listener.read({ action: 'read' });
    const shown = first.events?.length ?? 0;
    assert.ok(shown > 0 && shown < 30);
    assert.equal(first.remaining, 30 - shown);
    const second = await listener.read({ action: 'read' });
    assert.equal(ns(second.events)[0], shown + 1);
  });

  void it('clears the matching events with clear', async () => {
    const source = new FakeSource();
    const listener = new CdpEventListener();
    listener.listen(source, ['A.b']);
    source.emit('A.b', { n: 1 });
    source.emit('A.b', { n: 2 });
    const read = await listener.read({ action: 'read', clear: true });
    assert.equal(read.cleared, 2);
    assert.equal(read.events, undefined);
    assert.equal(read.buffered, 0);
  });

  void it('writes the buffered events to a file with out', async () => {
    const source = new FakeSource();
    const listener = new CdpEventListener();
    listener.listen(source, ['A.b']);
    source.emit('A.b', { n: 1 });
    const file = path.join(tmpDir, 'events.ndjson');
    const read = await listener.read({ action: 'read', out: file });
    assert.equal(read.file, file);
    assert.equal(read.count, 1);
    assert.equal(fs.readFileSync(file, 'utf8').trimEnd().split('\n').length, 1);
  });

  void it('unlisten stops listening and discards the buffer', async () => {
    const source = new FakeSource();
    const listener = new CdpEventListener();
    listener.listen(source, ['A.b', 'C.d']);
    source.emit('A.b', { n: 1 });
    const stopped = listener.unlisten();
    assert.deepEqual(stopped.stopped, ['A.b', 'C.d']);
    assert.equal(stopped.discarded, 1);
    assert.deepEqual(stopped.listening, []);
    assert.equal(source.subscribed, 0);
    await assert.rejects(listener.read({ action: 'read' }), CommandError);
  });
});
