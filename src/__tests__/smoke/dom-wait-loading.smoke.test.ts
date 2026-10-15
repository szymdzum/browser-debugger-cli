/**
 * Smoke test for the `bdg dom wait` timeout on a page that is still loading
 * (#775): a head script whose server answers late keeps the document
 * `loading`; the timeout names the request it waits on in the words of the
 * start's warning, and `--json` carries it as `errorContext.pending`.
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

/** The timeout error of `dom wait` as `--json` prints it */
interface WaitTimeoutEnvelope {
  success: boolean;
  error: string;
  exitCode: number;
  suggestion?: string;
  pending?: Array<{ method: string; url: string; pendingMs: number }>;
  pendingCount?: number;
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
 * Poll until the status says the page is loading (within 30 s).
 */
async function waitUntilLoading(): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const status = JSON.parse((await bdg(['status', '--json'])).stdout) as {
      data: { pageState: { loading?: unknown } };
    };
    if (status.data.pageState.loading !== undefined) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail('status never showed the loading state');
}

void describe('dom wait timeout on a loading page (#775)', () => {
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

  void it('names the requests the page waits on, human and --json', async () => {
    const navigation = runCommand('page', ['navigate', `${origin}/wait-load-hang`], {
      timeout: 90000,
    });
    await waitUntilLoading();

    const human = await runCommand('dom', ['wait', '--load', '--timeout', '500'], {
      timeout: 60000,
    });
    assert.equal(human.exitCode, 102, human.stdout + human.stderr);
    assert.match(
      human.stderr,
      /The page is still loading[^\n]*waiting on: GET [^\n]*\/slow \(pending /
    );

    const json = await runCommand('dom', ['wait', '--load', '--timeout', '500', '--json'], {
      timeout: 60000,
    });
    assert.equal(json.exitCode, 102, json.stdout + json.stderr);
    const envelope = JSON.parse(json.stdout) as WaitTimeoutEnvelope;
    assert.equal(envelope.pending?.[0]?.method, 'GET');
    assert.ok(envelope.pending?.[0]?.url.endsWith('/slow'), json.stdout);
    assert.ok((envelope.pendingCount ?? 0) >= 1, json.stdout);

    await navigation;
  });
});
