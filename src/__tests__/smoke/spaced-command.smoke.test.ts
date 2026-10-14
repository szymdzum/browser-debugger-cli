/**
 * A command quoted as one argument (#728).
 *
 * `bdg "page info"` is a command typed as a single word, not a URL with
 * spaces: the suggestion names `bdg page info`. Real URLs with spaces keep the
 * `%20` hint. No session is started.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';

interface Envelope {
  success: boolean;
  error?: string;
  exitCode?: number;
  suggestion?: string;
}

/**
 * Run `bdg <url> --json` and parse the error envelope.
 *
 * @param url - The single quoted argument
 * @returns Exit code and parsed envelope
 */
async function runStart(url: string): Promise<{ exitCode: number | null; json: Envelope }> {
  const result = await runCommand(url, ['--json'], { timeout: 30000 });
  assert.notEqual(result.stdout.trim(), '', `no stdout (stderr: ${result.stderr})`);
  return { exitCode: result.exitCode, json: JSON.parse(result.stdout) as Envelope };
}

void describe('quoted command as the start URL (#728)', () => {
  void it('suggests the command with its words as separate arguments', async () => {
    for (const [input, expected] of [
      ['page info', 'bdg page info'],
      ['page   info', 'bdg page info'],
      [' page info', 'bdg page info'],
      ['pagee info', 'bdg page info'],
      ['Page Info', 'bdg page Info'],
      ['page $(rm -rf x)', 'bdg page --help'],
      ['peek ;', 'bdg peek --help'],
      ["page 'x'", 'bdg page --help'],
    ] as const) {
      const { exitCode, json } = await runStart(input);
      assert.equal(exitCode, 80, input);
      assert.match(json.error ?? '', /contains spaces/, input);
      assert.equal(json.suggestion, `Did you mean: ${expected}?`, input);
    }
  });

  void it('keeps the %20 hint for URLs with spaces', async () => {
    for (const input of ['https://example.com/a b', 'example.com/a b', 'zzzzzz yyyy', 'my site', 'a b', 'my page']) {
      const { exitCode, json } = await runStart(input);
      assert.equal(exitCode, 80, input);
      assert.match(json.suggestion ?? '', /%20/, input);
    }
  });
});

void describe('long quoted input (#728)', () => {
  void it('echoes at most 100 characters of it', async () => {
    const { json } = await runStart(`page ${'x'.repeat(2000)}`);
    assert.ok((json.error ?? '').length < 200, 'error');
    assert.ok((json.suggestion ?? '').length < 200, 'suggestion');
  });
});
