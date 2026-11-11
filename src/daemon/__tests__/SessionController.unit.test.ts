/**
 * SessionController: a start whose client disconnects is abandoned.
 */

import * as assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { SessionController } from '@/daemon/SessionController.js';
import { Session, StartCancelledError } from '@/daemon/session/Session.js';
import { IPCErrorCode, type StartSessionRequest } from '@/ipc/index.js';
import { trackPendingDocument } from '@/runtime/page/pendingDocument.js';
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
 * @param metadata - Extra session metadata fields
 * @returns Controls of the fake session
 */
function fakeSession(
  outcome: 'ok' | 'fail' = 'ok',
  metadata: Record<string, unknown> = {}
): {
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
    metadata: () => ({ startTime: Date.now(), bdgPid: process.pid, port: 9222, ...metadata }),
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

  void it('reports the starting URL without its credentials (#757)', async () => {
    const { release } = fakeSession();
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);
    const start = controller.startSession({
      ...request,
      url: 'http://user:SECRETPW@localhost:1/?token=SECRETPW',
    });

    const status = await controller.status({ type: 'status_request', sessionId: 's' });
    assert.equal(status.data?.starting?.url, 'http://localhost:1/?token=••••');

    release();
    await start;
  });

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
  let stopTracking: (() => void) | undefined;

  afterEach(() => {
    stopTracking?.();
    stopTracking = undefined;
    mock.timers.reset();
    mock.restoreAll();
  });

  /** A command's failure fields */
  type CommandResponse = {
    status?: string;
    error?: string;
    exitCode?: number;
    suggestion?: string;
  };

  /**
   * Start a controller on a fake session.
   *
   * @param execute - The session's command handler
   * @param fetchInterception - Whether Fetch interception is on
   * @returns The controller, with `setTimeout` mocked from here on
   */
  async function startController(
    execute: () => Promise<unknown>,
    fetchInterception = false
  ): Promise<SessionController> {
    const session = {
      launch: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      stopRequested: () => false,
      info: () => ({ chromePid: 1234, port: 9222, targetUrl: request.url }),
      metadata: () => ({ startTime: Date.now(), bdgPid: process.pid, port: 9222 }),
      execute,
      fetchInterceptionEnabled: () => fetchInterception,
      takeTabMoveNotice: () => undefined,
    };
    mock.method(Session, 'create', () => session as unknown as Session);
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);
    await controller.startSession(request);
    mock.timers.enable({ apis: ['setTimeout'] });
    return controller;
  }

  /**
   * Follow the main frame's document requests on a fake page connection.
   *
   * @returns Emits a CDP event on the fake connection
   */
  async function trackFakeDocuments(): Promise<(event: string, params: unknown) => void> {
    const handlers = new Map<string, (params: unknown) => void>();
    const cdp = {
      on: (event: string, handler: (params: unknown) => void) => {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      },
      send: (method: string) =>
        Promise.resolve(
          method === 'Target.getTargetInfo'
            ? { targetInfo: { targetId: 'main', type: 'page', url: 'http://127.0.0.1/' } }
            : {}
        ),
    };
    stopTracking = await trackPendingDocument(cdp as unknown as CDPConnection);
    return (event, params) => handlers.get(event)?.(params);
  }

  /**
   * Start the main frame's navigation to `/orders`, which gets no answer.
   *
   * @param emit - Emits on the fake page connection
   */
  function startPendingNavigation(emit: (event: string, params: unknown) => void): void {
    emit('Network.requestWillBeSent', {
      requestId: 'orders',
      type: 'Document',
      frameId: 'main',
      request: { url: 'http://127.0.0.1/orders' },
    });
  }

  /**
   * Send a reload request.
   *
   * @param controller - Controller
   * @returns The response
   */
  function reload(controller: SessionController): Promise<CommandResponse> {
    return controller.command({
      type: 'page_navigate_request',
      sessionId: 's',
      action: 'reload',
    } as never) as Promise<CommandResponse>;
  }

  /**
   * Let resolved promises run their callbacks.
   */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  }

  void it('names Fetch interception when a command times out while it is on', async () => {
    const controller = await startController(() => new Promise(() => undefined), true);
    const response = reload(controller);
    mock.timers.tick(30_000);
    const result = await response;
    assert.match(result.error ?? '', /^Command timeout \(30s\): Fetch interception may be enabled/);
    assert.equal(result.exitCode, EXIT_CODES.CDP_TIMEOUT);
    assert.match(result.suggestion ?? '', /bdg cdp Fetch\.disable/);
  });

  void it('exits 102 with a suggestion when a command times out (#946)', async () => {
    const controller = await startController(() => new Promise(() => undefined));
    const response = reload(controller);
    mock.timers.tick(30_000);
    const result = await response;
    assert.equal(result.error, 'Command timeout (30s)');
    assert.equal(result.exitCode, EXIT_CODES.CDP_TIMEOUT);
    assert.ok(result.suggestion, 'a suggestion');
  });

  void it('names a navigation that started during the command when it times out (#946)', async () => {
    const emit = await trackFakeDocuments();
    const controller = await startController(() => new Promise(() => undefined));
    const response = reload(controller);
    startPendingNavigation(emit);
    mock.timers.tick(30_000);
    const result = await response;
    assert.match(result.error ?? '', /still waiting for the server to respond to .*\/orders/);
    assert.equal(result.exitCode, EXIT_CODES.CDP_TIMEOUT);
    assert.ok(result.suggestion, 'a suggestion');
  });

  void it('fails fast on a navigation already pending when the command starts (#946)', async () => {
    const emit = await trackFakeDocuments();
    startPendingNavigation(emit);
    const controller = await startController(() => new Promise(() => undefined));
    let result: CommandResponse | undefined;
    const response = (
      controller.command({
        type: 'dom_click_request',
        sessionId: 's',
        selector: '#help',
      } as never) as Promise<CommandResponse>
    ).then((r) => (result = r));
    mock.timers.tick(10_000);
    await flush();
    assert.ok(result, 'failed before the 30 s command timeout');
    assert.match(result.error ?? '', /still waiting for the server to respond to .*\/orders/);
    assert.equal(result.exitCode, EXIT_CODES.CDP_TIMEOUT);
    mock.timers.tick(30_000);
    await response;
  });

  /**
   * Send a command and check it is still running 10 s later (past the
   * fail-fast grace), then let the 30 s command timeout end it.
   *
   * @param controller - Controller
   * @param request - Request fields besides `sessionId`
   * @returns The response after the command timeout
   */
  async function waitsPastGrace(
    controller: SessionController,
    request: Record<string, unknown>
  ): Promise<CommandResponse> {
    let result: CommandResponse | undefined;
    const response = (
      controller.command({ sessionId: 's', ...request } as never) as Promise<CommandResponse>
    ).then((r) => (result = r));
    mock.timers.tick(10_000);
    await flush();
    assert.equal(result, undefined, `failed fast: ${JSON.stringify(result)}`);
    mock.timers.tick(30_000);
    return response;
  }

  const exempt: Array<[string, Record<string, unknown>]> = [
    ['cdp_call', { type: 'cdp_call_request', method: 'Runtime.evaluate' }],
    ['cdp_events', { type: 'cdp_events_request', waitMs: 0 }],
    ['page navigate', { type: 'page_navigate_request', action: 'navigate', url: 'http://x/' }],
    ['page reload', { type: 'page_navigate_request', action: 'reload' }],
  ];
  for (const [label, request] of exempt) {
    void it(`does not fail ${label} fast on a pending navigation (#946)`, async () => {
      const emit = await trackFakeDocuments();
      startPendingNavigation(emit);
      const controller = await startController(() => new Promise(() => undefined));
      const result = await waitsPastGrace(controller, request);
      assert.equal(result.exitCode, EXIT_CODES.CDP_TIMEOUT);
    });
  }

  void it('does not fail fast while Fetch interception is on (#946)', async () => {
    const emit = await trackFakeDocuments();
    startPendingNavigation(emit);
    const controller = await startController(() => new Promise(() => undefined), true);
    const result = await waitsPastGrace(controller, {
      type: 'dom_click_request',
      selector: '#help',
    });
    assert.match(result.error ?? '', /Fetch interception may be enabled/);
    assert.equal(result.exitCode, EXIT_CODES.CDP_TIMEOUT);
  });

  void it('lets the command run when a newer navigation replaced the held one (#946)', async () => {
    const emit = await trackFakeDocuments();
    startPendingNavigation(emit);
    let answer = (): void => undefined;
    const controller = await startController(
      () => new Promise<unknown>((resolve) => (answer = () => resolve({ clicked: true })))
    );
    const response = controller.command({
      type: 'dom_click_request',
      sessionId: 's',
      selector: '#help',
    } as never) as Promise<CommandResponse>;
    emit('Network.requestWillBeSent', {
      requestId: 'help',
      type: 'Document',
      frameId: 'main',
      request: { url: 'http://127.0.0.1/help' },
    });
    mock.timers.tick(10_000);
    await flush();
    answer();
    const result = await response;
    assert.equal(result.status, 'ok', JSON.stringify(result));
  });

  void it('lets the command run when the pending navigation answers soon (#946)', async () => {
    const emit = await trackFakeDocuments();
    startPendingNavigation(emit);
    let answer = (): void => undefined;
    const controller = await startController(
      () => new Promise<unknown>((resolve) => (answer = () => resolve({ reloaded: true })))
    );
    const response = controller.command({
      type: 'dom_click_request',
      sessionId: 's',
      selector: '#help',
    } as never) as Promise<CommandResponse>;
    mock.timers.tick(2_000);
    emit('Network.responseReceived', { requestId: 'orders' });
    mock.timers.tick(10_000);
    await flush();
    answer();
    const result = await response;
    assert.equal(result.status, 'ok', JSON.stringify(result));
  });
});

void describe('SessionController: a command timeout longer than a timer can wait (#617)', () => {
  afterEach(() => mock.restoreAll());

  /** Longest delay Node's `setTimeout` takes; a longer one fires after 1 ms */
  const MAX_TIMER_DELAY_MS = 2_147_483_647;

  void it('gives the timer the longest delay, so the command does not time out at once', async () => {
    let answer = (): void => undefined;
    const session = {
      launch: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      stopRequested: () => false,
      info: () => ({ chromePid: 1234, port: 9222, targetUrl: request.url }),
      metadata: () => ({ startTime: Date.now(), bdgPid: process.pid, port: 9222 }),
      execute: () =>
        new Promise((resolve) => {
          answer = () => resolve({ found: true });
        }),
      fetchInterceptionEnabled: () => false,
      takeTabMoveNotice: () => undefined,
    };
    mock.method(Session, 'create', () => session as unknown as Session);
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);
    await controller.startSession(request);
    const timers = mock.method(globalThis, 'setTimeout');

    const response = controller.command({
      type: 'dom_wait_request',
      sessionId: 's',
      selector: '#late',
      timeout: 3_000_000_000,
    } as never);
    const delays = timers.mock.calls.map((call) => call.arguments[1] as number);
    answer();

    assert.equal(((await response) as { status: string }).status, 'ok');
    assert.ok(delays.length > 0, 'the command has a timer');
    assert.ok(
      delays.every((delay) => delay <= MAX_TIMER_DELAY_MS),
      `timer delays ${delays.join(', ')} exceed ${MAX_TIMER_DELAY_MS} ms`
    );
  });
});

void describe('SessionController: a move no command reported yet', () => {
  afterEach(() => mock.restoreAll());

  const moved = {
    tabClosed: { targetId: 'P', url: 'http://a/popup', title: 'Popup' },
    switchedTo: { index: 0, targetId: 'A', url: 'http://a/', title: 'App' },
  };

  /**
   * Start a fake session with a move to report once.
   *
   * @param execute - What its commands do
   * @returns Controller
   */
  async function controllerWithMove(execute: () => Promise<unknown>): Promise<SessionController> {
    let pending: typeof moved | undefined = moved;
    const session = {
      launch: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      stopRequested: () => false,
      info: () => ({ chromePid: 1234, port: 9222, targetUrl: request.url }),
      metadata: () => ({ startTime: Date.now(), bdgPid: process.pid, port: 9222 }),
      execute,
      fetchInterceptionEnabled: () => false,
      takeTabMoveNotice: () => {
        const notice = pending;
        pending = undefined;
        return notice;
      },
    };
    mock.method(Session, 'create', () => session as unknown as Session);
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);
    await controller.startSession(request);
    return controller;
  }

  void it('puts it on the next command response, once', async () => {
    const controller = await controllerWithMove(() => Promise.resolve({ result: 1 }));
    const command = { type: 'dom_eval_request', sessionId: 's', script: '1' } as never;

    const first = (await controller.command(command)) as { tabMoved?: unknown };
    const second = (await controller.command(command)) as { tabMoved?: unknown };

    assert.deepEqual(first.tabMoved, moved);
    assert.equal(second.tabMoved, undefined);
  });

  void it('puts it on a failed command too', async () => {
    const controller = await controllerWithMove(() => Promise.reject(new Error('No nodes')));

    const response = (await controller.command({
      type: 'dom_eval_request',
      sessionId: 's',
      script: '1',
    } as never)) as { status: string; tabMoved?: unknown };

    assert.equal(response.status, 'error');
    assert.deepEqual(response.tabMoved, moved);
  });

  void it('puts it on peek and status only when asked to', async () => {
    const controller = await controllerWithMove(() =>
      Promise.resolve({
        version: '0',
        startTime: Date.now(),
        duration: 0,
        target: { url: 'http://a/', title: '' },
        activeTelemetry: [],
        currentNavigationId: 0,
        network: [],
        console: [],
        totalNetwork: 0,
        totalConsole: 0,
        hasMoreNetwork: false,
        hasMoreConsole: false,
        activity: {},
        navigationId: 0,
      })
    );

    const quiet = await controller.peek({ type: 'peek_request', sessionId: 's' });
    const quietStatus = await controller.status({ type: 'status_request', sessionId: 's' });
    const told = await controller.peek({ type: 'peek_request', sessionId: 's', tabMove: true });

    assert.equal((quiet as { tabMoved?: unknown }).tabMoved, undefined);
    assert.equal((quietStatus as { tabMoved?: unknown }).tabMoved, undefined);
    assert.deepEqual((told as { tabMoved?: unknown }).tabMoved, moved);
  });
});

void describe('SessionController.peek timestamp (#727)', () => {
  const sessionStart = Date.now() - 60000;

  afterEach(() => {
    mock.restoreAll();
  });

  /**
   * Wait until the clock has moved past a given instant.
   *
   * @param instant - Epoch ms to pass
   */
  async function passTime(instant: number): Promise<void> {
    while (Date.now() <= instant) await new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Start a fake session started a minute ago and peek once.
   *
   * @param controller - Controller to peek through
   * @returns The preview timestamp as epoch ms, and the window of the call
   */
  async function peekTimestamp(
    controller: SessionController
  ): Promise<{ at: number; before: number; after: number }> {
    const before = Date.now();
    const response = await controller.peek({ type: 'peek_request', sessionId: 's' });
    const after = Date.now();
    const preview = (response.data as { preview: { timestamp: string } }).preview;
    return { at: Date.parse(preview.timestamp), before, after };
  }

  void it('is the time of the snapshot, not the start of the session', async () => {
    const session = {
      launch: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      stopRequested: () => false,
      info: () => ({ chromePid: 1234, port: 9222, targetUrl: request.url }),
      metadata: () => ({ startTime: sessionStart, bdgPid: process.pid, port: 9222 }),
      execute: () =>
        Promise.resolve({
          version: '0',
          startTime: sessionStart,
          duration: Date.now() - sessionStart,
          target: { url: 'http://a/', title: '' },
          activeTelemetry: [],
          currentNavigationId: 0,
          network: [],
          console: [],
          totalNetwork: 0,
          totalConsole: 0,
          hasMoreNetwork: false,
          hasMoreConsole: false,
          activity: {},
          navigationId: 0,
        }),
      fetchInterceptionEnabled: () => false,
      takeTabMoveNotice: () => undefined,
    };
    mock.method(Session, 'create', () => session as unknown as Session);
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);
    await controller.startSession(request);

    const first = await peekTimestamp(controller);
    await passTime(first.after);
    const second = await peekTimestamp(controller);

    assert.notEqual(first.at, sessionStart);
    assert.ok(first.at >= first.before && first.at <= first.after, 'first within its call');
    assert.ok(second.at >= second.before && second.at <= second.after, 'second within its call');
    assert.ok(second.at > first.at, 'the second peek is later than the first');
  });
});

void describe('SessionController target mismatch (#757)', () => {
  afterEach(() => mock.restoreAll());

  void it('names both Chrome endpoints without their credentials', async () => {
    const { release } = fakeSession('ok', {
      webSocketDebuggerUrl: 'ws://u:Zq7SECRETxx@127.0.0.1:9222/devtools/page/a',
    });
    const controller = new SessionController(Date.now(), '/tmp/test.sock', () => undefined);
    const first = controller.startSession({
      ...request,
      chromeWsUrl: 'ws://127.0.0.1:9222/devtools/browser/a',
    });
    release();
    await first;

    const second = await controller.startSession({
      ...request,
      sessionId: 'request-2',
      chromeWsUrl: 'ws://u:Zq7SECRETxx@127.0.0.2:9222/devtools/browser/b',
    });

    assert.equal(second.errorCode, IPCErrorCode.SESSION_TARGET_MISMATCH);
    assert.doesNotMatch(JSON.stringify(second), /Zq7SECRETxx/);
    assert.match(second.message ?? '', /127\.0\.0\.1:9222.*127\.0\.0\.2:9222/);
  });
});
