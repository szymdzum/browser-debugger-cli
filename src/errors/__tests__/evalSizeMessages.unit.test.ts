/**
 * Size wording of `dom eval` errors: MiB where 1024 x 1024 is meant, and a
 * suggestion that names only ways out that work (#706).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evalResultNotSendableError,
  evalResultTooLargeError,
  evalResultUnsentFullError,
  resultNotSentError,
} from '@/errors/messages.js';
import { formatMiB } from '@/ui/formatting.js';

const MIB = 1024 * 1024;
const FULL_CAP = 50 * MIB;
const TRANSFER_CAP = 256 * MIB;

void describe('formatMiB', () => {
  void it('labels 1024 x 1024 bytes as MiB', () => {
    assert.equal(formatMiB(50 * MIB, 0), '50 MiB');
    assert.equal(formatMiB(200 * MIB), '200.0 MiB');
    assert.equal(formatMiB(1.5 * MIB), '1.5 MiB');
  });
});

void describe('dom eval --full over the cap', () => {
  void it('names the size and the cap in MiB for a string that arrived, and offers dropping --full', () => {
    const err = evalResultTooLargeError(200 * MIB, FULL_CAP, true);
    assert.equal(err.message, 'The result is 200.0 MiB, over the 50 MiB limit of dom eval --full');
    assert.match(err.suggestion ?? '', /drop --full/);
  });

  void it('says MiB for a result too large to measure', () => {
    const err = evalResultTooLargeError(Infinity, FULL_CAP, true);
    assert.match(err.message, /over 512 MiB/);
    assert.match(err.message, /50 MiB limit/);
  });

  void it('does not offer dropping --full when only a count at the cap is known', () => {
    const err = evalResultTooLargeError(FULL_CAP + 10, FULL_CAP, false);
    assert.match(err.message, /50 MiB limit/);
    assert.doesNotMatch(err.suggestion ?? '', /drop --full/);
  });

  void it('does not offer dropping --full when Chrome could not send the result', () => {
    const err = evalResultUnsentFullError(FULL_CAP);
    assert.match(err.message, /50 MiB limit/);
    assert.doesNotMatch(err.suggestion ?? '', /drop --full/);
  });
});

void describe('dom eval result Chrome cannot send', () => {
  void it('names the transfer cap in MiB (81, without --full)', () => {
    const err = evalResultNotSendableError(300 * MIB, TRANSFER_CAP);
    assert.match(err.message, /over 256 MiB \(counted 300\.0 MiB/);
  });

  void it('names a way to read the data that works with bdg (102)', () => {
    const err = resultNotSentError();
    assert.doesNotMatch(err.suggestion ?? '', /write the data to a file/);
    assert.match(err.suggestion ?? '', /window\./);
    assert.match(err.suggestion ?? '', /--full/);
    assert.match(err.suggestion ?? '', /50 MiB/);
    assert.match(err.suggestion ?? '', /slice\(0, 10000000\)/);
    assert.match(err.suggestion ?? '', /\[\.\.\.window\.data\]\.slice/);
    assert.match(err.suggestion ?? '', /multibyte/);
  });

  void it('does not round a count just over the cap down to the cap', () => {
    const err = evalResultNotSendableError(TRANSFER_CAP + 10, TRANSFER_CAP);
    assert.match(err.message, /counted 268435466 bytes/);
  });

  void it('does not suggest .slice for an object', () => {
    const err = evalResultNotSendableError(300 * MIB, TRANSFER_CAP);
    assert.doesNotMatch(err.suggestion ?? '', /\.slice\(0, 1000\)/);
  });
});
