/**
 * bdg connects only to the Chrome it launched (#314): the endpoint Chrome
 * announces on stderr must be the browser answering on 127.0.0.1:<port>.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

before(async () => {
  server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}${answeredPath}` }));
  });
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

  void it('rejects a Chrome listening on another port', async () => {
    answeredPath = BROWSER_PATH;
    const logs = chromeSays(`DevTools listening on ws://127.0.0.1:${port + 1}${BROWSER_PATH}`);
    await assertIssue(verifyLaunchedChrome({ logs, port, pid: alivePid }), 'PORT_IN_USE');
  });

  void it('accepts a silent Chrome answering on 127.0.0.1 alone, without a port conflict', async () => {
    answeredPath = BROWSER_PATH;
    const logs = chromeSays('some unrelated output');
    await verifyLaunchedChrome({ logs, port, pid: alivePid, timeoutMs: 100 });
  });

  void it('fails a silent Chrome nothing answers for, naming chrome-err.log, not as a port conflict', async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const freePort = (closed.address() as net.AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
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

  void it('reports a Chrome that died before announcing', async () => {
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    await assertIssue(
      verifyLaunchedChrome({ logs: chromeSays(), port, pid: deadPid }),
      'CHROME_DIED_AFTER_LAUNCH'
    );
  });
});
