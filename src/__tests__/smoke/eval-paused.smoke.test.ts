/**
 * `eval` on a page paused in the debugger names the pause (#857): exit 85
 * and a resume suggestion, not "result too large to send" (exit 102).
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

const COMMAND_TIMEOUT_MS = 60_000;

/** The second `eval` fails as soon as the pause is known, well under the old 13 s wait */
const FAST_MS = 10_000;

void describe('eval on a paused page', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const start = await runCommand(
      `${fixture.url}paused`,
      ['--port', String(await getFreePort()), '--headless'],
      { timeout: COMMAND_TIMEOUT_MS }
    );
    assert.equal(start.exitCode, 0, start.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  /** Wait until the page sent the beacon from the click handler */
  async function untilClicked(): Promise<void> {
    const deadline = Date.now() + COMMAND_TIMEOUT_MS;
    while (!fixture.beacons.includes('paused') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(fixture.beacons.includes('paused'), 'the click handler never ran');
  }

  void it('names the pause, suggests resuming and exits 85; works again after the resume', async () => {
    const enable = await runCommand('cdp', ['Debugger.enable'], { timeout: COMMAND_TIMEOUT_MS });
    assert.equal(enable.exitCode, 0, enable.stderr);
    const click = await runCommand(
      'cdp',
      [
        'Runtime.evaluate',
        '--params',
        JSON.stringify({
          expression: `setTimeout(() => document.getElementById('b').click(), 100)`,
        }),
      ],
      { timeout: COMMAND_TIMEOUT_MS }
    );
    assert.equal(click.exitCode, 0, click.stderr);
    await untilClicked();

    const first = await runCommand('eval', ['1+1'], { timeout: COMMAND_TIMEOUT_MS });
    assert.equal(first.exitCode, 85, first.stderr);
    assert.match(first.stderr, /paused in the debugger/i);
    assert.doesNotMatch(first.stderr, /too large/i);
    assert.match(first.stderr, /bdg cdp Debugger\.resume/);

    const startedAt = Date.now();
    const second = await runCommand('eval', ['1+1', '--json'], { timeout: COMMAND_TIMEOUT_MS });
    assert.ok(Date.now() - startedAt < FAST_MS, 'the pause was known, so no long wait');
    assert.equal(second.exitCode, 85, second.stderr + second.stdout);
    const envelope = JSON.parse(second.stdout) as Record<string, unknown>;
    assert.equal(envelope['success'], false);
    assert.equal(envelope['exitCode'], 85);
    assert.match(String(envelope['error']), /paused in the debugger/i);
    assert.match(String(envelope['suggestion']), /bdg cdp Debugger\.resume/);

    const resume = await runCommand('cdp', ['Debugger.resume'], { timeout: COMMAND_TIMEOUT_MS });
    assert.equal(resume.exitCode, 0, resume.stderr);
    const title = await runCommand('eval', ['document.title'], { timeout: COMMAND_TIMEOUT_MS });
    assert.equal(title.exitCode, 0, title.stderr);
    assert.match(title.stdout, /after/);
  });
});
