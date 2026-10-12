/**
 * The client reports an error frame from the daemon at once, and a timeout
 * longer than a timer can wait does not fire immediately (#657).
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { CommandError } from '@/errors/index.js';
import { sendRequest } from '@/ipc/transport/index.js';
import { createSocket } from '@/ipc/transport/socket.js';

/** Longest delay Node's `setTimeout` takes; a longer one fires after 1 ms */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

void describe('sendRequest against a daemon that cannot route the request', () => {
  let dir: string;
  let server: net.Server;
  let socketPath: string;
  let reply: object;
  let delayMs: number;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-ipc-'));
    socketPath = path.join(dir, 'd.sock');
    delayMs = 0;
    server = net.createServer((socket) => {
      socket.on('data', () => {
        setTimeout(() => socket.write(JSON.stringify(reply) + '\n'), delayMs);
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  });

  afterEach(async () => {
    mock.restoreAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  void it('rejects with the daemon error, its suggestion and exit code, long before the timeout', async () => {
    reply = {
      type: 'error_response',
      sessionId: 's-1',
      status: 'error',
      error: 'unknown command',
      suggestion: 'restart it',
      exitCode: 90,
    };
    const started = Date.now();
    await assert.rejects(
      sendRequest({ type: 'x_request', sessionId: 's-1' }, 'x', 'x_response', 20_000, socketPath),
      (error: unknown) => {
        assert.ok(error instanceof CommandError);
        assert.match(error.message, /unknown command/);
        assert.equal(error.exitCode, 90);
        return true;
      }
    );
    assert.ok(Date.now() - started < 2000);
  });

  void it('rejects a generic error frame whose session id is unknown', async () => {
    reply = { type: 'error_response', sessionId: 'unknown', status: 'error', error: 'bad frame' };
    await assert.rejects(
      sendRequest({ type: 'x_request', sessionId: 's-1' }, 'x', 'x_response', 20_000, socketPath),
      /bad frame/
    );
  });

  void it('waits for a reply when the timeout is longer than a timer can wait', async () => {
    reply = { type: 'x_response', sessionId: 's-1', status: 'ok' };
    delayMs = 50;
    const response = await sendRequest(
      { type: 'x_request', sessionId: 's-1' },
      'x',
      'x_response',
      3_000_000_000,
      socketPath
    );
    assert.equal((response as unknown as { status: string }).status, 'ok');
  });

  void it('gives the timer no more than the longest delay', () => {
    const timers = mock.method(globalThis, 'setTimeout');
    const { cleanup } = createSocket(
      { socketPath, timeoutMs: 3_000_000_000, requestName: 'x' },
      { onTimeout: () => undefined }
    );
    cleanup();
    const delays = timers.mock.calls.map((call) => call.arguments[1] as number);
    assert.ok(delays.length > 0);
    assert.ok(
      delays.every((delay) => delay <= MAX_TIMER_DELAY_MS),
      delays.join(', ')
    );
  });
});
