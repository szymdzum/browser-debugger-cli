/**
 * The daemon's one shutdown order.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { SessionController } from '@/daemon/SessionController.js';
import { IPCServer } from '@/daemon/ipcServer.js';
import { runShutdown, type ShutdownSteps } from '@/daemon/server/shutdown.js';
import { getPeek, stopSession } from '@/ipc/client.js';
import { isConnectionError } from '@/ipc/utils/errors.js';
import { getSessionFilePath } from '@/session/paths.js';

/**
 * Fake steps recording their order.
 *
 * @returns The steps and the recorded calls
 */
function recordingSteps(): { steps: ShutdownSteps; calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) => (): Promise<void> => {
    calls.push(name);
    return Promise.resolve();
  };
  return {
    calls,
    steps: {
      refuseNewSessions: () => void calls.push('refuseNewSessions'),
      unpublish: () => void calls.push('unpublish'),
      stopSession: record('stopSession'),
      waitForInFlightRequests: record('waitForInFlightRequests'),
      flush: record('flush'),
      stopServer: record('stopServer'),
      exit: () => void calls.push('exit'),
    },
  };
}

void describe('runShutdown', () => {
  void it('runs the remaining steps and exits when a step fails', async () => {
    const { steps, calls } = recordingSteps();
    steps.stopSession = () => {
      calls.push('stopSession');
      return Promise.reject(new Error('teardown broke'));
    };
    steps.unpublish = () => {
      calls.push('unpublish');
      throw new Error('socket file gone');
    };
    await runShutdown(steps);
    assert.deepEqual(calls, [
      'refuseNewSessions',
      'unpublish',
      'stopSession',
      'waitForInFlightRequests',
      'flush',
      'stopServer',
      'exit',
    ]);
  });

  void it('unpublishes, stops the session, lets in-flight requests answer, then exits', async () => {
    const { steps, calls } = recordingSteps();
    await runShutdown(steps);
    assert.deepEqual(calls, [
      'refuseNewSessions',
      'unpublish',
      'stopSession',
      'waitForInFlightRequests',
      'flush',
      'stopServer',
      'exit',
    ]);
  });
});

/** The controller's internals the tests reach into: its session, and the callback a session end calls */
interface ControllerInternals {
  session: unknown;
  onSessionEnded: (reason: 'normal') => void;
}

/**
 * The server's session controller, opened up for tests.
 *
 * @param server - The server
 * @returns Its controller's internals
 */
function controllerOf(server: IPCServer): ControllerInternals {
  return (server as unknown as { controller: SessionController })
    .controller as unknown as ControllerInternals;
}

/**
 * A running session whose stop finishes when the test says so.
 *
 * @param onStop - Called on each stop
 * @returns The fake session and a function finishing its stop
 */
function fakeSession(onStop: () => void = () => {}): { session: unknown; finishStop: () => void } {
  let finishStop = (): void => {};
  const stopped = new Promise<void>((resolve) => (finishStop = resolve));
  const session = {
    info: () => ({ chromePid: 0 }),
    stop: () => {
      onStop();
      return stopped;
    },
  };
  return { session, finishStop };
}

/**
 * The error a client gets for a peek.
 *
 * @returns The rejection
 */
async function peekError(): Promise<unknown> {
  try {
    await getPeek();
  } catch (error) {
    return error;
  }
  return undefined;
}

void describe('IPCServer shutdown callers', () => {
  let dir: string;
  let previous: string | undefined;
  let exited: Promise<number>;
  let server: IPCServer;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-shutdown-test-'));
    previous = process.env['BDG_SESSION_DIR'];
    process.env['BDG_SESSION_DIR'] = dir;
    let exit = (_code: number): void => {};
    exited = new Promise((resolve) => (exit = resolve));
    server = new IPCServer(exit);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    if (previous === undefined) delete process.env['BDG_SESSION_DIR'];
    else process.env['BDG_SESSION_DIR'] = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  void it('a signal shuts down through the one path: files removed, exit 0', async () => {
    const shutdowns = [server.shutdown(), server.shutdown()];
    assert.equal(await exited, 0);
    await Promise.all(shutdowns);
    assert.equal(fs.existsSync(getSessionFilePath('DAEMON_SOCKET')), false);
    assert.equal(fs.existsSync(getSessionFilePath('DAEMON_PID')), false);
  });

  void it('a failed start shuts down through the same path after answering', async () => {
    const socket = net.connect(getSessionFilePath('DAEMON_SOCKET'));
    const reply = new Promise<string>((resolve) =>
      socket.once('data', (chunk) => resolve(chunk.toString()))
    );
    socket.write(
      `${JSON.stringify({ type: 'start_session_request', sessionId: 's1', url: 'ftp://example.com' })}\n`
    );
    assert.match(await reply, /"status":"error"/);
    assert.equal(await exited, 0);
    socket.destroy();
    assert.equal(fs.existsSync(getSessionFilePath('DAEMON_SOCKET')), false);
    assert.equal(fs.existsSync(getSessionFilePath('DAEMON_PID')), false);
  });

  void it('a session end shuts down through the same path', async () => {
    controllerOf(server).onSessionEnded('normal');
    assert.equal(await exited, 0);
    assert.equal(fs.existsSync(getSessionFilePath('DAEMON_SOCKET')), false);
  });

  void it('an idle daemon shuts down through the same path', async () => {
    assert.equal(await exited, 0);
    assert.equal(fs.existsSync(getSessionFilePath('DAEMON_SOCKET')), false);
  });

  void it('a client arriving during a signal teardown gets the no-daemon answer', async () => {
    const { session, finishStop } = fakeSession();
    controllerOf(server).session = session;
    const shutdown = server.shutdown();
    const duringTeardown = await peekError();
    finishStop();
    assert.equal(await exited, 0);
    await shutdown;
    const noDaemon = await peekError();
    assert.ok(isConnectionError(duringTeardown), String(duringTeardown));
    assert.ok(isConnectionError(noDaemon), String(noDaemon));
    assert.equal(String(duringTeardown), String(noDaemon));
  });

  void it("bdg stop's request is answered before the daemon exits", async () => {
    const events: string[] = [];
    const controller = controllerOf(server);
    const { session, finishStop } = fakeSession(() => controller.onSessionEnded('normal'));
    controller.session = session;
    void exited.then(() => events.push('exit'));
    const reply = stopSession().then((response) => {
      events.push(`reply ${response.status}`);
    });
    finishStop();
    await reply;
    await exited;
    assert.deepEqual(events, ['reply ok', 'exit']);
  });
});
