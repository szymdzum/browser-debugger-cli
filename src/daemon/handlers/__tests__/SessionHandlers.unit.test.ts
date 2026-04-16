/**
 * SessionHandlers Unit Tests — focused on the probe-gated state machine
 * introduced for issue #221.
 *
 * Testing philosophy:
 * - Test BEHAVIOR: "mismatch yields SESSION_TARGET_MISMATCH, not SESSION_ALREADY_RUNNING"
 * - Mock the BOUNDARY: ISessionService (filesystem/process), WorkerManager (spawn),
 *   and global.fetch (CDP HTTP probe).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { SessionHandlers } from '@/daemon/handlers/SessionHandlers.js';
import type { WorkerManager } from '@/daemon/server/WorkerManager.js';
import type { ISessionService } from '@/daemon/services/SessionService.js';
import { IPCErrorCode, type StartSessionRequest, type StartSessionResponse } from '@/ipc/index.js';
import type { SessionMetadata } from '@/session/metadata.js';

type FakeSessionService = {
  [K in keyof ISessionService]: ReturnType<typeof mock.fn>;
};

function makeSessionService(
  overrides: Partial<Record<keyof ISessionService, unknown>> = {}
): FakeSessionService {
  const defaults: Record<keyof ISessionService, unknown> = {
    readPid: () => null,
    writePid: () => undefined,
    readMetadata: () => null,
    writeMetadata: () => undefined,
    isProcessAlive: () => false,
    cleanup: () => undefined,
    forceRecoverStaleSession: () => Promise.resolve(),
    acquireLock: () => undefined,
    releaseLock: () => undefined,
    getFilePath: () => '/tmp/fake',
  };

  const impls = { ...defaults, ...overrides } as Record<keyof ISessionService, unknown>;
  const mocks: Partial<FakeSessionService> = {};
  for (const key of Object.keys(impls) as (keyof ISessionService)[]) {
    mocks[key] = mock.fn(impls[key] as (...args: unknown[]) => unknown);
  }
  return mocks as FakeSessionService;
}

type FakeWorkerManager = WorkerManager & {
  launch: ReturnType<typeof mock.fn>;
  dispose: ReturnType<typeof mock.fn>;
};

function makeWorkerManager(
  launchImpl: (...args: unknown[]) => Promise<unknown>
): FakeWorkerManager {
  return {
    launch: mock.fn(launchImpl),
    dispose: mock.fn(() => undefined),
  } as unknown as FakeWorkerManager;
}

const successfulLaunch = (): Promise<unknown> =>
  Promise.resolve({
    workerPid: 5000,
    chromePid: 5001,
    port: 9222,
    targetUrl: 'http://example.com',
    targetTitle: 'Example',
    workerProcess: {},
  });

function makeRequest(overrides: Partial<StartSessionRequest> = {}): StartSessionRequest {
  return {
    type: 'start_session_request',
    sessionId: 'req-1',
    url: 'http://example.com',
    ...overrides,
  };
}

function metadata(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    bdgPid: 1234,
    startTime: Date.now() - 60_000,
    port: 9222,
    ...overrides,
  };
}

function aliveFetchStub() {
  return (_url: unknown) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: 'tgt-1',
            title: 't',
            url: 'http://example.com',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tgt-1',
          },
        ]),
    }) as unknown as Promise<Response>;
}

function deadFetchStub() {
  return (_url: unknown) =>
    Promise.reject(new Error('ECONNREFUSED')) as unknown as Promise<Response>;
}

void describe('SessionHandlers.handleStartSession — probe-gated state machine', () => {
  let originalFetch: typeof global.fetch;
  let sentResponses: unknown[];
  let sendResponse: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    originalFetch = global.fetch;
    sentResponses = [];
    sendResponse = mock.fn((_socket: unknown, response: unknown) => {
      sentResponses.push(response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  void it('launches cleanly when no prior session exists', async () => {
    global.fetch = aliveFetchStub() as unknown as typeof global.fetch;
    const service = makeSessionService();
    const worker = makeWorkerManager(successfulLaunch);
    const handler = new SessionHandlers(
      worker,
      service as unknown as ISessionService,
      sendResponse as unknown as (socket: unknown, response: unknown) => void
    );

    await handler.handleStartSession({} as never, makeRequest());

    assert.equal(worker.launch.mock.callCount(), 1);
    assert.equal(service.forceRecoverStaleSession.mock.callCount(), 0);
    const response = sentResponses[0] as StartSessionResponse;
    assert.equal(response.status, 'ok');
    assert.equal(response.data?.recovered, undefined);
  });

  void it('returns SESSION_ALREADY_RUNNING when probe confirms same target (launched mode)', async () => {
    global.fetch = aliveFetchStub() as unknown as typeof global.fetch;
    const service = makeSessionService({
      readPid: () => 4242,
      isProcessAlive: () => true,
      readMetadata: () => metadata({ targetId: 'tgt-1' }),
    });
    const worker = makeWorkerManager(successfulLaunch);
    const handler = new SessionHandlers(
      worker,
      service as unknown as ISessionService,
      sendResponse as unknown as (socket: unknown, response: unknown) => void
    );

    await handler.handleStartSession({} as never, makeRequest());

    assert.equal(worker.launch.mock.callCount(), 0, 'should not launch a new worker');
    const response = sentResponses[0] as StartSessionResponse;
    assert.equal(response.status, 'error');
    assert.equal(response.errorCode, IPCErrorCode.SESSION_ALREADY_RUNNING);
  });

  void it('returns SESSION_ALREADY_RUNNING when probe confirms same ws URL (attach mode)', async () => {
    global.fetch = aliveFetchStub() as unknown as typeof global.fetch;
    const ws = 'ws://127.0.0.1:9222/devtools/browser/shared';
    const service = makeSessionService({
      readPid: () => 4242,
      isProcessAlive: () => true,
      readMetadata: () => metadata({ webSocketDebuggerUrl: ws }),
    });
    const worker = makeWorkerManager(successfulLaunch);
    const handler = new SessionHandlers(
      worker,
      service as unknown as ISessionService,
      sendResponse as unknown as (socket: unknown, response: unknown) => void
    );

    await handler.handleStartSession({} as never, makeRequest({ chromeWsUrl: ws }));

    const response = sentResponses[0] as StartSessionResponse;
    assert.equal(response.errorCode, IPCErrorCode.SESSION_ALREADY_RUNNING);
    assert.equal(worker.launch.mock.callCount(), 0);
  });

  void it('returns SESSION_TARGET_MISMATCH when live session is attached to a different ws URL', async () => {
    global.fetch = aliveFetchStub() as unknown as typeof global.fetch;
    const service = makeSessionService({
      readPid: () => 4242,
      isProcessAlive: () => true,
      readMetadata: () =>
        metadata({ webSocketDebuggerUrl: 'ws://host-a:9222/devtools/browser/abc' }),
    });
    const worker = makeWorkerManager(successfulLaunch);
    const handler = new SessionHandlers(
      worker,
      service as unknown as ISessionService,
      sendResponse as unknown as (socket: unknown, response: unknown) => void
    );

    await handler.handleStartSession(
      {} as never,
      makeRequest({ chromeWsUrl: 'ws://host-b:9222/devtools/browser/xyz' })
    );

    const response = sentResponses[0] as StartSessionResponse;
    assert.equal(response.status, 'error');
    assert.equal(response.errorCode, IPCErrorCode.SESSION_TARGET_MISMATCH);
    assert.match(response.message ?? '', /host-a/);
    assert.match(response.message ?? '', /host-b/);
    assert.match(response.message ?? '', /bdg stop/);
    assert.equal(worker.launch.mock.callCount(), 0);
    assert.equal(service.forceRecoverStaleSession.mock.callCount(), 0);
  });

  void it('returns SESSION_TARGET_MISMATCH when attach request collides with launched session', async () => {
    global.fetch = aliveFetchStub() as unknown as typeof global.fetch;
    const service = makeSessionService({
      readPid: () => 4242,
      isProcessAlive: () => true,
      readMetadata: () => metadata(),
    });
    const worker = makeWorkerManager(successfulLaunch);
    const handler = new SessionHandlers(
      worker,
      service as unknown as ISessionService,
      sendResponse as unknown as (socket: unknown, response: unknown) => void
    );

    await handler.handleStartSession(
      {} as never,
      makeRequest({ chromeWsUrl: 'ws://host:9222/devtools/browser/abc' })
    );

    const response = sentResponses[0] as StartSessionResponse;
    assert.equal(response.errorCode, IPCErrorCode.SESSION_TARGET_MISMATCH);
  });

  void it('recovers silently and launches fresh when probe fails (stale session)', async () => {
    global.fetch = deadFetchStub() as unknown as typeof global.fetch;
    const staleWs = 'ws://127.0.0.1:9222/devtools/browser/dead';
    const service = makeSessionService({
      readPid: () => 4242,
      isProcessAlive: () => true,
      readMetadata: () => metadata({ webSocketDebuggerUrl: staleWs, chromePid: 9999 }),
    });
    const worker = makeWorkerManager(successfulLaunch);
    const handler = new SessionHandlers(
      worker,
      service as unknown as ISessionService,
      sendResponse as unknown as (socket: unknown, response: unknown) => void
    );

    await handler.handleStartSession(
      {} as never,
      makeRequest({ chromeWsUrl: 'ws://127.0.0.1:9222/devtools/browser/new' })
    );

    assert.equal(service.forceRecoverStaleSession.mock.callCount(), 1);
    const recoverArgs = service.forceRecoverStaleSession.mock.calls[0]?.arguments;
    assert.equal(recoverArgs?.[0], 4242, 'recovers the stale worker PID');
    assert.equal(recoverArgs?.[1], 9999, 'passes chromePid when metadata recorded it');

    assert.equal(worker.launch.mock.callCount(), 1, 'launches a fresh worker after recovery');
    assert.equal(
      worker.dispose.mock.callCount(),
      1,
      'disposes WorkerManager reference so launch does not race WORKER_ALREADY_RUNNING'
    );

    const response = sentResponses[0] as StartSessionResponse;
    assert.equal(response.status, 'ok');
    assert.equal(response.data?.recovered, true);
    assert.equal(response.data?.previousTarget, staleWs);
  });
});
