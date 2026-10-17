/**
 * `warning` and `warnings` in the `--json` envelope (#465 Q1): every text
 * written to `warning` is also in `warnings`, which is absent when empty.
 * The envelope-wide list is module state, so the test that fills it runs last.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addEnvelopeWarning, buildSuccessResponse, OutputBuilder } from '@/ui/OutputBuilder.js';

void describe('envelope warnings', () => {
  void it('has no warnings key without a warning', () => {
    assert.ok(!('warnings' in buildSuccessResponse({ a: 1 })));
    assert.ok(!('warnings' in OutputBuilder.buildJsonError('bad', { exitCode: 83 })));
  });

  void it('success: a command warning is in warning and warnings', () => {
    const envelope = buildSuccessResponse({ a: 1 }, 'w1');
    assert.equal(envelope.warning, 'w1');
    assert.deepEqual(envelope.warnings, ['w1']);
  });

  void it('error: a warning in the metadata is in warning and warnings', () => {
    const envelope = OutputBuilder.buildJsonError('bad', {
      exitCode: 83,
      warning: 'w2',
    } as never);
    assert.equal(envelope['warning'], 'w2');
    assert.deepEqual(envelope['warnings'], ['w2']);
  });

  void it('a warning of several texts joined by newlines is one entry per text', () => {
    const envelope = buildSuccessResponse({}, 'a\nb');
    assert.equal(envelope.warning, 'a\nb');
    assert.deepEqual(envelope.warnings, ['a', 'b']);
  });

  void it('an old spelling and a command warning: both, old spelling first', () => {
    addEnvelopeWarning('old spelling');
    const success = buildSuccessResponse({}, 'w3');
    assert.deepEqual(success.warnings, ['old spelling', 'w3']);
    assert.equal(success.warning, 'w3');
    const error = OutputBuilder.buildJsonError('bad', { warning: 'w4' } as never);
    assert.deepEqual(error['warnings'], ['old spelling', 'w4']);
  });
});
