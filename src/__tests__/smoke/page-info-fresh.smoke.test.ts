/**
 * Smoke test for the page's title and URL in `page info`, `status` and
 * `peek` (#640): a title a script sets after the page loaded shows up, and
 * after a full-page navigation the URL keeps its fragment. A fragment
 * that carries a token shows masked on every surface, human and `--json`.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

/** Shown instead of a secret value */
const MASK = '••••';

/** Value of the token in the fragment of the secret URL */
const TOKEN = 'TOK-640-SECRET';

/** What a surface shows about the page */
interface PageView {
  url: string;
  title: string;
}

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list
 * @returns stdout and stderr
 */
async function bdg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/**
 * Run a bdg command with `--json` and return its data.
 *
 * @param args - Full bdg argument list without `--json`
 * @returns The envelope's data
 */
async function bdgData<T>(args: string[]): Promise<T> {
  const { stdout } = await bdg([...args, '--json']);
  return (JSON.parse(stdout) as { data: T }).data;
}

/** The page as every surface reports it, `--json` */
const SURFACES: Record<string, () => Promise<PageView>> = {
  'page info': () => bdgData<PageView>(['page', 'info']),
  status: async () => {
    const data = await bdgData<{ pageState: PageView }>(['status']);
    return data.pageState;
  },
  peek: async () => {
    const data = await bdgData<{ target: PageView }>(['peek']);
    return data.target;
  },
};

/**
 * Wait until a surface reports the expected URL and title (within 15 s).
 *
 * @param name - Surface name
 * @param expected - Expected fields
 */
async function waitForSurface(name: string, expected: Partial<PageView>): Promise<void> {
  const read = SURFACES[name];
  assert.ok(read, name);
  const deadline = Date.now() + 15000;
  let view: PageView = { url: '', title: '' };
  while (Date.now() < deadline) {
    view = await read();
    const urlOk = expected.url === undefined || view.url === expected.url;
    const titleOk = expected.title === undefined || view.title === expected.title;
    if (urlOk && titleOk) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.deepEqual(
    view,
    { url: expected.url ?? view.url, title: expected.title ?? view.title },
    name
  );
}

void describe('page title and URL in page info, status and peek (#640)', () => {
  let fixture: FixtureServer;
  let origin: string;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    origin = fixture.url.replace(/\/$/, '');
    const port = await getFreePort();
    await bdg([`${origin}/action-errors`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('a title a script sets shows on every surface', async () => {
    await bdg(['dom', 'click', '#quiet']);
    for (const name of Object.keys(SURFACES)) {
      await waitForSurface(name, { title: 'quiet clicked' });
    }
    const human = await bdg(['page', 'info']);
    assert.match(human.stdout, /Title: +quiet clicked/);
  });

  void it('a navigation to a URL with a fragment keeps the fragment on every surface', async () => {
    const url = `${origin}/action-errors?v=2#section-640`;
    await bdg(['page', 'navigate', url]);
    for (const name of Object.keys(SURFACES)) {
      await waitForSurface(name, { url });
    }
    assert.ok((await bdg(['page', 'info'])).stdout.includes(url));
    assert.ok((await bdg(['status'])).stdout.includes(url));
    assert.ok((await bdg(['peek'])).stdout.includes(url));
  });

  void it('a token in the fragment shows masked, never its value', async () => {
    await bdg(['page', 'navigate', `${origin}/action-errors?v=3#id_token=${TOKEN}`]);
    const masked = `${origin}/action-errors?v=3#id_token=${MASK}`;
    for (const name of Object.keys(SURFACES)) {
      await waitForSurface(name, { url: masked });
    }
    for (const args of [['page', 'info'], ['status'], ['peek']]) {
      const human = await bdg(args);
      const json = await bdg([...args, '--json']);
      for (const output of [human, json]) {
        assert.doesNotMatch(`${output.stdout}${output.stderr}`, new RegExp(TOKEN), args.join(' '));
      }
      assert.ok(human.stdout.includes(masked), `${args.join(' ')}: ${human.stdout}`);
    }
  });
});
