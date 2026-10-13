/**
 * Smoke test for the loading state in `status` and `peek` (#640): while the
 * document is still `loading` (a slow head script blocks the parser) both say so,
 * human and `--json`, in the words `page navigate` and the start use; the
 * line is gone once the page has loaded. Human `peek` starts with the page's
 * URL and title.
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
import { LOADING_SLOW_TITLE } from '@/__testutils__/fixturePages/loadingStateFixtures.js';

/** The words `page navigate` and the start print for a page still loading */
const LOADING_LINE = /The page is still loading \(document\.readyState: loading\)/;

/** The loading field of the `--json` surfaces */
interface LoadingField {
  readyState: string;
  pending: Array<{ url: string }>;
  pendingCount: number;
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
 * The loading field of `status --json` and `peek --json`.
 *
 * @returns Both fields (undefined when absent)
 */
async function jsonLoading(): Promise<Record<'status' | 'peek', LoadingField | undefined>> {
  const status = JSON.parse((await bdg(['status', '--json'])).stdout) as {
    data: { pageState: { loading?: LoadingField } };
  };
  const peek = JSON.parse((await bdg(['peek', '--json'])).stdout) as {
    data: { target: { loading?: LoadingField } };
  };
  return { status: status.data.pageState.loading, peek: peek.data.target.loading };
}

/**
 * Poll until a condition holds (within 30 s).
 *
 * @param condition - Check to repeat
 * @param message - Failure message
 */
async function waitUntil(condition: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(message);
}

void describe('loading state in status and peek (#640)', () => {
  let fixture: FixtureServer;
  let origin: string;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    origin = fixture.url.replace(/\/$/, '');
    await bdg([`${origin}/action-errors`, '--port', String(await getFreePort()), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('human peek starts with the page URL and title', async () => {
    const { stdout } = await bdg(['peek']);
    assert.ok(stdout.includes(`${origin}/action-errors`), stdout);
    assert.match(stdout, /PREVIEW[^\n]*\n[^\n]*action-errors/);
    assert.doesNotMatch(stdout, LOADING_LINE);
  });

  void it('a page whose parser is blocked by a slow script shows as loading until it has loaded', async () => {
    const navigation = runCommand('page', ['navigate', `${origin}/loading-slow-script`], {
      timeout: 90000,
    });
    await waitUntil(
      async () => (await jsonLoading()).status !== undefined,
      'status never showed the loading state'
    );
    const loading = await jsonLoading();
    assert.equal(loading.status?.readyState, 'loading');
    assert.equal(loading.peek?.readyState, 'loading');
    assert.ok(loading.status.pending.some((request) => request.url.endsWith('/slow')));
    const status = (await bdg(['status'])).stdout;
    assert.match(status, /waiting on: GET [^\n]*\/slow/);
    const peek = (await bdg(['peek'])).stdout;
    assert.match(status, LOADING_LINE);
    assert.match(peek, LOADING_LINE);
    assert.match(
      status,
      new RegExp(`Session active: [^\\n]*${LOADING_SLOW_TITLE}\\n[^\\n]*loading`)
    );
    assert.ok(peek.includes(`${origin}/loading-slow-script`), peek);

    await navigation;
    await waitUntil(
      async () => (await jsonLoading()).status === undefined,
      'status still showed the loading state after the page loaded'
    );
    const done = await jsonLoading();
    assert.equal(done.peek, undefined);
    assert.doesNotMatch((await bdg(['status'])).stdout, LOADING_LINE);
    assert.doesNotMatch((await bdg(['peek'])).stdout, LOADING_LINE);
  });
});
