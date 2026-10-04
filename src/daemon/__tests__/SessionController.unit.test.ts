/**
 * SessionController: a start whose client disconnects is abandoned.
 */

import * as assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { SessionController } from '@/daemon/SessionController.js';
import { Session } from '@/daemon/session/Session.js';
import type { StartSessionRequest } from '@/ipc/index.js';

const request: StartSessionRequest = {
  type: 'start_session_request',
  sessionId: 'request-1',
  url: 'http://example.com/',
};

/**
 * Replace `Session.create` with a session whose launch waits for `release`.
 *
 * @param outcome - Whether the launch then succeeds or fails
 * @returns Controls of the fake session
 */
function fakeSession(outcome: 'ok' | 'fail' = 'ok'): {
  stop: ReturnType<typeof mock.fn>;
  release: () => void;
} {
  let release = (): void => undefined;
  const launched = new Promise<void>((resolve, reject) => {
    release = () => (outcome === 'ok' ? resolve() : reject(new Error('stopped during startup')));
  });
  const stop = mock.fn(() => Promise.resolve());
  const session = {
    launch: () => launched,
    stop,
    info: () => ({ chromePid: 1234, port: 9222, targetUrl: request.url }),
  };
  mock.method(Session, 'create', () => session as unknown as Session);
  return { stop, release };
}

void describe('SessionController.startSession', () => {
  afterEach(() => mock.restoreAll());

  void it('stops a session whose client disconnected during the launch', async () => {
    const { stop, release } = fakeSession();
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);
    const disconnected = new AbortController();

    const response = controller.startSession(request, disconnected.signal);
    disconnected.abort();
    assert.equal(stop.mock.callCount(), 1, 'stopped while still launching');

    release();
    await response;
    assert.ok(stop.mock.callCount() >= 2, 'stopped again once the launch finished');
  });

  void it('keeps the session of a client that stays connected', async () => {
    const { stop, release } = fakeSession();
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);

    const response = controller.startSession(request, new AbortController().signal);
    release();

    assert.equal((await response).status, 'ok');
    assert.equal(stop.mock.callCount(), 0);
  });

  void it('ends the daemon once when an abandoned launch fails', async () => {
    const { release } = fakeSession('fail');
    const ended = mock.fn();
    const controller = new SessionController(Date.now(), '/tmp/test.sock', ended);
    const disconnected = new AbortController();

    const response = controller.startSession(request, disconnected.signal);
    disconnected.abort();
    release();

    assert.equal((await response).status, 'error');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ended.mock.callCount(), 1);
  });
});
