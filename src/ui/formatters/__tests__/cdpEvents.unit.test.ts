/**
 * Human output of `bdg cdp` event modes with `--out`: the file line says
 * what was written and that the file is unredacted and 0600 (#624).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatCdpCollect, formatCdpEvents } from '@/ui/formatters/cdpEvents.js';
import { CDP_OUT_FILE_NOTE } from '@/ui/messages/cdpEvents.js';

void describe('cdp event output with --out', () => {
  void it('--collect --out names the file, its size and that it is unredacted and 0600', () => {
    const text = formatCdpCollect({
      method: 'Tracing.end',
      result: {},
      complete: true,
      count: 6,
      file: '/tmp/trace.ndjson',
      bytes: 6144,
    });
    assert.match(text, /^Tracing\.end: done \(no result data\)\n/);
    assert.match(
      text,
      /Wrote 6 events to \/tmp\/trace\.ndjson \(6\.0 KB, NDJSON; unredacted, readable by its owner only \(0600\)\)$/m
    );
    assert.ok(text.includes(CDP_OUT_FILE_NOTE));
  });

  void it('--events --out says the same', () => {
    const text = formatCdpEvents({
      listening: ['Network.requestWillBeSent'],
      buffered: 0,
      dropped: 0,
      count: 1,
      file: '/tmp/events.ndjson',
      bytes: 100,
    });
    assert.match(
      text,
      /^Wrote 1 event to \/tmp\/events\.ndjson \(100 B, NDJSON; unredacted, readable by its owner only \(0600\)\)\n/
    );
  });

  void it('without --out the events are listed, with no file note', () => {
    const text = formatCdpCollect({
      method: 'A.b',
      result: {},
      complete: true,
      count: 0,
      events: [],
    });
    assert.ok(!text.includes(CDP_OUT_FILE_NOTE));
    assert.match(text, /Collected 0 events/);
  });
});
