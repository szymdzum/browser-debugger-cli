/**
 * Did-you-mean bounds for unknown commands and the port error (#741).
 * No session is started.
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
 * Run bdg with arguments and parse the error envelope.
 *
 * @param args - Arguments, `--json` is appended
 * @returns Exit code and parsed envelope
 */
async function run(args: string[]): Promise<{ exitCode: number | null; json: Envelope }> {
  const [first = '', ...rest] = args;
  const result = await runCommand(first, [...rest, '--json'], { timeout: 30000 });
  assert.notEqual(result.stdout.trim(), '', `no stdout (stderr: ${result.stderr})`);
  return { exitCode: result.exitCode, json: JSON.parse(result.stdout) as Envelope };
}

void describe('unknown command did-you-mean (#741)', () => {
  void it('suggests nothing for words far from every command', async () => {
    for (const args of [['foo'], ['bdg'], ['help', 'blorp']]) {
      const { exitCode, json } = await run(args);
      assert.equal(exitCode, 81, args.join(' '));
      assert.match(
        json.suggestion ?? '',
        /^Run "bdg( help)? --help"|^Run "bdg --help"/,
        args.join(' ')
      );
      assert.doesNotMatch(json.suggestion ?? '', /Did you mean/, args.join(' '));
    }
  });

  void it('folds case before the distance check', async () => {
    for (const word of ['PEEK', 'Peek']) {
      const { exitCode, json } = await run([word]);
      assert.equal(exitCode, 81, word);
      assert.equal(json.suggestion, 'Did you mean: bdg peek?', word);
    }
  });

  void it('names the port for a non-numeric port, exit 80', async () => {
    const { exitCode, json } = await run(['localhost:abc']);
    assert.equal(exitCode, 80);
    assert.match(json.error ?? '', /port/i);
  });
});
