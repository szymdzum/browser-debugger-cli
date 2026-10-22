/**
 * Action verdict smoke test (#891).
 *
 * A click or key press that changed a form control's property (value,
 * checked, selected option) or content in a same-origin frame did something,
 * so it is not reported as "nothing observed" (`effect: "none"`); a result
 * that arrives after the watch keeps the verdict, worded as what bdg watched
 * (about half a second); a click that changed nothing keeps it, also next to
 * a same-origin frame that updates itself.
 *
 * Timing: the handlers on `/verdict-props` run synchronously in the event,
 * so their change is there at the first read; `#late` writes 1500 ms after
 * the click, past the watch, and runs last. `/verdict-frame-ticker` is
 * clicked once its frame has ticked 4 times (`window.ticks`), so bdg's
 * history in the frame has seen it update itself.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { startFixtureServer, type FixtureServer } from '@/__testutils__/fixtureServer.js';
import { createSharedSession } from '@/__testutils__/sharedSession.js';

/** The verdict's status line wording (human output) */
const NOTHING_OBSERVED = /nothing observed within about half a second/;

/** The old wording, which read as "the action did nothing" */
const NO_VISIBLE_EFFECT = /no visible effect/;

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Standard output
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/**
 * Run a DOM action with `--json` and return its `effect`.
 *
 * @param args - Arguments after `dom`
 * @returns The result's `effect` field
 */
async function effectOf(args: string[]): Promise<string | undefined> {
  const output = await bdg(['dom', ...args, '--json']);
  return (JSON.parse(output) as { data: { effect?: string } }).data.effect;
}

/**
 * Assert that an action is not reported as having no effect, in JSON and in
 * human output.
 *
 * @param args - Arguments after `dom`
 */
async function assertEffect(args: string[]): Promise<void> {
  assert.equal(await effectOf(args), undefined, `dom ${args.join(' ')} --json`);
  const output = await bdg(['dom', ...args]);
  assert.doesNotMatch(output, NOTHING_OBSERVED);
  assert.doesNotMatch(output, NO_VISIBLE_EFFECT);
}

void describe('Action verdicts (#891)', () => {
  let fixture: FixtureServer;
  const open = createSharedSession();

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void describe('property and frame changes on /verdict-props', () => {
    before(() => open(`${fixture.url}verdict-props`));

    for (const selector of ['#val', '#chk', '#sel', '#frame-text', '#frame-val']) {
      void it(`does not say nothing was observed after a click on ${selector}`, async () => {
        await assertEffect(['click', selector]);
      });
    }

    void it('does not say nothing was observed after Enter that checked a checkbox', async () => {
      await assertEffect(['press-key', '#q3', 'Enter']);
    });

    for (const selector of ['#noop', '#fb']) {
      void it(`keeps the verdict for a click on ${selector} that changed nothing`, async () => {
        assert.equal(await effectOf(['click', selector]), 'none');
        const output = await bdg(['dom', 'click', selector]);
        assert.match(output, /^⚠ Element Clicked \(nothing observed within about half a second/m);
      });
    }

    void it('words the verdict for a late result as what bdg watched', async () => {
      const output = await bdg(['dom', 'click', '#late']);
      assert.match(output, NOTHING_OBSERVED);
      assert.match(output, /later results are not watched/);
      assert.doesNotMatch(output, NO_VISIBLE_EFFECT);
    });
  });

  void describe('a same-origin frame updating itself on /verdict-frame-ticker', () => {
    before(async () => {
      await open(`${fixture.url}verdict-frame-ticker`);
      const expression =
        'new Promise((resolve) => { const check = () => (window.ticks >= 4 ? resolve(true) : setTimeout(check, 20)); check(); })';
      await bdg([
        'cdp',
        'Runtime.evaluate',
        '--params',
        JSON.stringify({ expression, awaitPromise: true }),
      ]);
    });

    void it('keeps the verdict for a click that changed nothing', async () => {
      assert.equal(await effectOf(['click', '#noop']), 'none');
    });

    void it('counts the action writing into the frame next to the ticker', async () => {
      assert.equal(await effectOf(['click', '#frame-text']), undefined);
    });
  });
});
