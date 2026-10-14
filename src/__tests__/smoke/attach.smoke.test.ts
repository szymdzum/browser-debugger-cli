/**
 * `bdg attach` smoke test (#473): a Chrome started with
 * `--remote-debugging-port` has two tabs; bdg lists them, attaches to the one
 * a pattern names over a single browser-level WebSocket, without reloading
 * it (its `window.__marker` stays, the error it logged before the attach is
 * in `bdg console`), runs commands on it, and `bdg stop` leaves both tabs.
 *
 * A screenshot of a background tab exits 85 at once (with bdg's focus
 * emulation turned off, macOS headless Chrome renders no frame of it, as
 * Linux never does). A download the tab starts is recorded, one started by another tab is not;
 * both are saved into the throwaway profile's download folder. Closing the
 * attached tab ends the session as `closed`; `bdg cleanup` (plain and
 * `--force`) leaves Chrome and its tabs alone.
 *
 * bdg reaches Chrome through a TCP proxy that counts the WebSocket upgrades
 * it forwards.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

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
 * Evaluate an expression in a tab over a connection of the test's own, as
 * a user gesture (Chrome blocks downloads a cross-site iframe starts without one).
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
      userGesture: true,
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

/**
 * Wait for a condition on files (the daemon's socket, a download).
 *
 * @param condition - The condition
 */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 20000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'condition not met within 20 s');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

void describe('bdg attach', () => {
  let fixture: FixtureServer;
  let chrome: LaunchedChrome;
  let proxy: CountingProxy;
  let tabA: CDPTarget;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-attach-profile-'));
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-attach-downloads-'));
  let tabB: CDPTarget;

  before(async () => {
    fixture = await startFixtureServer();
    fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
    fs.writeFileSync(
      path.join(profile, 'Default', 'Preferences'),
      JSON.stringify({ download: { default_directory: downloadDir, prompt_for_download: false } })
    );
    chrome = await launchChrome({
      port: await freePort(),
      userDataDir: profile,
      headless: true,
      sessionDir: profile,
      chromeFlags: [
        '--host-resolver-rules=MAP inner.test 127.0.0.1',
        `--unsafely-treat-insecure-origin-as-secure=http://inner.test:${new URL(fixture.url).port}`,
      ],
    });
    tabB = await openTab(chrome.port, `${fixture.url}attach-b`);
    tabA = await openTab(chrome.port, `${fixture.url}attach-a`);
    assert.equal(await evaluateInTab(tabA, 'window.__marker'), 'kept');
    assert.equal(await evaluateInTab(tabB, 'document.title'), 'Attach B');
    proxy = await startCountingProxy(chrome.port);
  });

  afterEach(async () => {
    await runCommand('stop', [], { timeout: 15000, env });
  });

  after(async () => {
    await runCommand('stop', [], { timeout: 15000, env });
    await proxy.close();
    await chrome.kill().catch(() => undefined);
    await fixture.close();
    fs.rmSync(sessionDir, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(downloadDir, { recursive: true, force: true });
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

    const click = await runJson<{ downloads?: { suggestedFilename: string }[] }>('dom', [
      'click',
      '#attach-download',
    ]);
    assert.equal(click.exitCode, 0, JSON.stringify(click.envelope));
    assert.deepEqual(
      click.envelope.data?.downloads?.map((d) => d.suggestedFilename),
      ['note.html']
    );
    await evaluateInTab(
      tabB,
      "Object.assign(document.createElement('a'), { href: '/attach-a', download: 'other.html' }).click()"
    );
    await until(() => fs.readdirSync(downloadDir).includes('other.html'));
    const peek = await runJson<{ downloads?: { suggestedFilename: string }[] }>('peek', []);
    assert.deepEqual(
      peek.envelope.data?.downloads?.map((d) => d.suggestedFilename),
      ['note.html']
    );

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

  void it('refuses a screenshot of a background tab at once (85) and never brings it to the front', async () => {
    const start = await runJson('attach', ['attach-b', '--chrome-ws-url', String(proxy.port)]);
    assert.equal(start.exitCode, 0, JSON.stringify(start.envelope));
    const unfocused = await run('cdp', [
      'Emulation.setFocusEmulationEnabled',
      '--params',
      '{"enabled":false}',
    ]);
    assert.equal(unfocused.exitCode, 0, unfocused.output);
    const began = Date.now();
    const shot = await runJson('dom', ['screenshot', path.join(sessionDir, 'hidden.png')]);
    assert.equal(shot.exitCode, 85, JSON.stringify(shot.envelope));
    assert.match(shot.envelope.error ?? '', /in the background/);
    assert.match(shot.envelope.suggestion ?? '', /Bring the tab to the front/);
    assert.ok(Date.now() - began < 10000, 'refused without waiting');
    assert.equal(await evaluateInTab(tabB, 'document.visibilityState'), 'hidden');
    assert.equal(await evaluateInTab(tabA, 'document.visibilityState'), 'visible');
  });

  void it('ends the session as closed when the attached tab closes', async () => {
    const start = await runJson('attach', ['attach-b', '--chrome-ws-url', String(proxy.port)]);
    assert.equal(start.exitCode, 0, JSON.stringify(start.envelope));
    await fetch(`http://127.0.0.1:${chrome.port}/json/close/${tabB.id}`);
    await until(() => !fs.existsSync(path.join(sessionDir, 'daemon.sock')));
    const status = await runJson<{ lastSession?: { reason?: string } }>('status', []);
    assert.equal(status.envelope.data?.lastSession?.reason, 'closed');
    assert.ok((await chromePages(chrome.port)).some((page) => page.url.endsWith('/attach-a')));
  });

  void it('bdg cleanup and cleanup --force leave Chrome and the tab alone', async () => {
    const start = await runJson('attach', ['attach-a', '--chrome-ws-url', String(proxy.port)]);
    assert.equal(start.exitCode, 0, JSON.stringify(start.envelope));
    await run('cleanup', []);
    assert.equal(await evaluateInTab(tabA, 'window.__marker'), 'kept');
    const forced = await run('cleanup', ['--force']);
    assert.equal(forced.exitCode, 0, forced.output);
    assert.equal(fs.existsSync(path.join(sessionDir, 'daemon.sock')), false);
    assert.equal(await evaluateInTab(tabA, 'window.__marker'), 'kept');
    await run('cleanup', []);
    assert.equal(await evaluateInTab(tabA, 'window.__marker'), 'kept');
  });

  void it('records a download from a cross-site (out-of-process) iframe of the tab', async () => {
    await openTab(chrome.port, `${fixture.url}attach-frame`);
    const start = await runJson('attach', ['attach-frame', '--chrome-ws-url', String(proxy.port)]);
    assert.equal(start.exitCode, 0, JSON.stringify(start.envelope));
    try {
      const targets = (await (
        await fetch(`http://127.0.0.1:${chrome.port}/json/list`)
      ).json()) as CDPTarget[];
      const frame = targets.find(
        (t) => t.type === 'iframe' && t.url.includes('attach-frame-inner')
      );
      assert.ok(frame, 'the inner page runs out of process');
      await evaluateInTab(frame, "document.getElementById('inner-download').click()");
      await until(() => fs.readdirSync(downloadDir).includes('inner.html'));
      const peek = await runJson<{ downloads?: { suggestedFilename: string }[] }>('peek', []);
      assert.ok(
        peek.envelope.data?.downloads?.some((d) => d.suggestedFilename === 'inner.html'),
        JSON.stringify(peek.envelope.data?.downloads)
      );
    } finally {
      await run('stop', []);
    }
  });

  void it('does not call it a closed tab when the whole Chrome goes away', async () => {
    const start = await runJson('attach', ['attach-a', '--chrome-ws-url', String(proxy.port)]);
    assert.equal(start.exitCode, 0, JSON.stringify(start.envelope));
    await chrome.kill();
    await until(() => !fs.existsSync(path.join(sessionDir, 'daemon.sock')));
    const status = await runJson<{ lastSession?: { reason?: string } }>('status', []);
    assert.ok(status.envelope.data?.lastSession?.reason, JSON.stringify(status.envelope));
    assert.notEqual(status.envelope.data?.lastSession?.reason, 'closed');
  });
});
