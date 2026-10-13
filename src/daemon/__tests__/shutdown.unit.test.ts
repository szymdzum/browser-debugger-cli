/**
 * The daemon's one shutdown order.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { IPCServer } from '@/daemon/ipcServer.js';
import { runShutdown, type ShutdownSteps } from '@/daemon/server/shutdown.js';
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
});
