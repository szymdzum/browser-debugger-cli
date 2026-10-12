/**
 * A CDP response that cannot be parsed rejects its pending command at once
 * instead of leaving it to wait out the command timeout (#687).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type WebSocket from 'ws';

import { FakeWebSocket } from '@/__testutils__/FakeWebSocket.js';
import { CDPConnection } from '@/connection/cdp.js';
import type { CDPMessage } from '@/types.js';

/**
 * A connection over a fake socket that is open.
 *
 * @returns The connection and its socket
 */
async function openConnection(): Promise<{ cdp: CDPConnection; socket: FakeWebSocket }> {
  const socket = new FakeWebSocket();
  const cdp = new CDPConnection(console, () => socket as unknown as WebSocket);
  const connecting = cdp.connect('ws://localhost:9222/devtools/browser');
  socket.simulateOpen();
  await connecting;
  return { cdp, socket };
}

/**
 * Id of the most recent command sent over the socket.
 *
 * @param socket - The fake socket
 * @returns Its id
 */
function lastSentId(socket: FakeWebSocket): number {
  const sent = socket.getSentMessages();
  const last = sent[sent.length - 1];
  assert.ok(last, 'a command was sent');
  return (JSON.parse(last) as CDPMessage).id as number;
}

void describe('CDPConnection unparsable response', () => {
  void it('rejects the pending command with the parse failure, not the timeout', async () => {
    const { cdp, socket } = await openConnection();
    try {
      const pending = cdp.send('Runtime.evaluate', { expression: '1' });
      const outcome = assert.rejects(pending, /CDP response could not be parsed/);
      socket.simulateMessage(`{"id":${lastSentId(socket)},"result":{"result":{"type":"str`);
      await outcome;
    } finally {
      cdp.close();
    }
  });

  void it('leaves other pending commands waiting', async () => {
    const { cdp, socket } = await openConnection();
    try {
      const first = cdp.send('Target.getTargets');
      const firstId = lastSentId(socket);
      const second = cdp.send('Runtime.evaluate', { expression: '1' });
      const secondOutcome = assert.rejects(second, /CDP response could not be parsed/);
      socket.simulateMessage(`{"id":${lastSentId(socket)},"result":{broken`);
      await secondOutcome;
      socket.simulateMessage(JSON.stringify({ id: firstId, result: { targetInfos: [] } }));
      assert.deepEqual(await first, { targetInfos: [] });
    } finally {
      cdp.close();
    }
  });
});
