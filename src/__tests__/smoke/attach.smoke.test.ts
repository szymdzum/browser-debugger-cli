/**
 * `bdg attach` smoke test (#473): a Chrome started with
 * `--remote-debugging-port` has two tabs; bdg lists them, attaches to the one
 * a pattern names over a single browser-level WebSocket, without reloading
 * it (its `window.__marker` stays, the error it logged before the attach is
 * in `bdg console`), runs commands on it, and `bdg stop` leaves both tabs.
 *
 * bdg reaches Chrome through a TCP proxy that counts the WebSocket upgrades
 * it forwards.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { startFixtureServer, type FixtureServer } from '@/__testutils__/fixtureServer.js';
import { CDPConnection } from '@/connection/cdp.js';
import { launchChrome } from '@/connection/launcher.js';
import type { CDPTarget, LaunchedChrome } from '@/types.js';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  exitCode?: number;
  suggestion?: string;
}

interface TabsData {
  tabs: { index: number; targetId: string; title: string; url: string }[];
}

interface StartData {
  targetUrl: string;
  targetTitle?: string;
  attached?: boolean;
}

const sessionDir = fs.mkdtempSync('/tmp/bdg-attach-');
const env = { BDG_SESSION_DIR: sessionDir };

/** A TCP proxy to Chrome's port that counts the WebSocket upgrades it forwards */
interface CountingProxy {
  port: number;
  upgrades: () => number;
  close: () => Promise<void>;
}

/**
 * Start a proxy to a local port.
 *
 * @param targetPort - Chrome's debugging port
 * @returns The proxy
 */
async function startCountingProxy(targetPort: number): Promise<CountingProxy> {
  let upgrades = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    sockets.add(client).add(upstream);
    client.once('data', (chunk: Buffer) => {
      if (chunk.toString('latin1').startsWith('GET /devtools/')) upgrades++;
    });
    client.pipe(upstream).pipe(client);
    const end = (): void => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', end).on('close', end);
    upstream.on('error', end).on('close', end);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    upgrades: () => upgrades,
    close: () =>
      new Promise((resolve) => {
        sockets.forEach((socket) => socket.destroy());
        server.close(() => resolve());
      }),
  };
}

/**
 * A free local port.
 *
 * @returns The port
 */
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * Chrome's page targets, read directly (not through the proxy).
 *
 * @param port - Chrome's debugging port
 * @returns Page targets
 */
async function chromePages(port: number): Promise<CDPTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = (await response.json()) as CDPTarget[];
  return targets.filter((target) => target.type === 'page');
}

/**
 * Evaluate an expression in a tab over a connection of the test's own.
 *
 * @param target - The tab
 * @param expression - Expression
 * @returns Its value
 */
async function evaluateInTab(target: CDPTarget, expression: string): Promise<unknown> {
  const cdp = await CDPConnection.create(target.webSocketDebuggerUrl);
  try {
    const { result } = (await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    })) as { result: { value?: unknown } };
    return result.value;
  } finally {
    cdp.close();
  }
}

/**
 * Open a tab and load a URL in it, over a connection of the test's own
 * (closed once the page fired its load event).
 *
 * @param port - Chrome's debugging port
 * @param url - URL
 * @returns The tab
 */
async function openTab(port: number, url: string): Promise<CDPTarget> {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = (await response.json()) as CDPTarget;
  const cdp = await CDPConnection.create(target.webSocketDebuggerUrl);
  try {
    await cdp.send('Page.enable');
    const loaded = new Promise<void>((resolve) => cdp.on('Page.loadEventFired', () => resolve()));
    await cdp.send('Page.navigate', { url });
    await loaded;
  } finally {
    cdp.close();
  }
  return target;
}

/**
 * Run a bdg command with `--json` and parse its envelope.
 *
 * @param command - Command
 * @param args - Arguments
 * @returns Exit code and envelope
 */
async function runJson<T>(
  command: string,
  args: string[]
): Promise<{ exitCode: number; envelope: Envelope<T> }> {
  const result = await runCommand(command, [...args, '--json'], { timeout: 60000, env });
  return {
    exitCode: result.exitCode,
    envelope: JSON.parse(result.stdout || '{}') as Envelope<T>,
  };
}

/**
 * Run a bdg command; its combined output.
 *
 * @param command - Command
 * @param args - Arguments
 * @returns Exit code and output
 */
async function run(command: string, args: string[]): Promise<{ exitCode: number; output: string }> {
  const result = await runCommand(command, args, { timeout: 60000, env });
  return { exitCode: result.exitCode, output: result.stdout + result.stderr };
}

void describe('bdg attach', () => {
  let fixture: FixtureServer;
  let chrome: LaunchedChrome;
  let proxy: CountingProxy;
  let tabA: CDPTarget;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-attach-profile-'));

  before(async () => {
    fixture = await startFixtureServer();
    chrome = await launchChrome({
      port: await freePort(),
      userDataDir: profile,
      headless: true,
      sessionDir,
    });
    tabA = await openTab(chrome.port, `${fixture.url}attach-a`);
    const tabB = await openTab(chrome.port, `${fixture.url}attach-b`);
    assert.equal(await evaluateInTab(tabA, 'window.__marker'), 'kept');
    assert.equal(await evaluateInTab(tabB, 'document.title'), 'Attach B');
    proxy = await startCountingProxy(chrome.port);
  });

  after(async () => {
    await runCommand('stop', [], { timeout: 15000, env });
    await proxy.close();
    await chrome.kill();
    await fixture.close();
    fs.rmSync(sessionDir, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  });

  void it('requires --chrome-ws-url (exit 81 naming the flag)', async () => {
    const { exitCode, envelope } = await runJson('attach', ['attach-a']);
    assert.equal(exitCode, 81);
    assert.match(envelope.suggestion ?? '', /--chrome-ws-url/);
  });

  void it('lists the page tabs over one connection and leaves no session', async () => {
    const before = proxy.upgrades();
    const { exitCode, envelope } = await runJson<TabsData>('attach', [
      '--chrome-ws-url',
      String(proxy.port),
    ]);
    assert.equal(exitCode, 0, JSON.stringify(envelope));
    const urls = envelope.data?.tabs.map((tab) => tab.url) ?? [];
    assert.ok(urls.some((url) => url.endsWith('/attach-a')));
    assert.ok(urls.some((url) => url.endsWith('/attach-b')));
    assert.deepEqual(
      envelope.data?.tabs.map((tab) => tab.index),
      urls.map((_url, index) => index)
    );
    assert.equal(proxy.upgrades() - before, 1);

    const human = await run('attach', ['--chrome-ws-url', String(proxy.port)]);
    assert.match(human.output, /\[\d\] Attach A — http:\/\/127\.0\.0\.1:\d+\/attach-a/);
    assert.equal(fs.existsSync(path.join(sessionDir, 'daemon.sock')), false);
  });

  void it('refuses several matches (81) and no match (83)', async () => {
    const several = await runJson('attach', ['Attach', '--chrome-ws-url', String(proxy.port)]);
    assert.equal(several.exitCode, 81);
    assert.match(several.envelope.suggestion ?? '', /index/i);
    const none = await runJson('attach', ['nowhere', '--chrome-ws-url', String(proxy.port)]);
    assert.equal(none.exitCode, 83);
    assert.match(none.envelope.suggestion ?? '', /Attach B/);
  });

  void it('attaches to the named tab without reloading it, over one WebSocket', async () => {
    const before = proxy.upgrades();
    const start = await runJson<StartData>('attach', [
      'attach-a',
      '--chrome-ws-url',
      String(proxy.port),
    ]);
    assert.equal(start.exitCode, 0, JSON.stringify(start.envelope));
    assert.match(start.envelope.data?.targetUrl ?? '', /\/attach-a$/);
    assert.equal(start.envelope.data?.attached, true);

    const marker = await run('cdp', [
      'Runtime.evaluate',
      '--params',
      '{"expression":"window.__marker","returnByValue":true}',
    ]);
    assert.match(marker.output, /kept/);

    const consoleOutput = await run('console', []);
    assert.match(consoleOutput.output, /early error from tab A/);

    const query = await run('dom', ['query', '#attach-heading']);
    assert.equal(query.exitCode, 0, query.output);
    assert.match(query.output, /Tab A/);

    const shot = path.join(sessionDir, 'attach.png');
    const screenshot = await run('dom', ['screenshot', shot]);
    assert.equal(screenshot.exitCode, 0, screenshot.output);
    assert.ok(fs.statSync(shot).size > 0);

    const status = await runJson<{ attached?: boolean }>('status', []);
    assert.equal(status.envelope.data?.attached, true);

    const kill = await runJson('stop', ['--kill-chrome']);
    assert.equal(kill.exitCode, 81);

    const stop = await run('stop', []);
    assert.equal(stop.exitCode, 0, stop.output);
    assert.equal(proxy.upgrades() - before, 1);

    const pages = await chromePages(chrome.port);
    assert.ok(pages.some((page) => page.url.endsWith('/attach-a')));
    assert.ok(pages.some((page) => page.url.endsWith('/attach-b')));
    assert.equal(await evaluateInTab(tabA, 'window.__marker'), 'kept');
  });
});
