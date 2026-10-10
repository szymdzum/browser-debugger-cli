/**
 * Screenshot layout smoke test (#514).
 *
 * A capture beyond the viewport (a full page, an element larger than the
 * viewport) has Chrome lay the page out at the captured size, without the
 * page's scrollbar. Afterwards the page must be laid out as before: the
 * window size, the visible width and height (`clientWidth` is `innerWidth`
 * minus the scrollbar), the pixel ratio and touch. Each read happens right
 * after the screenshot command exited, with no polling: the daemon runs page
 * commands only once the capture's restore is done (#537).
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

/** What the page's layout depends on: window size, visible size, pixel ratio, touch */
const PAGE_METRICS_JS =
  '[innerWidth, innerHeight, document.documentElement.clientWidth, document.documentElement.clientHeight, devicePixelRatio, navigator.maxTouchPoints]';

/** Whether the page's vertical scrollbar takes space */
const SHOWS_SCROLLBAR_JS = 'document.documentElement.clientWidth < innerWidth';

/** Makes the page scroll: a box in view and a column taller than the viewport */
const TALL_PAGE_JS = `document.body.insertAdjacentHTML('beforeend', '<div id="box" style="width: 200px; height: 100px; margin: auto"></div><div id="tall" style="width: 400px; height: 2000px; margin: auto"></div>'); 1`;

/**
 * Run a bdg command and assert its exit code.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${output}`);
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
 * Take a screenshot and check the page measures as before right after it.
 *
 * @param args - Screenshot arguments after the file
 * @returns The screenshot's capture mode
 */
async function captureKeepsLayout(args: string[]): Promise<string> {
  const before = await evaluate(PAGE_METRICS_JS);
  const file = path.join(makeTempDir('bdg-shot-'), 'shot.png');
  const output = await bdg(['dom', 'screenshot', file, ...args, '--json']);
  assert.deepEqual(
    await evaluate(PAGE_METRICS_JS),
    before,
    `after dom screenshot ${args.join(' ')}`
  );
  return (JSON.parse(output) as { data: { captureMode: string } }).data.captureMode;
}

/**
 * Start a session on a scrollable fixture page for a describe block.
 *
 * @param startArgs - Extra session start arguments
 * @returns The fixture server, once the session runs
 */
function scrollablePageSession(startArgs: string[] = []): () => FixtureServer {
  let fixture: FixtureServer | undefined;
  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([fixture.url, '--port', String(port), '--headless', ...startArgs]);
    await evaluate(TALL_PAGE_JS);
  });
  after(async () => {
    await cleanupAllSessions();
    await fixture?.close();
  });
  return () => {
    assert.ok(fixture, 'fixture server not started');
    return fixture;
  };
}

after(removeTempDirs);

void describe('Screenshot layout: desktop', () => {
  scrollablePageSession();

  void it('a full-page capture leaves the scrollbar as it was, also the second time', async () => {
    assert.equal(await evaluate(SHOWS_SCROLLBAR_JS), true, 'the fixture page shows no scrollbar');
    assert.equal(await captureKeepsLayout([]), 'full_page');
    assert.equal(await captureKeepsLayout(['--no-resize']), 'full_page');
  });

  void it('a viewport capture and element captures leave the layout as it was', async () => {
    assert.equal(await captureKeepsLayout(['--no-full-page']), 'viewport');
    assert.equal(await captureKeepsLayout(['#box']), 'element');
    assert.equal(await captureKeepsLayout(['#tall']), 'element');
  });

  void it('a full-page capture under page emulate --viewport leaves its layout as it was', async () => {
    await bdg(['page', 'emulate', '--viewport', '1600x900']);
    try {
      assert.equal(await captureKeepsLayout([]), 'full_page');
      assert.equal(await captureKeepsLayout(['#tall']), 'element');
    } finally {
      await bdg(['page', 'emulate', '--reset']);
    }
    assert.equal(
      await evaluate(SHOWS_SCROLLBAR_JS),
      true,
      'no scrollbar after page emulate --reset'
    );
  });
});

void describe('Screenshot layout: --mobile session', () => {
  scrollablePageSession(['--mobile']);

  void it('a full-page capture keeps the phone layout, pixel ratio and touch', async () => {
    assert.deepEqual(((await evaluate(PAGE_METRICS_JS)) as number[]).slice(4), [3, 5]);
    assert.equal(await captureKeepsLayout(['--no-resize']), 'full_page');
    assert.equal(await captureKeepsLayout(['#tall']), 'element');
  });
});
