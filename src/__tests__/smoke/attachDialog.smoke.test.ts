/**
 * `bdg attach --dialog` smoke test (#869): an attach session drives the
 * user's own browser, where an accepted confirm() can submit or delete real
 * data, so its session default is dismiss (`bdg <url>` keeps accept).
 *
 * A Chrome the test launches (throwaway profile) has `/dialogs` open. Attach
 * without `--dialog` dismisses the confirm (the page sees false, the result
 * says dismissed, `bdg status` shows the default); `--dialog accept` accepts
 * it; a DOM action's own `--dialog` overrides the default; a beforeunload
 * dialog never blocks navigation; a bad value exits 81 with a suggestion;
 * `bdg <url>` still accepts.
 *
 * Timing: nothing waits for a timer. Each confirm opens synchronously in a
 * click handler that bdg waits on.
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

const sessionDir = fs.mkdtempSync('/tmp/bdg-attach-dialog-');
const env = { BDG_SESSION_DIR: sessionDir };

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
 * Run a bdg command.
 *
 * @param args - Command line
 * @returns Exit code and combined output
 */
async function bdg(args: string[]): Promise<{ exitCode: number; output: string }> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000, env });
  return { exitCode: result.exitCode, output: result.stdout + result.stderr };
}

/**
 * Read a value from the attached page.
 *
 * @param expression - Expression
 * @returns Its value
 */
async function evaluate(expression: string): Promise<unknown> {
  const { output } = await bdg(['eval', expression, '--json']);
  return (JSON.parse(output) as { data: { result: unknown } }).data.result;
}

void describe('bdg attach --dialog', () => {
  let fixture: FixtureServer;
  let chrome: LaunchedChrome;
  let endpoint: string;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-attach-dialog-profile-'));

  /**
   * Attach to the `/dialogs` tab of the test's Chrome.
   *
   * @param extra - Extra options
   * @returns The attach result
   */
  const attach = (extra: string[] = []): Promise<{ exitCode: number; output: string }> =>
    bdg(['attach', 'dialogs', '--chrome-ws-url', endpoint, ...extra]);

  before(async () => {
    fixture = await startFixtureServer();
    chrome = await launchChrome({
      port: await freePort(),
      userDataDir: profile,
      headless: true,
      sessionDir: profile,
      chromeFlags: [],
    });
    endpoint = `http://127.0.0.1:${chrome.port}`;
    const response = await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' });
    const target = (await response.json()) as CDPTarget;
    const cdp = await CDPConnection.create(target.webSocketDebuggerUrl);
    try {
      await cdp.send('Page.enable');
      const loaded = new Promise<void>((resolve) => cdp.on('Page.loadEventFired', () => resolve()));
      await cdp.send('Page.navigate', { url: `${fixture.url}dialogs` });
      await loaded;
    } finally {
      cdp.close();
    }
  });

  afterEach(async () => {
    await bdg(['stop']);
  });

  after(async () => {
    await bdg(['stop']);
    await chrome.kill().catch(() => undefined);
    await fixture.close();
    fs.rmSync(sessionDir, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  void it('dismisses a confirm() by default and shows the default in status', async () => {
    const started = await attach();
    assert.equal(started.exitCode, 0, started.output);
    const click = await bdg(['dom', 'click', '#conf']);
    assert.match(click.output, /Dialog: confirm\(\) dismissed: "Sure\?"/);
    assert.equal(await evaluate('window.confirmed'), false);

    assert.match((await bdg(['status'])).output, /Dialogs:\s+dismiss \(session default\)/);
    const status = JSON.parse((await bdg(['status', '--json'])).output) as {
      data: { dialog?: string };
    };
    assert.equal(status.data.dialog, 'dismiss');
  });

  void it('accepts with --dialog accept, in any case, and says so in status', async () => {
    const started = await attach(['--dialog', 'Accept']);
    assert.equal(started.exitCode, 0, started.output);
    assert.match((await bdg(['dom', 'click', '#conf'])).output, /confirm\(\) accepted/);
    assert.equal(await evaluate('window.confirmed'), true);
    assert.match((await bdg(['status'])).output, /Dialogs:\s+accept \(session default\)/);
  });

  void it('lets a DOM action override the default, and never blocks navigation', async () => {
    await attach(['--dialog', 'dismiss']);
    assert.match(
      (await bdg(['dom', 'click', '#conf', '--dialog', 'accept'])).output,
      /confirm\(\) accepted/
    );
    assert.equal(await evaluate('window.confirmed'), true);
    await bdg(['eval', 'window.guard = true']);
    await bdg(['page', 'navigate', `${fixture.url}dialogs-load-2`]);
    assert.equal(await evaluate('location.pathname'), '/dialogs-load-2');
    await bdg(['page', 'navigate', `${fixture.url}dialogs`]);
  });

  void it('refuses a bad --dialog with 81 and a suggestion', async () => {
    const bad = await attach(['--dialog', 'dismis']);
    assert.equal(bad.exitCode, 81, bad.output);
    assert.match(bad.output, /Did you mean: dismiss\?/);
  });

  void it('keeps accept as the default of bdg <url>', async () => {
    const port = await freePort();
    const started = await bdg([`${fixture.url}dialogs`, '--port', String(port), '--headless']);
    assert.equal(started.exitCode, 0, started.output);
    assert.match((await bdg(['dom', 'click', '#conf'])).output, /confirm\(\) accepted/);
    assert.equal(await evaluate('window.confirmed'), true);
    assert.doesNotMatch((await bdg(['status'])).output, /Dialogs:/);
  });
});
