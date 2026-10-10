/**
 * A fake daemon on the session socket, for tests of CLI-side helpers that
 * send CDP calls through the daemon (`callCDP`, `callBdgScript`): it answers
 * the handshake and passes `cdp_call` requests to a fake page, all on their
 * own connections, as concurrently as the real daemon. Point
 * `BDG_SESSION_DIR` at a temporary directory before starting it.
 */

import * as fs from 'node:fs';
import * as net from 'node:net';

import { getDaemonSocketPath } from '@/session/paths.js';
import { getErrorMessage } from '@/utils/errors.js';

/** The page behind the fake daemon */
export interface FakeDaemonPage {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

/** A running fake daemon */
export interface FakeDaemon {
  close: () => Promise<void>;
}

/** IPC request fields the fake daemon reads */
interface FakeRequest {
  type: string;
  sessionId: string;
  method?: string;
  params?: Record<string, unknown>;
}

/**
 * Answer one IPC request.
 *
 * @param page - Fake page for CDP calls
 * @param request - The request
 * @returns The response
 */
async function answer(page: FakeDaemonPage, request: FakeRequest): Promise<object> {
  const base = {
    type: request.type.replace(/_request$/, '_response'),
    sessionId: request.sessionId,
  };
  if (request.type !== 'cdp_call_request') return { ...base, status: 'ok' };
  try {
    const result = await page.send(request.method ?? '', request.params);
    return { ...base, status: 'ok', data: { result } };
  } catch (error) {
    return { ...base, status: 'error', error: getErrorMessage(error) };
  }
}

/**
 * Start a fake daemon on the session socket.
 *
 * @param page - Fake page answering the CDP calls
 * @returns The daemon, to close after the test
 */
export async function startFakeDaemon(page: FakeDaemonPage): Promise<FakeDaemon> {
  const socketPath = getDaemonSocketPath();
  fs.rmSync(socketPath, { force: true });
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines.filter((text) => text.trim())) {
        void answer(page, JSON.parse(line) as FakeRequest).then((response) => {
          if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
        });
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  return {
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
