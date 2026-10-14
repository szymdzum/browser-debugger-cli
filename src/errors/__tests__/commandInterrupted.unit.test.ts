/**
 * The error of an interrupted command (#611) says what may already have
 * happened, by what the command does.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { commandInterruptedError, commandInterruptedLine } from '@/errors/messages.js';

void describe('commandInterruptedError', () => {
  void it('tells a read to run again', () => {
    const err = commandInterruptedError();
    assert.equal(err.message, 'Interrupted');
    assert.match(err.suggestion, /run it again/);
  });

  void it('says an action may have reached the page', () => {
    assert.match(
      commandInterruptedError({ sent: 'click' }).suggestion,
      /^The click may already have reached the page; check with bdg peek/
    );
  });

  void it('says an eval script was stopped on the page, its earlier changes may remain', () => {
    const { suggestion } = commandInterruptedError({ stopped: 'script' });
    assert.match(suggestion, /^The script was stopped on the page if it was still running; /);
    assert.match(suggestion, /changes it made before the stop may remain/);
    assert.match(suggestion, /check with bdg peek/);
  });

  void it('says a stop may have been sent, to check with bdg status', () => {
    const { suggestion } = commandInterruptedError({ session: 'stop' });
    assert.match(suggestion, /^The stop request may already have been sent; check with bdg status/);
    assert.doesNotMatch(suggestion, /page|peek/);
  });

  void it('says a cleanup may have started, to check with bdg status', () => {
    const { suggestion } = commandInterruptedError({ session: 'cleanup' });
    assert.match(suggestion, /cleanup may already have/);
    assert.match(suggestion, /bdg status/);
  });

  void it('says whether a file was written', () => {
    assert.match(
      commandInterruptedError({ file: 'HAR file' }).suggestion,
      /HAR file was not written/
    );
    assert.match(
      commandInterruptedError({ file: 'HAR file', writing: '/tmp/a.har' }).suggestion,
      /may or may not have been written to \/tmp\/a\.har/
    );
  });

  void it('says a call that writes a file may have reached the page and names the file (#758)', () => {
    const { suggestion } = commandInterruptedError({ sent: 'CDP call', writing: '/tmp/t.ndjson' });
    assert.match(suggestion, /^The CDP call may already have reached the page; /);
    assert.match(suggestion, /\/tmp\/t\.ndjson/);
    assert.match(suggestion, /may or may not have been written/);
    assert.doesNotMatch(suggestion, /run (it|the command) again/);
  });

  void it('is one line in text output', () => {
    const line = commandInterruptedLine(commandInterruptedError({ sent: 'fill' }));
    assert.match(line, /^Interrupted\. The fill may/);
    assert.ok(!line.includes('\n'));
  });
});
