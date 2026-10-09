/**
 * SessionController: a start whose client disconnects is abandoned.
 */

import * as assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { SessionController } from '@/daemon/SessionController.js';
import { Session, StartCancelledError } from '@/daemon/session/Session.js';
import { IPCErrorCode, type StartSessionRequest } from '@/ipc/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

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
  let stopped = false;
  const launched = new Promise<void>((resolve, reject) => {
    release = () =>
      outcome === 'ok'
        ? resolve()
        : reject(stopped ? new StartCancelledError() : new Error('Chrome failed'));
  });
  const stop = mock.fn(() => {
    stopped = true;
    return Promise.resolve();
  });
  const session = {
    launch: () => launched,
    stop,
    stopRequested: () => stopped,
    info: () => ({ chromePid: 1234, port: 9222, targetUrl: request.url }),
    metadata: () => ({ startTime: Date.now(), bdgPid: process.pid, port: 9222 }),
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

  void it('tells other clients an abandoned start is shutting down while it tears down', async () => {
    const { release } = fakeSession();
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);
    const disconnected = new AbortController();
    const first = controller.startSession(request, disconnected.signal);

    disconnected.abort();
    const second = await controller.startSession({ ...request, sessionId: 'request-2' });
    const status = await controller.status({ type: 'status_request', sessionId: 's' });

    assert.equal(second.errorCode, IPCErrorCode.SESSION_SHUTTING_DOWN);
    assert.equal(status.data?.starting, undefined, 'no longer reported as starting');
    assert.equal(status.data?.ending, true);
    const command = (await controller.command({
      type: 'dom_eval_request',
      sessionId: 's',
      script: '1',
    } as never)) as { error?: string; exitCode?: number };
    assert.equal(command.exitCode, undefined, 'not "still starting" (85)');
    assert.doesNotMatch(command.error ?? '', /still starting/);
    release();
    await first;
  });

  void it('reports a start cancelled by a stop as cancelled, not as a failure', async () => {
    const { release } = fakeSession('fail');
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);

    const response = controller.startSession(request);
    const stopping = controller.stopSession({ type: 'stop_session_request', sessionId: 's' });
    release();
    await stopping;

    const result = await response;
    assert.equal(result.errorCode, IPCErrorCode.SESSION_START_CANCELLED);
  });

  void it('tells a new start that a stopping session is shutting down', async () => {
    const { release } = fakeSession('ok');
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);
    const first = controller.startSession(request);
    release();
    await first;

    const stopping = controller.stopSession({ type: 'stop_session_request', sessionId: 's' });
    const second = await controller.startSession({ ...request, sessionId: 'request-2' });
    await stopping;

    assert.equal(second.errorCode, IPCErrorCode.SESSION_SHUTTING_DOWN);
  });
});

void describe('SessionController while a start is in progress', () => {
  afterEach(() => mock.restoreAll());

  void it('reports the start in status and refuses commands with 85', async () => {
    const { release } = fakeSession();
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);
    const start = controller.startSession(request);

    const status = await controller.status({ type: 'status_request', sessionId: 's' });
    assert.equal(status.data?.starting?.url, request.url);

    const command = (await controller.command({
      type: 'dom_eval_request',
      sessionId: 's',
      script: '1',
    } as never)) as { error?: string; exitCode?: number };
    assert.equal(command.exitCode, EXIT_CODES.RESOURCE_BUSY);
    assert.match(command.error ?? '', /still starting/);

    release();
    await start;
  });
});

void describe('SessionController.command timeouts', () => {
  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  /**
   * Start a fake session whose commands never answer, then time one out.
   *
   * @param fetchInterception - Whether Fetch interception is on
   * @returns The command's response
   */
  async function timedOutReload(
    fetchInterception: boolean
  ): Promise<{ error?: string; exitCode?: number; suggestion?: string }> {
    const session = {
      launch: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      stopRequested: () => false,
      info: () => ({ chromePid: 1234, port: 9222, targetUrl: request.url }),
      metadata: () => ({ startTime: Date.now(), bdgPid: process.pid, port: 9222 }),
      execute: () => new Promise(() => undefined),
      fetchInterceptionEnabled: () => fetchInterception,
    };
    mock.method(Session, 'create', () => session as unknown as Session);
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);
    await controller.startSession(request);
    mock.timers.enable({ apis: ['setTimeout'] });
    const response = controller.command({
      type: 'page_navigate_request',
      sessionId: 's',
      action: 'reload',
    } as never);
    mock.timers.tick(30_000);
    return (await response) as { error?: string; exitCode?: number; suggestion?: string };
  }

  void it('names Fetch interception when a command times out while it is on', async () => {
    const response = await timedOutReload(true);
    assert.match(
      response.error ?? '',
      /^Command timeout \(30s\): Fetch interception may be enabled/
    );
    assert.equal(response.exitCode, EXIT_CODES.CDP_TIMEOUT);
    assert.match(response.suggestion ?? '', /bdg cdp Fetch\.disable/);
  });

  void it('leaves other timeouts as they were', async () => {
    const response = await timedOutReload(false);
    assert.equal(response.error, 'Command timeout (30s)');
    assert.equal(response.suggestion, undefined);
  });
});
