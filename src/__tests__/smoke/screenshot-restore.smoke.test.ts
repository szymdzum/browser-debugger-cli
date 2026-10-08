/**
 * Screenshot emulation smoke test.
 *
 * A screenshot changes the page's emulation for the capture (scrollbars
 * hidden and the viewport overridden for an element beyond the viewport, a
 * pixel ratio of 1 on a high-DPI page) and puts it back afterwards. Ctrl-C on
 * the screenshot command must not leave it changed: the page is measured
 * before, the command interrupted while the emulation is changed, and the page
 * must measure the same afterwards.
 */

import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';

/** What the page's layout depends on: window size, visible width, pixel ratio */
const PAGE_METRICS_JS =
  '[innerWidth, innerHeight, document.documentElement.clientWidth, devicePixelRatio]';

/**
 * How long the page stays busy once the capture changed its emulation. The
 * test sends Ctrl-C within one 20 ms beacon poll of the change, so the
 * capture is still held when it arrives, with about 3 s to spare.
 */
const BUSY_MS = 3000;

/**
 * Page-side trap: on the first change of the window size or the pixel ratio
 * (the capture's emulation), tell the fixture server (`/beacon?changed`, a
 * synchronous request, so the server has it before the page turns busy) and
 * keep the page busy for {@link BUSY_MS} right away, in the change handler.
 *
 * The change is handled in the rendering update that applies the new
 * emulation, and `Page.captureScreenshot` waits for the frame that update
 * produces, so the capture cannot end before the busy loop does and is still
 * running when the test interrupts it. A busy loop started later (a timer)
 * would race the capture: at a changed pixel ratio a viewport capture ends
 * about 30 ms after the change, before a 100 ms timer fires.
 */
const TRAP_JS = `(() => {
  let armed = true;
  const changed = () => {
    if (!armed) return;
    armed = false;
    const beacon = new XMLHttpRequest();
    beacon.open('GET', '/beacon?changed', false);
    beacon.send();
    const end = Date.now() + ${BUSY_MS};
    while (Date.now() < end);
  };
  addEventListener('resize', changed);
  matchMedia('(resolution: ' + devicePixelRatio + 'dppx)').addEventListener('change', changed);
  return true;
})()`;

/**
 * Run a bdg command and assert its exit code.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @param expectedExit - Expected process exit code
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[], expectedExit = 0): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, expectedExit, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

/**
 * Evaluate an expression in the page and return its JSON-decoded result.
 *
 * @param expression - JavaScript expression
 * @returns Evaluation result
 */
async function evaluate(expression: string): Promise<unknown> {
  const output = await bdg(['dom', 'eval', expression, '--json']);
  return (JSON.parse(output) as { data: { result: unknown } }).data.result;
}

/**
 * Wait until the page measures as expected, or the time runs out. The
 * restore can land just after the interrupted command exits (#519); it takes
 * well under a second, the wait allows 15 s.
 *
 * @param expected - Metrics before the capture
 * @returns The last metrics read
 */
async function metricsBack(expected: unknown): Promise<unknown> {
  const deadline = Date.now() + 15000;
  let metrics = await evaluate(PAGE_METRICS_JS);
  while (JSON.stringify(metrics) !== JSON.stringify(expected) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    metrics = await evaluate(PAGE_METRICS_JS);
  }
  return metrics;
}

after(removeTempDirs);

void describe('Screenshot emulation', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([fixture.url, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  /**
   * Take a screenshot, interrupt it (Ctrl-C) once it changed the page's
   * emulation, and check the page measures as before.
   *
   * @param args - Screenshot arguments after the file
   */
  async function interruptCapture(args: string[]): Promise<void> {
    const metrics = await evaluate(PAGE_METRICS_JS);
    await evaluate(TRAP_JS);
    fixture.beacons.length = 0;
    const file = path.join(makeTempDir('bdg-shot-'), 'shot.png');
    const ctrlC = new AbortController();
    const shot = runCommand('dom', ['screenshot', file, ...args], {
      timeout: 60000,
      interrupt: ctrlC.signal,
    });
    const deadline = Date.now() + 20000;
    while (!fixture.beacons.includes('changed') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(fixture.beacons.includes('changed'), 'the capture never changed the emulation');
    ctrlC.abort();
    assert.equal((await shot).exitCode, 130);
    assert.deepEqual(await metricsBack(metrics), metrics);
  }

  void it('Ctrl-C during an element capture beyond the viewport leaves the viewport as it was', async () => {
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', '<div id="tall" style="width: 400px; height: 3000px; margin: auto"></div>'); 1`
    );
    try {
      await interruptCapture(['#tall']);
    } finally {
      await evaluate("document.getElementById('tall').remove(); 1");
    }
  });

  void it('Ctrl-C during a capture of a phone page leaves its pixel ratio as it was', async () => {
    await bdg(['page', 'emulate', '--mobile']);
    try {
      assert.equal(await evaluate('devicePixelRatio'), 3);
      await interruptCapture(['--no-full-page']);
    } finally {
      await bdg(['page', 'emulate', '--reset']);
    }
  });
});
