/**
 * Smoke tests for elements with no box of their own (`<slot>`, other
 * `display: contents` elements), against a real Chrome and the `/slots`
 * fixture page: `dom query` and `dom layout` place them by the content they
 * show (assigned nodes, else fallback content, text included) and call them
 * hidden only when none of it has a box.
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

/** Selector of every measured element on `/slots` */
const MEASURED =
  '#empty-slot, #none-slot, #zero-slot, #fallback-slot, #nested-slot, #inner-slot, #contents-text, #below-slot';

/** Layout fields the tests read */
interface MeasuredLayout {
  element: string;
  inViewport: string;
  hiddenReason?: string;
  bounds: { width: number; height: number };
}

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
 * Layout of every measured element, by its description (e.g. `slot#empty-slot`).
 *
 * @returns Layouts by element
 */
async function layouts(): Promise<Map<string, MeasuredLayout>> {
  const output = await bdg(['dom', 'layout', MEASURED, '--json']);
  const { elements } = (JSON.parse(output) as { data: { elements: MeasuredLayout[] } }).data;
  return new Map(elements.map((element) => [element.element, element]));
}

void describe('Elements with no box of their own', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}slots`, '--port', String(port), '--headless']);
    await bdg(['dom', 'wait', '--load']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('places slots showing assigned or fallback content by that content', async () => {
    const measured = await layouts();
    for (const element of ['slot#fallback-slot', 'slot#nested-slot', 'slot#inner-slot']) {
      const layout = measured.get(element);
      assert.equal(layout?.inViewport, 'visible', `${element}: ${JSON.stringify(layout)}`);
      assert.ok(layout.bounds.width > 0 && layout.bounds.height > 0, element);
    }
  });

  void it('places a display: contents element holding only text by its text', async () => {
    assert.equal((await layouts()).get('div#contents-text')?.inViewport, 'visible');
  });

  void it('places a slot by its content below the fold', async () => {
    assert.equal((await layouts()).get('slot#below-slot')?.inViewport, 'below');
  });

  void it('keeps a slot hidden when nothing it shows has a box', async () => {
    const measured = await layouts();
    assert.equal(measured.get('slot#empty-slot')?.inViewport, 'hidden');
    assert.equal(
      measured.get('slot#empty-slot')?.hiddenReason,
      'empty slot (nothing assigned, no fallback content)'
    );
    for (const element of ['slot#none-slot', 'slot#zero-slot']) {
      assert.equal(measured.get(element)?.inViewport, 'hidden', element);
      assert.equal(
        measured.get(element)?.hiddenReason,
        'display: contents (no box of its own)',
        element
      );
    }
  });

  void it('marks the same elements hidden in dom query as in dom layout', async () => {
    const output = await bdg(['dom', 'query', MEASURED]);
    const hidden = output.split('\n').filter((line) => line.endsWith('(hidden)'));
    assert.deepEqual(
      hidden.map((line) => /id="([^"]+)"/.exec(line)?.[1]),
      ['empty-slot', 'none-slot', 'zero-slot'],
      output
    );
  });
});
