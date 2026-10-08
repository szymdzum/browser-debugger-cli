/**
 * bdg connects only to the Chrome it launched (#314): the endpoint Chrome
 * announces on stderr must be the browser answering on 127.0.0.1:<port>.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  parseDevToolsListening,
  verifyLaunchedChrome,
  waitForDevToolsEndpoint,
} from '@/connection/chromeIdentity.js';
import { ChromeLaunchError } from '@/connection/errors.js';
import { markStartupLogs, readStartupLines } from '@/connection/startupExit.js';
import { formatChromeIssue } from '@/ui/messages/chrome.js';

const BROWSER_PATH = '/devtools/browser/11111111-2222-3333-4444-555555555555';
const OTHER_PATH = '/devtools/browser/99999999-8888-7777-6666-555555555555';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-identity-'));
const errLog = path.join(profile, 'chrome-err.log');
let server: http.Server;
let port: number;
let answeredPath = BROWSER_PATH;

/**
 * Write what a launched Chrome prints to stderr and return the log positions
 * from before it.
 *
 * @param lines - Lines Chrome prints
 * @returns Log positions
 */
function chromeSays(...lines: string[]): ReturnType<typeof markStartupLogs> {
  fs.writeFileSync(errLog, 'DevTools listening on ws://127.0.0.1:1/devtools/browser/old\n');
  const logs = markStartupLogs(profile);
  fs.appendFileSync(errLog, lines.map((line) => `${line}\n`).join(''));
  return logs;
}

/**
 * Assert that verification fails with a launch issue code.
 *
 * @param promise - Verification
 * @param code - Expected issue code
 */
async function assertIssue(promise: Promise<void>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ChromeLaunchError);
    assert.equal(error.issue?.code, code);
    return true;
  });
}

/**
 * A DevTools-like server answering `/json/version` with the browser path set
 * in `answeredPath`.
 *
 * @returns Server (not listening yet)
 */
function createVersionServer(): http.Server {
  return http.createServer((req, res) => {
    const { port: own } = req.socket.address() as net.AddressInfo;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${own}${answeredPath}` }));
  });
}

/**
 * A server that accepts `/json/version` requests and never answers them.
 *
 * @returns Server, its port, and a promise resolved once a pending request is
 *   closed by the client
 */
async function hangingServer(): Promise<{
  server: http.Server;
  port: number;
  requestClosed: Promise<void>;
}> {
  let closed: () => void = () => {};
  const requestClosed = new Promise<void>((resolve) => (closed = resolve));
  const hanging = http.createServer((req) => req.socket.once('close', () => closed()));
  await new Promise<void>((resolve) => hanging.listen(0, '127.0.0.1', resolve));
  return { server: hanging, port: (hanging.address() as net.AddressInfo).port, requestClosed };
}

/**
 * Assert that a verification ends as aborted within 200 ms of the abort.
 *
 * @param verification - Verification under way
 * @param stop - Controller whose signal the verification got
 * @param afterMs - When to abort
 */
async function assertEndsSoonAfterAbort(
  verification: Promise<void>,
  stop: AbortController,
  afterMs: number
): Promise<void> {
  let abortedAt = 0;
  const timer = setTimeout(() => {
    abortedAt = Date.now();
    stop.abort();
  }, afterMs);
  try {
    await assert.rejects(verification, (error: unknown) => {
      assert.ok(error instanceof ChromeLaunchError);
      assert.match(error.message, /aborted/);
      return true;
    });
  } finally {
    clearTimeout(timer);
  }
  assert.ok(abortedAt > 0, 'verification ended before the abort');
  const tookMs = Date.now() - abortedAt;
  assert.ok(tookMs < 200, `ended ${tookMs} ms after the abort`);
}

/**
 * A port nothing listens on (connections to it are refused).
 *
 * @returns Port number
 */
async function closedPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const free = (probe.address() as net.AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));
  return free;
}

before(async () => {
  server = createVersionServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as net.AddressInfo).port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
});

void describe('parseDevToolsListening', () => {
  void it('reads host, port and browser path, IPv4 and IPv6', () => {
    assert.deepEqual(
      parseDevToolsListening([`DevTools listening on ws://127.0.0.1:9223${BROWSER_PATH}`]),
      {
        host: '127.0.0.1',
        port: 9223,
        browserPath: BROWSER_PATH,
      }
    );
    assert.deepEqual(
      parseDevToolsListening([`DevTools listening on ws://[::1]:9227${BROWSER_PATH}`]),
      {
        host: '[::1]',
        port: 9227,
        browserPath: BROWSER_PATH,
      }
    );
  });

  void it('takes the last announcement and skips other output', () => {
    const endpoint = parseDevToolsListening([
      `DevTools listening on ws://127.0.0.1:9223${OTHER_PATH}`,
      '[1234:5678:ERROR:some_component.cc(42)] noise',
      `DevTools listening on ws://127.0.0.1:9224${BROWSER_PATH}`,
      '',
    ]);
    assert.equal(endpoint?.port, 9224);
    assert.equal(endpoint?.browserPath, BROWSER_PATH);
  });

  void it('ignores incomplete or foreign announcements', () => {
    assert.equal(parseDevToolsListening([]), null);
    assert.equal(parseDevToolsListening(['DevTools listening on ws://127.0.0.1:92']), null);
    assert.equal(
      parseDevToolsListening(['DevTools listening on ws://127.0.0.1:9223/devtools/page/1']),
      null
    );
    assert.equal(parseDevToolsListening(['DevTools listening on ws://[bad']), null);
  });
});

void describe('readStartupLines', () => {
  void it('cuts the log at the byte offset, also after non-ASCII output', () => {
    fs.writeFileSync(errLog, 'Zażółć gęślą jaźń ✓ 日本語\n');
    const logs = markStartupLogs(profile);
    fs.appendFileSync(errLog, `DevTools listening on ws://127.0.0.1:9231${BROWSER_PATH}\n`);
    const lines = readStartupLines(logs).filter(Boolean);
    assert.deepEqual(lines, [`DevTools listening on ws://127.0.0.1:9231${BROWSER_PATH}`]);
  });
});

void describe('waitForDevToolsEndpoint', () => {
  void it('waits for an announcement written after the launch only', async () => {
    const logs = chromeSays();
    setTimeout(
      () => fs.appendFileSync(errLog, `DevTools listening on ws://127.0.0.1:9230${BROWSER_PATH}\n`),
      100
    );
    const endpoint = await waitForDevToolsEndpoint(logs, () => true, 2000);
    assert.equal(endpoint?.port, 9230);
  });

  void it('gives up when Chrome is gone or the time is up', async () => {
    assert.equal(await waitForDevToolsEndpoint(chromeSays(), () => false, 2000), null);
    assert.equal(await waitForDevToolsEndpoint(chromeSays(), () => true, 100), null);
  });
});

void describe('verifyLaunchedChrome', () => {
  const alivePid = process.pid;

  void it('accepts the Chrome that answers on the port', async () => {
    answeredPath = BROWSER_PATH;
    const logs = chromeSays(`DevTools listening on ws://127.0.0.1:${port}${BROWSER_PATH}`);
    await verifyLaunchedChrome({ logs, port, pid: alivePid });
  });

  void it('rejects another browser answering on 127.0.0.1 (ours fell back to [::1])', async () => {
    answeredPath = OTHER_PATH;
    const logs = chromeSays(`DevTools listening on ws://[::1]:${port}${BROWSER_PATH}`);
    await assertIssue(verifyLaunchedChrome({ logs, port, pid: alivePid }), 'PORT_IN_USE');
  });

  void it('names what was found when another browser answers on the port', async () => {
    answeredPath = OTHER_PATH;
    const logs = chromeSays(`DevTools listening on ws://127.0.0.1:${port}${BROWSER_PATH}`);
    await assert.rejects(verifyLaunchedChrome({ logs, port, pid: alivePid }), (error: unknown) => {
      assert.ok(error instanceof ChromeLaunchError && error.issue);
      assert.equal(error.issue.code, 'PORT_IN_USE');
      const reason = String(error.issue.context?.['reason']);
      assert.match(reason, /another browser answers on 127\.0\.0\.1/);
      assert.ok(formatChromeIssue(error.issue).includes(reason), formatChromeIssue(error.issue));
      return true;
    });
  });

  void it('waits for a slow Chrome that announced its port but does not answer yet', async () => {
    answeredPath = BROWSER_PATH;
    const slowPort = await closedPort();
    const logs = chromeSays(`DevTools listening on ws://127.0.0.1:${slowPort}${BROWSER_PATH}`);
    const slow = createVersionServer();
    const late = setTimeout(() => slow.listen(slowPort, '127.0.0.1'), 300);
    try {
      await verifyLaunchedChrome({ logs, port: slowPort, pid: alivePid, timeoutMs: 5000 });
    } finally {
      clearTimeout(late);
      await new Promise((resolve) => slow.close(resolve));
    }
  });

  void it('reports a Chrome that announced its port but never answers as a slow start, not a port conflict', async () => {
    const slowPort = await closedPort();
    const logs = chromeSays(`DevTools listening on ws://127.0.0.1:${slowPort}${BROWSER_PATH}`);
    await assert.rejects(
      verifyLaunchedChrome({ logs, port: slowPort, pid: alivePid, timeoutMs: 300 }),
      (error: unknown) => {
        assert.ok(error instanceof ChromeLaunchError && error.issue);
        assert.equal(error.issue.code, 'CHROME_LAUNCH_FAILED');
        assert.match(
          String(error.issue.context?.['reason']),
          new RegExp(`announced port ${slowPort} but did not answer on 127\\.0\\.0\\.1 within`)
        );
        return true;
      }
    );
  });

  void it('rejects a Chrome listening on another port', async () => {
    answeredPath = BROWSER_PATH;
    const logs = chromeSays(`DevTools listening on ws://127.0.0.1:${port + 1}${BROWSER_PATH}`);
    await assertIssue(verifyLaunchedChrome({ logs, port, pid: alivePid }), 'PORT_IN_USE');
  });

  void it('reports a Chrome that dies while bdg waits for its answer as died, at once', async () => {
    const slowPort = await closedPort();
    const logs = chromeSays(`DevTools listening on ws://127.0.0.1:${slowPort}${BROWSER_PATH}`);
    const chrome = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)']);
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    const started = Date.now();
    await assertIssue(
      verifyLaunchedChrome({ logs, port: slowPort, pid: chrome.pid ?? 0, timeoutMs: 5000 }),
      'CHROME_DIED_AFTER_LAUNCH'
    );
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
    await exited;
  });

  void it('reports a port conflict at once when Chrome fell back to [::1] and 127.0.0.1 does not answer', async () => {
    const slowPort = await closedPort();
    const logs = chromeSays(`DevTools listening on ws://[::1]:${slowPort}${BROWSER_PATH}`);
    const started = Date.now();
    await assert.rejects(
      verifyLaunchedChrome({ logs, port: slowPort, pid: alivePid, timeoutMs: 5000 }),
      (error: unknown) => {
        assert.ok(error instanceof ChromeLaunchError && error.issue);
        assert.equal(error.issue.code, 'PORT_IN_USE');
        assert.match(
          String(error.issue.context?.['reason']),
          /something holds 127\.0\.0\.1 \(Chrome fell back to \[::1\]\)/
        );
        return true;
      }
    );
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
  });

  void it('accepts a silent Chrome answering on 127.0.0.1 alone, without a port conflict', async () => {
    answeredPath = BROWSER_PATH;
    const logs = chromeSays('some unrelated output');
    await verifyLaunchedChrome({ logs, port, pid: alivePid, timeoutMs: 100 });
  });

  void it('fails a silent Chrome nothing answers for, naming chrome-err.log, not as a port conflict', async () => {
    const freePort = await closedPort();
    await assert.rejects(
      verifyLaunchedChrome({ logs: chromeSays(), port: freePort, pid: alivePid, timeoutMs: 100 }),
      (error: unknown) => {
        assert.ok(error instanceof ChromeLaunchError);
        assert.equal(error.issue?.code, 'CHROME_LAUNCH_FAILED');
        assert.match(String(error.issue.context?.['reason']), /chrome-err\.log/);
        return true;
      }
    );
  });

  void it('reports a conflict when a silent Chrome shares the port with a [::1] listener', async (t) => {
    const v6 = net.createServer();
    const listening = await new Promise<boolean>((resolve) => {
      v6.once('error', () => resolve(false));
      v6.listen(port, '::1', () => resolve(true));
    });
    if (!listening) {
      t.skip('IPv6 loopback is not available');
      return;
    }
    try {
      await assertIssue(
        verifyLaunchedChrome({ logs: chromeSays(), port, pid: alivePid, timeoutMs: 100 }),
        'PORT_IN_USE'
      );
    } finally {
      await new Promise((resolve) => v6.close(resolve));
    }
  });

  void it('ends at once when stopped while waiting for an answer that never comes, aborting the request', async () => {
    const hanging = await hangingServer();
    try {
      const logs = chromeSays(
        `DevTools listening on ws://127.0.0.1:${hanging.port}${BROWSER_PATH}`
      );
      const stop = new AbortController();
      const verification = verifyLaunchedChrome({
        logs,
        port: hanging.port,
        pid: alivePid,
        timeoutMs: 10000,
        signal: stop.signal,
      });
      await assertEndsSoonAfterAbort(verification, stop, 300);
      const closed = await Promise.race([
        hanging.requestClosed.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 200)),
      ]);
      assert.equal(closed, true, 'the pending /json/version request must be aborted');
    } finally {
      hanging.server.closeAllConnections();
      await new Promise((resolve) => hanging.server.close(resolve));
    }
  });

  void it('ends at once when stopped while polling a port that refuses connections', async () => {
    const slowPort = await closedPort();
    const logs = chromeSays(`DevTools listening on ws://127.0.0.1:${slowPort}${BROWSER_PATH}`);
    const stop = new AbortController();
    const verification = verifyLaunchedChrome({
      logs,
      port: slowPort,
      pid: alivePid,
      timeoutMs: 10000,
      signal: stop.signal,
    });
    await assertEndsSoonAfterAbort(verification, stop, 300);
  });

  void it('ends at once when stopped while waiting for Chrome to announce its endpoint', async () => {
    const stop = new AbortController();
    const verification = verifyLaunchedChrome({
      logs: chromeSays(),
      port,
      pid: alivePid,
      timeoutMs: 10000,
      signal: stop.signal,
    });
    await assertEndsSoonAfterAbort(verification, stop, 300);
  });

  void it('reports a Chrome that died before announcing', async () => {
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    await assertIssue(
      verifyLaunchedChrome({ logs: chromeSays(), port, pid: deadPid }),
      'CHROME_DIED_AFTER_LAUNCH'
    );
  });
});
