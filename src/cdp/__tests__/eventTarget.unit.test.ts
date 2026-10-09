/**
 * What `bdg cdp --collect/--until/--listen/--events` does with an event
 * name: listen to a bundled event, listen to a well-formed one the bundled
 * protocol lacks, or suggest the event a typo was meant to be.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveEventTarget } from '@/cdp/methodTarget.js';

void describe('resolveEventTarget', () => {
  void it('normalizes bundled events', () => {
    assert.deepEqual(resolveEventTarget('fetch.requestpaused'), {
      kind: 'known',
      event: 'Fetch.requestPaused',
    });
    assert.deepEqual(resolveEventTarget('Tracing.dataCollected'), {
      kind: 'known',
      event: 'Tracing.dataCollected',
    });
  });

  void it('takes an event 1-2 letters off a bundled one for a typo', () => {
    assert.deepEqual(resolveEventTarget('Fetch.requestPausd'), {
      kind: 'typo',
      event: 'Fetch.requestPausd',
      suggestions: ['Fetch.requestPaused'],
    });
    assert.deepEqual(resolveEventTarget('Tracing.tracingComplet'), {
      kind: 'typo',
      event: 'Tracing.tracingComplet',
      suggestions: ['Tracing.tracingComplete'],
    });
  });

  void it('takes a domain 1-2 letters off a bundled one for a typo', () => {
    assert.deepEqual(resolveEventTarget('Fetc.requestPaused'), {
      kind: 'typo',
      event: 'Fetc.requestPaused',
      suggestions: ['Fetch.requestPaused'],
    });
  });

  void it('tells a method apart from an event', () => {
    assert.deepEqual(resolveEventTarget('Tracing.end'), { kind: 'method', method: 'Tracing.end' });
    assert.deepEqual(resolveEventTarget('fetch.enable'), {
      kind: 'method',
      method: 'Fetch.enable',
    });
  });

  void it('listens to well-formed events missing from the bundled protocol as typed', () => {
    assert.deepEqual(resolveEventTarget('Fetch.somethingBrandNew'), {
      kind: 'unlisted',
      event: 'Fetch.somethingBrandNew',
    });
    assert.deepEqual(resolveEventTarget('Foo.bar'), { kind: 'unlisted', event: 'Foo.bar' });
  });

  void it('rejects names that are not Domain.event', () => {
    assert.deepEqual(resolveEventTarget('requestPaused'), { kind: 'malformed' });
    assert.deepEqual(resolveEventTarget('Fetch.request-paused'), { kind: 'malformed' });
  });
});
