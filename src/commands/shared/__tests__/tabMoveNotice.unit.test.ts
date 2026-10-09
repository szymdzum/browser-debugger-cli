/**
 * A move of the session to another tab that no command reported yet (its
 * tab closed on its own): the daemon puts it on the next response, and the
 * command reports it: top-level `tabClosed` and `switchedTo` in the `--json`
 * envelope, `Tab closed: …; now on tab N: …` on stderr otherwise.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { runCommand, type CommandResult } from '@/commands/shared/CommandRunner.js';
import { CommandError } from '@/errors/index.js';
import { noteTabMove, takeTabMove } from '@/ipc/utils/tabMove.js';

/** Thrown by the stubbed process.exit to stop the runner */
class Exit extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${code}`);
  }
}

let stdout: string[] = [];
let stderr: string[] = [];

const moved = {
  tabClosed: { targetId: 'P', url: 'http://a/popup', title: 'Popup' },
  switchedTo: { index: 0, targetId: 'A', url: 'http://a/', title: 'App' },
};

/**
 * Run a handler through runCommand with output captured.
 *
 * @param handler - Handler result, or throws
 * @param json - Whether to use --json
 */
async function run(handler: () => CommandResult, json: boolean): Promise<void> {
  try {
    await runCommand(
      async () => Promise.resolve(handler()),
      { json },
      () => 'formatted'
    );
  } catch (error) {
    if (!(error instanceof Exit)) throw error;
  }
}

void describe('runCommand: a move no command reported yet', () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    takeTabMove();
    mock.method(console, 'log', (text: string) => stdout.push(text));
    mock.method(console, 'error', (text: string) => stderr.push(text));
    mock.method(process, 'exit', (code?: number) => {
      throw new Exit(code);
    });
  });

  afterEach(() => mock.restoreAll());

  void it('notes it from a daemon response that has it, and ignores ones without', () => {
    noteTabMove({ status: 'ok', data: {} });
    assert.equal(takeTabMove(), undefined);
    noteTabMove({ status: 'ok', data: {}, tabMoved: moved });
    assert.deepEqual(takeTabMove(), moved);
    assert.equal(takeTabMove(), undefined);
  });

  void it('puts it at the top of a success envelope', async () => {
    noteTabMove({ tabMoved: moved });
    await run(() => ({ success: true, data: { a: 1 } }), true);
    const envelope = JSON.parse(stdout[0] ?? '') as Record<string, unknown>;
    assert.deepEqual(envelope['tabClosed'], moved.tabClosed);
    assert.deepEqual(envelope['switchedTo'], moved.switchedTo);
    assert.deepEqual(envelope['data'], { a: 1 });
  });

  void it('puts it in an error envelope, also of a thrown error', async () => {
    const handlers: Array<() => CommandResult> = [
      () => ({ success: false, error: 'No nodes found', exitCode: 83 }),
      () => {
        throw new CommandError('No nodes found', {}, 83);
      },
    ];
    for (const handler of handlers) {
      stdout = [];
      noteTabMove({ tabMoved: moved });
      await run(handler, true);
      const envelope = JSON.parse(stdout[0] ?? '') as Record<string, unknown>;
      assert.equal(envelope['success'], false);
      assert.deepEqual(envelope['tabClosed'], moved.tabClosed);
    }
  });

  void it('prints the move on stderr in text', async () => {
    noteTabMove({ tabMoved: moved });
    await run(() => ({ success: true, data: {} }), false);
    assert.ok(
      stderr.includes('Tab closed: http://a/popup; now on tab 0: http://a/'),
      stderr.join('\n')
    );
    assert.deepEqual(stdout, ['formatted']);
  });

  void it('says nothing when there was no move', async () => {
    await run(() => ({ success: true, data: {} }), true);
    const envelope = JSON.parse(stdout[0] ?? '') as Record<string, unknown>;
    assert.equal('tabClosed' in envelope, false);
  });
});
