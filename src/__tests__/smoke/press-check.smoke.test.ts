/**
 * Press check smoke test (#582).
 *
 * A mouse click on an element in a closed shadow root reports no "may not
 * have reached the element" warning when the press reached it: two closed
 * roots deep, when the root re-renders on `pointerdown`, and when the page
 * stops the press in a capture listener on `document`; an open root stays
 * unchanged. A press that lands on a shield covering the element (appearing
 * as the mouse moves onto it, so the element was topmost when bdg aimed)
 * still warns, also when the shield reacts to the press, for a shield
 * inside the element's closed root, one in the document over a closed root
 * element, and one over a light element; `--strict` refuses it, naming the
 * shield.
 *
 * Each test loads `/press-check` again after resting the mouse on `#park`,
 * so no shield is up before the click moves the mouse. The checks read the
 * page's own records (`window.clicks`, `window.shieldPresses`), never a
 * fixed delay.
 */

import * as assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

/** What the tests read of `dom click --json` */
interface ClickJson {
  method: string;
  warning?: string;
  effect?: 'none';
}

const NOT_REACHED = /may not have reached the element/;

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
 * Evaluate an expression in the page and return its result.
 *
 * @param expression - JavaScript expression
 * @returns Evaluation result
 */
async function evaluate(expression: string): Promise<unknown> {
  const output = await bdg(['dom', 'eval', expression, '--json']);
  return (JSON.parse(output) as { data: { result: unknown } }).data.result;
}

/**
 * Find a button by its accessible name (reaching closed shadow roots) and
 * return its `dom a11y query` index.
 *
 * @param name - Button name
 * @returns Index for `dom click`
 */
async function buttonIndex(name: string): Promise<string> {
  const query = JSON.parse(
    await bdg(['dom', 'a11y', 'query', `role=button name=${name}`, '--json'])
  ) as { data: { nodes: Array<{ index: number }> } };
  const [node] = query.data.nodes;
  assert.ok(node, `dom a11y query finds the ${name} button`);
  return String(node.index);
}

/**
 * Click a target and return the JSON data.
 *
 * @param target - Selector or index
 * @returns `data` of `dom click --json`
 */
async function clickJson(target: string): Promise<ClickJson> {
  return (JSON.parse(await bdg(['dom', 'click', target, '--json'])) as { data: ClickJson }).data;
}

void describe('Press check', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}press-check`, '--port', String(port), '--headless']);
  });

  beforeEach(async () => {
    await bdg(['dom', 'hover', '#park']);
    await bdg(['page', 'navigate', `${fixture.url}press-check`]);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  for (const [name, why] of [
    ['Deep', 'two closed roots deep'],
    ['Swap', 'whose root re-renders on pointerdown'],
    ['Guarded', 'whose press the page stops on document'],
    ['Open', 'in an open root'],
  ] as const) {
    void it(`sees the press reach a button ${why}`, async () => {
      const data = await clickJson(await buttonIndex(name));
      assert.equal(data.method, 'mouse');
      assert.equal(data.warning, undefined, JSON.stringify(data));
      const clicks = (await evaluate('window.clicks')) as string[];
      assert.equal(clicks.length, 1, JSON.stringify(clicks));
    });
  }

  for (const [target, shield, where] of [
    ['Shielded', 'div#inner-shield', 'inside its closed root'],
    ['Under', 'div#outer-shield', 'in the document over a closed root'],
    ['#light', 'div#light-shield', 'over a light element'],
  ] as const) {
    void it(`warns when a reacting shield ${where} takes the press`, async () => {
      const index = target.startsWith('#') ? target : await buttonIndex(target);
      const data = await clickJson(index);
      assert.equal(data.method, 'mouse');
      assert.match(data.warning ?? '', NOT_REACHED, JSON.stringify(data));
      assert.equal(data.effect, undefined, 'the shield reacted: the click had an effect');
      assert.equal(await evaluate('window.shieldPresses'), 1);
      assert.deepEqual(await evaluate('window.clicks'), []);
    });

    void it(`refuses with --strict, naming a shield ${where}`, async () => {
      const index = target.startsWith('#') ? target : await buttonIndex(target);
      const output = await bdg(['dom', 'click', index, '--strict'], 90);
      assert.match(
        output,
        new RegExp(`the press did not reach the element \\(it was sent, but landed on ${shield}\\)`)
      );
    });
  }
});
