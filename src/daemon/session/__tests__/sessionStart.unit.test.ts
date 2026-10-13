/**
 * The real `Session` start wiring under a stop (#659): an attached Chrome
 * (`--chrome-ws-url`) whose endpoint never answers stands in for Chrome, so
 * no browser is needed.
 */

import assert from 'node:assert/strict';
import * as net from 'node:net';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { Session, StartCancelledError } from '@/daemon/session/Session.js';

void describe('Session.launch stopped while starting', () => {
  let silent: net.Server;
  let sockets: net.Socket[];
  let reached: Promise<void>;
  let chromeWsUrl: string;

  beforeEach(async () => {
    sockets = [];
    let onReached = (): void => {};
    reached = new Promise((resolve) => (onReached = resolve));
    silent = net.createServer((socket) => {
      sockets.push(socket);
      onReached();
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const { port } = silent.address() as net.AddressInfo;
    chromeWsUrl = `ws://127.0.0.1:${port}/devtools/browser/abc`;
  });

  afterEach(() => {
    sockets.forEach((socket) => socket.destroy());
    silent.close();
  });

  void it('a stop during the attach ends the start as cancelled, at once', async () => {
    const ended: string[] = [];
    const session = Session.create('http://127.0.0.1:47802/', { chromeWsUrl }, (reason) =>
      ended.push(reason)
    );
    const launch = session.launch();
    await reached;
    const stoppedAt = Date.now();
    await session.stop('normal');
    await assert.rejects(launch, StartCancelledError);
    const afterStopMs = Date.now() - stoppedAt;
    assert.ok(afterStopMs < 2000, `ended ${afterStopMs} ms after the stop (probe timeout 5 s)`);
    assert.deepEqual(ended, [], 'a start that never finished does not report an end');
  });

  void it('a stop before the launch starts no step', async () => {
    const session = Session.create('http://127.0.0.1:47802/', { chromeWsUrl }, () => undefined);
    await session.stop('normal');
    await assert.rejects(session.launch(), StartCancelledError);
    assert.equal(sockets.length, 0, 'Chrome was not contacted');
  });
});
