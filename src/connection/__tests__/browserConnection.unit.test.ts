/**
 * The one browser connection of `bdg attach` (#473), against fake browser
 * endpoints that behave as Chrome does with remote debugging enabled at
 * chrome://inspect/#remote-debugging: the WebSocket upgrade waits while the
 * "Allow remote debugging?" prompt is open, a declined prompt answers
 * `403 Connection rejected` (Chromium `devtools_http_handler.cc`,
 * `HandleDebuggingApproval`), an accepted one upgrades. Each case opens
 * exactly one upgrade (each would be another prompt).
 */

import assert from 'node:assert/strict';
import * as http from 'node:http';
import { describe, it } from 'node:test';

import { WebSocketServer } from 'ws';

import type * as net from 'node:net';

import { connectToBrowser } from '@/connection/browserConnection.js';
import { CommandError } from '@/errors/index.js';

/** A fake browser endpoint and the upgrades it got */
interface FakeBrowser {
  wsUrl: string;
  upgrades: () => number;
  close: () => Promise<void>;
}

/**
 * Start a fake browser endpoint.
 *
 * @param answer - What the "user" does with the prompt
 * @returns The endpoint
 */
async function fakeBrowser(
  answer: 'allow' | 'deny' | 'never' | 'not-found' | 'hang-up'
): Promise<FakeBrowser> {
  let upgrades = 0;
  const sockets = new Set<net.Socket>();
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket: net.Socket, head) => {
    upgrades++;
    sockets.add(socket);
    if (answer === 'deny') {
      socket.end(
        'HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\nContent-Length: 19\r\n\r\nConnection rejected'
      );
    } else if (answer === 'not-found') {
      socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
    } else if (answer === 'hang-up') {
      socket.destroy();
    } else if (answer === 'allow') {
      wss.handleUpgrade(request, socket, head, () => undefined);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    wsUrl: `ws://127.0.0.1:${port}/devtools/browser/fake`,
    upgrades: () => upgrades,
    close: () =>
      new Promise((resolve) => {
        sockets.forEach((socket) => socket.destroy());
        wss.clients.forEach((client) => client.terminate());
        server.close(() => resolve());
      }),
  };
}

/**
 * Assert a CommandError with an exit code.
 *
 * @param exitCode - Expected exit code
 * @param check - Further checks
 * @returns Validator for assert.rejects
 */
function commandError(exitCode: number, check: (error: CommandError) => void) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof CommandError, String(error));
    assert.equal(error.exitCode, exitCode, error.message);
    check(error);
    return true;
  };
}

void describe('connectToBrowser', () => {
  void it('connects once when the prompt is allowed', async () => {
    const browser = await fakeBrowser('allow');
    try {
      const cdp = await connectToBrowser(browser.wsUrl);
      cdp.close();
      assert.equal(browser.upgrades(), 1);
    } finally {
      await browser.close();
    }
  });

  void it('exits 82 when the prompt is declined, without asking again', async () => {
    const browser = await fakeBrowser('deny');
    try {
      await assert.rejects(
        connectToBrowser(browser.wsUrl),
        commandError(82, (error) => {
          assert.equal(
            error.message,
            'Chrome refused the connection: the remote debugging prompt was declined'
          );
          assert.match(String(error.metadata.suggestion), /Allow/);
        })
      );
      assert.equal(browser.upgrades(), 1);
    } finally {
      await browser.close();
    }
  });

  void it('exits 102 when the prompt is not answered in time', async () => {
    const browser = await fakeBrowser('never');
    try {
      const began = Date.now();
      await assert.rejects(
        connectToBrowser(browser.wsUrl, { timeoutMs: 300 }),
        commandError(102, (error) => {
          assert.match(error.message, /not answered/);
          assert.match(String(error.metadata.suggestion), /Allow/);
        })
      );
      assert.ok(Date.now() - began < 5000);
      assert.equal(browser.upgrades(), 1);
    } finally {
      await browser.close();
    }
  });

  void it('stops waiting for the answer when aborted', async () => {
    const browser = await fakeBrowser('never');
    try {
      const controller = new AbortController();
      const connecting = connectToBrowser(browser.wsUrl, { signal: controller.signal });
      await new Promise<void>((resolve) => {
        const poll = setInterval(() => {
          if (browser.upgrades() === 0) return;
          clearInterval(poll);
          resolve();
        }, 10);
      });
      const began = Date.now();
      controller.abort();
      await assert.rejects(connecting, (error: unknown) => !(error instanceof CommandError));
      assert.ok(Date.now() - began < 2000);
      assert.equal(browser.upgrades(), 1);
    } finally {
      await browser.close();
    }
  });

  void it('exits 83 for a stale DevToolsActivePort file (nothing listening)', async () => {
    const browser = await fakeBrowser('never');
    await browser.close();
    await assert.rejects(
      connectToBrowser(browser.wsUrl, { activePortFile: '/tmp/x/DevToolsActivePort' }),
      commandError(83, (error) => {
        assert.match(error.message, /\/tmp\/x\/DevToolsActivePort/);
        assert.match(String(error.metadata.suggestion), /chrome:\/\/inspect\/#remote-debugging/);
        assert.match(String(error.metadata.suggestion), /--user-data-dir/);
      })
    );
  });

  for (const answer of ['not-found', 'hang-up'] as const) {
    void it(`exits 83 for a stale DevToolsActivePort whose port another server now owns (${answer})`, async () => {
      const browser = await fakeBrowser(answer);
      try {
        await assert.rejects(
          connectToBrowser(browser.wsUrl, { activePortFile: '/tmp/x/DevToolsActivePort' }),
          commandError(83, (error) => {
            assert.match(error.message, /\/tmp\/x\/DevToolsActivePort/);
            assert.match(
              String(error.metadata.suggestion),
              /chrome:\/\/inspect\/#remote-debugging/
            );
          })
        );
        assert.equal(browser.upgrades(), 1);
      } finally {
        await browser.close();
      }
    });
  }

  void it('exits 101 with how to find the right URL when a direct --chrome-ws-url fails', async () => {
    const browser = await fakeBrowser('never');
    await browser.close();
    await assert.rejects(
      connectToBrowser(browser.wsUrl),
      commandError(101, (error) => {
        assert.match(error.message, /Failed to connect/);
        assert.match(String(error.metadata.suggestion), /--remote-debugging-port/);
        assert.match(String(error.metadata.suggestion), /\/json\/version/);
      })
    );
  });
});
