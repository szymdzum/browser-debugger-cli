/**
 * Ctrl-C during `bdg page switch`: the command waits for the daemon's answer,
 * then exits 130 (143 for SIGTERM) with an error that says where the session
 * is: the switch completed, failed, or was never sent.
 */

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { switchTab } from '@/commands/page.js';
import { CommandError } from '@/errors/index.js';
import type { PageSwitchData } from '@/ipc/protocol/tabTypes.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const switched: PageSwitchData = {
  tab: {
    index: 1,
    targetId: 'P',
    url: 'http://a/popup',
    title: 'Popup',
    kind: 'popup',
    current: true,
  },
  previous: { index: 0, targetId: 'A', url: 'http://a/', title: 'App' },
};

/**
 * The error a switch threw.
 *
 * @param run - The switch
 * @returns Its CommandError
 */
async function thrown(run: Promise<unknown>): Promise<CommandError> {
  try {
    await run;
  } catch (error) {
    assert.ok(error instanceof CommandError, String(error));
    return error;
  }
  assert.fail('expected an error');
}

void describe('page switch interrupted', () => {
  void it('answers as usual without an interrupt', async () => {
    const response = await switchTab('1', new AbortController().signal, () =>
      Promise.resolve({ status: 'ok', data: switched })
    );
    assert.equal(response.data?.tab.index, 1);
  });

  void it('says the switch completed when it did before the answer came', async () => {
    const interrupt = new AbortController();
    const error = await thrown(
      switchTab('1', interrupt.signal, () => {
        interrupt.abort('SIGINT');
        return Promise.resolve({ status: 'ok', data: switched });
      })
    );
    assert.equal(error.exitCode, EXIT_CODES.INTERRUPTED);
    assert.match(error.message, /interrupted/i);
    assert.match(error.message, /switch completed: now on tab 1: http:\/\/a\/popup/);
  });

  void it('says the session stays on its tab when the switch failed', async () => {
    const interrupt = new AbortController();
    const error = await thrown(
      switchTab('1', interrupt.signal, () => {
        interrupt.abort('SIGTERM');
        return Promise.resolve({ status: 'error', error: 'Could not switch', exitCode: 101 });
      })
    );
    assert.equal(error.exitCode, EXIT_CODES.TERMINATED);
    assert.match(error.message, /did not switch \(Could not switch\)/);
  });

  void it('sends nothing once interrupted before the request', async () => {
    const interrupt = new AbortController();
    interrupt.abort('SIGINT');
    const send = mock.fn(() => Promise.resolve({ status: 'ok', data: switched }));
    const error = await thrown(switchTab('1', interrupt.signal, send));
    assert.equal(send.mock.callCount(), 0);
    assert.match(error.message, /did not switch/);
  });
});
