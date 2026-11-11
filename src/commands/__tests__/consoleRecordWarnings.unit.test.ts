/**
 * A record stream (`console --follow --json` / `--ndjson`) has no envelope:
 * its envelope warnings (an old spelling with `--json`) go to stderr as
 * `Warning:` lines, never to stdout (#844). The envelope-wide list is module
 * state, filled here with a synthetic text.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { warnRecordStream } from '@/commands/console.js';
import { addEnvelopeWarning } from '@/ui/OutputBuilder.js';

void describe('console record stream warnings', () => {
  afterEach(() => mock.restoreAll());

  void it('prints each envelope warning on stderr and nothing on stdout', () => {
    const stderr: string[] = [];
    const stdout: string[] = [];
    mock.method(console, 'error', (text: string) => stderr.push(text));
    mock.method(console, 'log', (text: string) => stdout.push(text));
    addEnvelopeWarning('"bdg console --synthetic" is deprecated and will be removed in 9.0');
    warnRecordStream();
    assert.deepEqual(stderr, [
      'Warning: "bdg console --synthetic" is deprecated and will be removed in 9.0',
    ]);
    assert.deepEqual(stdout, []);
  });
});
