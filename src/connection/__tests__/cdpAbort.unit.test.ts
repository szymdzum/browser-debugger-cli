/**
 * A CDP command sent with an abort signal stops waiting when the signal
 * aborts (#801): it rejects with the signal's reason at once, and its pending
 * entry and timeout are removed, so nothing is left waiting for an answer
 * the caller no longer wants.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type WebSocket from 'ws';

import { FakeWebSocket } from '@/__testutils__/FakeWebSocket.js';
import { CDPConnection } from '@/connection/cdp.js';

/**
 * A connection over a fake socket that is open and never answers.
 *
 * @returns The connection and its socket
 */
async function openConnection(): Promise<{ cdp: CDPConnection; socket: FakeWebSocket }> {
  const socket = new FakeWebSocket();
  const cdp = new CDPConnection(console, () => socket as unknown as WebSocket);
  const connecting = cdp.connect('ws://localhost:9222/devtools/page/1');
  socket.simulateOpen();
  await connecting;
  return { cdp, socket };
}

/**
 * Number of commands still waiting for an answer.
 *
 * @param cdp - The connection
 * @returns Its pending command count
 */
function pendingCount(cdp: CDPConnection): number {
  return (cdp as unknown as { pendingMessages: Map<number, unknown> }).pendingMessages.size;
}

/**
 * Settle a promise or report it still pending after a short wait.
 *
 * @param promise - Promise to observe
 * @returns Its rejection reason, `'resolved'` or `'pending'`
 */
async function outcomeOf(promise: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    promise.then(
      () => 'resolved',
      (error: unknown) => error
    ),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 500)),
  ]);
}

void describe('CDPConnection send with an abort signal', () => {
  void it('rejects with the reason and drops the pending command when the signal aborts', async () => {
    const { cdp } = await openConnection();
    try {
      const stop = new AbortController();
      const pending = cdp.send(
        'Page.navigate',
        { url: 'http://localhost/' },
        undefined,
        stop.signal
      );
      assert.equal(pendingCount(cdp), 1);
      const reason = new Error('stopped');
      stop.abort(reason);
      assert.equal(await outcomeOf(pending), reason);
      assert.equal(pendingCount(cdp), 0, 'the aborted command must not stay pending');
    } finally {
      cdp.close();
    }
  });

  void it('does not send a command whose signal already aborted', async () => {
    const { cdp, socket } = await openConnection();
    try {
      const sentBefore = socket.getSentMessages().length;
      const reason = new Error('stopped');
      const outcome = await outcomeOf(
        cdp.send('Page.navigate', {}, undefined, AbortSignal.abort(reason))
      );
      assert.equal(outcome, reason);
      assert.equal(socket.getSentMessages().length, sentBefore);
      assert.equal(pendingCount(cdp), 0);
    } finally {
      cdp.close();
    }
  });
});
