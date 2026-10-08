/**
 * Page readiness smoke test.
 *
 * A page stuck loading on a script whose server never answers (`/hanging`)
 * is reported by the start and by `bdg page`, and "not found" errors on it
 * suggest `dom wait`; `dom scroll`, `dom form` and a `dom submit` timeout
 * say what is still loading. `dom wait` waits for timer-based results
 * (`/dynamic-loading`): visible, text, gone, and a timeout that says what it
 * saw last.
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

/**
 * Run a bdg command and assert its exit code.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @param expectedExit - Expected process exit code
 * @returns stdout and stderr
 */
async function bdg(
  args: string[],
  expectedExit = 0
): Promise<{ stdout: string; stderr: string; output: string }> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, expectedExit, `bdg ${args.join(' ')}: ${output}`);
  return { stdout: result.stdout, stderr: result.stderr, output };
}

/** JSON envelope of `bdg <url> --json` / `bdg page navigate --json` */
interface LoadingEnvelope {
  data: { loading?: { readyState: string; pending: Array<{ url: string }>; pendingCount: number } };
}

/** JSON envelope of `bdg dom wait --json` */
interface WaitEnvelope {
  data: { elapsedMs: number; count: number; visibleCount: number; readyState: string };
}

void describe('Page readiness', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('start warns about a page still loading and names the pending script', async () => {
    const port = await getFreePort();
    const { stdout } = await bdg([
      `${fixture.url}hanging`,
      '--port',
      String(port),
      '--headless',
      '--json',
    ]);
    const loading = (JSON.parse(stdout) as LoadingEnvelope).data.loading;
    assert.equal(loading?.readyState, 'loading');
    assert.ok(
      loading.pending.some((request) => request.url.endsWith('/never.js')),
      stdout
    );
  });

  void it('"not found" errors on the loading page suggest dom wait', async () => {
    const query = await bdg(['dom', 'query', '#late'], 83);
    assert.match(query.output, /The page is still loading \(document\.readyState: loading\)/);
    assert.match(query.output, /bdg dom wait '#late'/);

    const click = await bdg(['dom', 'click', '#late'], 83);
    assert.match(click.output, /bdg dom wait '#late'/);

    const layout = await bdg(['dom', 'layout', '#late'], 83);
    assert.match(layout.output, /still loading/);

    const frames = await bdg(['dom', 'frames']);
    assert.match(
      frames.stdout,
      /^No iframes yet; the page is still loading, so the list may be incomplete \(bdg dom wait --load\)/
    );
    assert.doesNotMatch(frames.stdout, /The page has no iframes/);
  });

  void it('dom wait on the loading page times out with what it saw', async () => {
    const { output } = await bdg(['dom', 'wait', '#late', '--timeout', '800'], 102);
    assert.match(
      output,
      /Timed out after 800ms waiting for #late to appear \(last seen: no matches, document\.readyState: loading\)/
    );
    assert.match((await bdg(['dom', 'wait', '#ready'])).stdout, /^✓ #ready found after \d+\.\ds/);
  });

  void it('dom scroll on the loading page says nothing scrolled and that it is still loading', async () => {
    const { stdout } = await bdg(['dom', 'scroll', '--bottom']);
    assert.match(stdout, /^⚠ Page Scrolled \(with warnings\)/);
    assert.match(
      stdout,
      /Nothing to scroll: the document is no taller than the viewport \(\d+px\)\. The page is still loading \(document\.readyState: loading\)/
    );
  });

  void it('dom form on a page without a body yet says it is still loading, not a script error', async () => {
    await bdg(['page', 'navigate', `${fixture.url}hanging-head`]);
    const { output } = await bdg(['dom', 'form'], 88);
    assert.match(output, /No forms discovered on the page yet; it is still loading/);
    assert.match(output, /bdg dom wait --load/);
    assert.doesNotMatch(output, /Uncaught/);
  });

  /**
   * The POST starts within milliseconds of the submit and the report comes
   * right at the 1500 ms timeout, so "pending for 1.Xs" has about 500 ms to
   * spare on either side.
   */
  void it('a submit timeout names the page request the server has not answered', async () => {
    await bdg(['page', 'navigate', `${fixture.url}hanging-login`]);
    const { output } = await bdg(
      ['dom', 'submit', '#login', '--wait-navigation', '--timeout', '1500'],
      102
    );
    assert.match(
      output,
      /timed out after 1500ms waiting for navigation: POST 127\.0\.0\.1:\d+\/authenticate-hanging pending for 1\.\ds/
    );
    assert.match(output, /has not answered the page request yet/);
  });

  /**
   * The result shows 1500 ms after the click. The wait is started together
   * with the click rather than after it returns (the click waits for the page
   * to settle, 400–700 ms on a laptop and more on a slow runner, which ate
   * into the 1 s margin), so it waits about 1.5 s, 1 s more than required.
   */
  void it('dom wait follows timer-based loading: visible, gone and text', async () => {
    await bdg(['page', 'navigate', `${fixture.url}dynamic-loading`]);
    const waiting = bdg(['dom', 'wait', '#finish', '--visible', '--json']);
    await bdg(['dom', 'click', '#start button']);
    const visible = await waiting;
    const data = (JSON.parse(visible.stdout) as WaitEnvelope).data;
    assert.equal(data.visibleCount, 1);
    assert.ok(data.elapsedMs > 500, `waited ${data.elapsedMs}ms`);
    assert.match((await bdg(['dom', 'wait', '#loading', '--gone'])).stdout, /✓ #loading gone/);
    assert.match(
      (await bdg(['dom', 'wait', '#status', '--text', 'done'])).stdout,
      /✓ #status with text "done" found/
    );
  });

  void it('dom wait times out naming hidden matches', async () => {
    await bdg(['page', 'reload']);
    const { output } = await bdg(['dom', 'wait', '#finish', '--visible', '--timeout', '500'], 102);
    assert.match(output, /\(last seen: 1 match, none visible\)/);
    assert.match(output, /bdg dom layout '#finish'/);
  });

  void it('page navigate warns about a page still loading', async () => {
    const { stdout } = await bdg(['page', 'navigate', `${fixture.url}hanging`, '--json']);
    const loading = (JSON.parse(stdout) as LoadingEnvelope).data.loading;
    assert.equal(loading?.readyState, 'loading');
    assert.ok(
      loading.pending.some((request) => request.url.endsWith('/never.js')),
      stdout
    );
  });
});
