/**
 * A connection to the browser endpoint with a default page session (#473,
 * `bdg attach`): commands without a session id go to the page session, the
 * page session's events reach handlers as page events, the browser itself is
 * reached with `sendToBrowser`, and the page session detaching (tab closed)
 * ends the connection for the session like a closed page socket.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type WebSocket from 'ws';

import { FakeWebSocket } from '@/__testutils__/FakeWebSocket.js';
import { CDPConnection } from '@/connection/cdp.js';
import type { CDPMessage } from '@/types.js';

const PAGE_SESSION = 'PAGE-SESSION';

/**
 * A connection over an open fake socket, with its default page session set.
 *
 * @param onDisconnect - Receives a disconnect
 * @returns The connection and its socket
 */
async function openAttached(
  onDisconnect: () => void = () => undefined
): Promise<{ cdp: CDPConnection; socket: FakeWebSocket }> {
  const socket = new FakeWebSocket();
  const cdp = new CDPConnection(console, () => socket as unknown as WebSocket);
  const connecting = cdp.connect('ws://127.0.0.1:9222/devtools/browser/x', { onDisconnect });
  socket.simulateOpen();
  await connecting;
  try {
    cdp.useDefaultSession(PAGE_SESSION);
  } catch (error) {
    cdp.close();
    throw error;
  }
  return { cdp, socket };
}

/**
 * The last message sent over the socket.
 *
 * @param socket - The fake socket
 * @returns The message
 */
function lastSent(socket: FakeWebSocket): CDPMessage {
  const sent = socket.getSentMessages();
  const last = sent[sent.length - 1];
  assert.ok(last, 'a command was sent');
  return JSON.parse(last) as CDPMessage;
}

void describe('CDPConnection default page session', () => {
  void it('sends a command without a session id to the page session', async () => {
    const { cdp, socket } = await openAttached();
    try {
      const reply = cdp.send('Runtime.evaluate', { expression: '1' });
      const message = lastSent(socket);
      assert.equal(message.sessionId, PAGE_SESSION);
      socket.simulateMessage(JSON.stringify({ id: message.id, result: { ok: true } }));
      assert.deepEqual(await reply, { ok: true });
    } finally {
      cdp.close();
    }
  });

  void it('keeps an explicit session id (iframes, workers)', async () => {
    const { cdp, socket } = await openAttached();
    try {
      void cdp.send('Runtime.enable', {}, 'CHILD').catch(() => undefined);
      assert.equal(lastSent(socket).sessionId, 'CHILD');
    } finally {
      cdp.close();
    }
  });

  void it('sends browser commands without a session id', async () => {
    const { cdp, socket } = await openAttached();
    try {
      void cdp.sendToBrowser('Target.getTargets').catch(() => undefined);
      const message = lastSent(socket);
      assert.equal(message.method, 'Target.getTargets');
      assert.equal(message.sessionId, undefined);
    } finally {
      cdp.close();
    }
  });

  void it('delivers page session events as page events and child events unchanged', async () => {
    const { cdp, socket } = await openAttached();
    try {
      const seen: (string | undefined)[] = [];
      cdp.on('Runtime.consoleAPICalled', (_params, sessionId) => seen.push(sessionId ?? 'page'));
      const event = { method: 'Runtime.consoleAPICalled', params: {} };
      socket.simulateMessage(JSON.stringify({ ...event, sessionId: PAGE_SESSION }));
      socket.simulateMessage(JSON.stringify({ ...event, sessionId: 'CHILD' }));
      socket.simulateMessage(JSON.stringify(event));
      assert.deepEqual(seen, ['page', 'CHILD']);
      const downloads: (string | undefined)[] = [];
      cdp.on('Browser.downloadWillBegin', (_params, sessionId) =>
        downloads.push(sessionId ?? 'browser')
      );
      socket.simulateMessage(JSON.stringify({ method: 'Browser.downloadWillBegin', params: {} }));
      assert.deepEqual(downloads, ['browser']);
    } finally {
      cdp.close();
    }
  });

  void it('reports a closed tab when the page session detaches and the tab is gone', async () => {
    let disconnected = 0;
    const { cdp, socket } = await openAttached(() => void disconnected++);
    try {
      socket.simulateMessage(
        JSON.stringify({
          method: 'Target.detachedFromTarget',
          params: { sessionId: 'OTHER', targetId: 'T2' },
        })
      );
      assert.equal(socket.getSentMessages().length, 0);
      await detach(socket, []);
      assert.equal(disconnected, 1);
      assert.equal(cdp.pageSessionEnded, true);
      await assert.rejects(cdp.send('Runtime.evaluate'), /Not connected/);
    } finally {
      cdp.close();
    }
  });

  void it('does not report a closed tab when the browser still lists it', async () => {
    let disconnected = 0;
    const { cdp, socket } = await openAttached(() => void disconnected++);
    try {
      await detach(socket, [{ targetId: 'T1' }]);
      assert.equal(disconnected, 1);
      assert.equal(cdp.pageSessionEnded, false);
    } finally {
      cdp.close();
    }
  });

  void it('leaves a browser that goes away to the socket loss (not a closed tab)', async () => {
    let disconnected = 0;
    const { cdp, socket } = await openAttached(() => void disconnected++);
    socket.simulateMessage(
      JSON.stringify({
        method: 'Target.detachedFromTarget',
        params: { sessionId: PAGE_SESSION, targetId: 'T1' },
      })
    );
    socket.simulateClose(1006, 'gone');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(disconnected, 1);
    assert.equal(cdp.pageSessionEnded, false);
  });
});

/**
 * Detach the page session and answer the tab check.
 *
 * @param socket - The fake socket
 * @param targetInfos - What `Target.getTargets` lists
 */
async function detach(socket: FakeWebSocket, targetInfos: { targetId: string }[]): Promise<void> {
  socket.simulateMessage(
    JSON.stringify({
      method: 'Target.detachedFromTarget',
      params: { sessionId: PAGE_SESSION, targetId: 'T1' },
    })
  );
  const check = lastSent(socket);
  assert.equal(check.method, 'Target.getTargets');
  assert.equal(check.sessionId, undefined);
  socket.simulateMessage(JSON.stringify({ id: check.id, result: { targetInfos } }));
  await new Promise((resolve) => setImmediate(resolve));
}
