/**
 * A command result's warning: in the `--json` envelope's `warnings` (success
 * and error alike; 1.0 dropped the top-level `warning`, #844), `Warning: …`
 * on stderr otherwise.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { failOnNavigationFailed } from '@/commands/dom/helpers/navigationFailed.js';
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

  void it('puts the warning in warnings of a success envelope', async () => {
    await run(() => ({ success: true, data: { a: 1 }, warning: 'w1' }), true);
    const envelope = JSON.parse(stdout[0] ?? '') as Record<string, unknown>;
    assert.deepEqual(envelope['warnings'], ['w1']);
    assert.ok(!('warning' in envelope));
    assert.deepEqual(envelope['data'], { a: 1 });
    assert.deepEqual(stderr, []);
  });

  void it('puts the warning in warnings of an error envelope', async () => {
    const code = await run(
      () => ({ success: false, error: 'bad', exitCode: 83, warning: 'w2' }),
      true
    );
    assert.equal(code, 83);
    const envelope = JSON.parse(stdout[0] ?? '') as Record<string, unknown>;
    assert.deepEqual(envelope['warnings'], ['w2']);
    assert.ok(!('warning' in envelope));
  });

  void it('a failed navigation (exit 80): the action warning is in warnings only', async () => {
    const code = await run(
      () =>
        failOnNavigationFailed({
          success: true,
          data: {
            navigationFailed: { url: 'http://127.0.0.1:9/', errorText: 'net::ERR_FAILED' },
            warning: 'covered',
          },
        }),
      true
    );
    assert.equal(code, 80);
    const envelope = JSON.parse(stdout[0] ?? '') as Record<string, unknown>;
    assert.deepEqual(envelope['warnings'], ['covered']);
    assert.ok(!('warning' in envelope), stdout[0]);
  });

  void it('a thrown CommandError: its warning is in warnings only', async () => {
    await run(() => {
      throw new CommandError('bad', { suggestion: 's', warning: 'w6' }, 83);
    }, true);
    const envelope = JSON.parse(stdout[0] ?? '') as Record<string, unknown>;
    assert.deepEqual(envelope['warnings'], ['w6']);
    assert.ok(!('warning' in envelope), stdout[0]);
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
