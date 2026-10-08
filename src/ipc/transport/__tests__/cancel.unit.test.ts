/**
 * A request whose abort signal fires closes its connection (the daemon sees
 * the client disconnect, e.g. an interrupted start is cancelled) and rejects
 * with {@link IPCCancelledError}.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { IPCCancelledError, sendRequest } from '@/ipc/transport/index.js';

void describe('sendRequest cancellation', () => {
  let dir: string;
  let server: net.Server;
  let socketPath: string;
  let closed: Promise<void>;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-ipc-'));
    socketPath = path.join(dir, 'd.sock');
    closed = new Promise<void>((resolveClosed) => {
      server = net.createServer((socket) => {
        socket.on('close', () => resolveClosed());
        socket.resume();
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  void it('closes the connection and rejects when the signal aborts', async () => {
    const controller = new AbortController();
    const request = sendRequest(
      { type: 'start_session_request', sessionId: 'x' },
      'start session',
      undefined,
      30000,
      socketPath,
      controller.signal
    );
    setTimeout(() => controller.abort('SIGINT'), 50);

    await assert.rejects(request, IPCCancelledError);
    await closed;
  });

  void it('rejects at once without connecting when the signal has already aborted', async () => {
    const controller = new AbortController();
    controller.abort('SIGINT');
    let connected = false;
    server.on('connection', () => {
      connected = true;
    });

    await assert.rejects(
      sendRequest(
        { type: 'status_request', sessionId: 'x' },
        'status',
        undefined,
        30000,
        socketPath,
        controller.signal
      ),
      IPCCancelledError
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(connected, false);
  });
});
