/**
 * A command result's warning: top-level `warning` in the `--json` envelope
 * (success and error alike), `Warning: …` on stderr otherwise.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { runCommand, type CommandResult } from '@/commands/shared/CommandRunner.js';
import { CommandError } from '@/errors/index.js';

/** Thrown by the stubbed process.exit to stop the runner */
class Exit extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${code}`);
  }
}

/** Lines printed on stdout; the first is the envelope (the stubbed exit makes the runner print again) */
let stdout: string[] = [];
let stderr: string[] = [];
/** Exit codes passed to process.exit; the first is the command's */
let exits: (number | undefined)[] = [];

/**
 * Run a handler through runCommand with output and exit captured.
 *
 * @param handler - Handler result or error to throw
 * @param json - Whether to use --json
 * @returns The command's exit code
 */
async function run(handler: () => CommandResult, json: boolean): Promise<number | undefined> {
  try {
    await runCommand(
      async () => Promise.resolve(handler()),
      { json },
      () => 'formatted'
    );
  } catch (error) {
    if (!(error instanceof Exit)) throw error;
  }
  return exits[0];
}

void describe('runCommand warnings', () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    exits = [];
    mock.method(console, 'log', (text: string) => stdout.push(text));
    mock.method(console, 'error', (text: string) => stderr.push(text));
    mock.method(process, 'exit', (code?: number) => {
      exits.push(code);
      throw new Exit(code);
    });
  });

  afterEach(() => mock.restoreAll());

  void it('puts the warning at the top of a success envelope', async () => {
    await run(() => ({ success: true, data: { a: 1 }, warning: 'w1' }), true);
    const envelope = JSON.parse(stdout[0] ?? '') as Record<string, unknown>;
    assert.equal(envelope['warning'], 'w1');
    assert.deepEqual(envelope['data'], { a: 1 });
    assert.deepEqual(stderr, []);
  });

  void it('puts the warning at the top of an error envelope', async () => {
    const code = await run(
      () => ({ success: false, error: 'bad', exitCode: 83, warning: 'w2' }),
      true
    );
    assert.equal(code, 83);
    assert.equal((JSON.parse(stdout[0] ?? '') as Record<string, unknown>)['warning'], 'w2');
  });

  void it('prints "Warning: …" on stderr in text, for success and errors', async () => {
    await run(() => ({ success: true, data: {}, warning: 'w3' }), false);
    assert.ok(stderr.includes('Warning: w3'), stderr.join('\n'));
    stderr = [];
    await run(() => ({ success: false, error: 'bad', exitCode: 83, warning: 'w4' }), false);
    assert.ok(stderr.includes('Warning: w4'), stderr.join('\n'));
    stderr = [];
    await run(() => {
      throw new CommandError('bad', { suggestion: 's', warning: 'w5' }, 83);
    }, false);
    assert.ok(stderr.includes('Warning: w5'), stderr.join('\n'));
    assert.ok(stderr.includes('s'), stderr.join('\n'));
  });
});
