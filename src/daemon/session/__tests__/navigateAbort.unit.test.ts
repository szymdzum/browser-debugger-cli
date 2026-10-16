/**
 * The start's navigation ends at once when the session is stopped while
 * Chrome has not answered `Page.navigate` yet (#801): Chrome answers it only
 * when the page's first response arrives, which a slow page sends late and
 * a hung one never.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type WebSocket from 'ws';

import { FakeWebSocket } from '@/__testutils__/FakeWebSocket.js';
import { CDPConnection } from '@/connection/cdp.js';
import { navigateToTarget } from '@/daemon/session/cdpSetup.js';
import type { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import type { SessionConfig } from '@/daemon/session/types.js';
import type { CDPMessage } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';

/**
 * Id of the first command with a method sent over the socket.
 *
 * @param socket - The fake socket
 * @param method - CDP method
 * @returns Its id
 */
function sentIdOf(socket: FakeWebSocket, method: string): number {
  const sent = socket.getSentMessages().map((raw) => JSON.parse(raw) as CDPMessage);
  const message = sent.find((m) => m.method === method);
  assert.ok(message, `${method} was sent`);
  return message.id as number;
}

void describe('navigateToTarget stop', () => {
  void it('rejects at once when the signal aborts while Page.navigate is pending', async () => {
    const socket = new FakeWebSocket();
    const cdp = new CDPConnection(console, () => socket as unknown as WebSocket);
    const connecting = cdp.connect('ws://localhost:9222/devtools/page/1');
    socket.simulateOpen();
    await connecting;
    try {
      const stop = new AbortController();
      const navigation = navigateToTarget(
        cdp,
        { url: 'http://localhost:1/slow', port: 9222 } as SessionConfig,
        {} as TelemetryStore,
        null,
        createLogger('session'),
        stop.signal
      );
      const reason = new Error('stopped');
      stop.abort(reason);
      const outcome = await Promise.race([
        navigation.then(
          () => 'resolved',
          (error: unknown) => error
        ),
        new Promise((resolve) => setTimeout(() => resolve('still waiting for Chrome'), 500)),
      ]);
      assert.equal(outcome, reason);
      const pending = (cdp as unknown as { pendingMessages: Map<number, unknown> }).pendingMessages;
      const navigateId = sentIdOf(socket, 'Page.navigate');
      assert.equal(pending.has(navigateId), false, 'Page.navigate must not stay pending');
    } finally {
      cdp.close();
    }
  });
});
