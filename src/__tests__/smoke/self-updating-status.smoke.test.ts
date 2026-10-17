/**
 * Self-updating regions in action results smoke test (#774).
 *
 * A region the page keeps updating on its own (a status ticker, a polled
 * badge, a re-rendered list) is named under `Also changing:` (`alsoChanging`
 * in `--json`) instead of filling `New text:`, and its changes do not keep a
 * finished click "still changing". The action's own results (a toast, a flash
 * message, Load more chunks, a slow response) stay `New text:`. A `<search>`
 * element scopes `Shown:` like `[role=search]`.
 *
 * Each page counts its own updates in `window.ticks`; a test waits for three
 * of them before it acts, the layout-sensitive page for six. The tick count
 * is an observable event: nothing sleeps.
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

/** The part of an action result this test reads */
interface ActionData {
  messages?: { text: string; element: string }[];
  alsoChanging?: { element: string; text?: string }[];
  shown?: { text: string; element: string }[];
  settled?: boolean;
  pending?: { domChanging?: boolean; requests?: number };
}

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
 * Run `dom click` with `--json` and return its result.
 *
 * @param selector - Element to click
 * @returns Result data
 */
async function click(selector: string): Promise<ActionData> {
  return (JSON.parse(await bdg(['dom', 'click', selector, '--json'])) as { data: ActionData }).data;
}

/** Updates a page has made before a test acts (pages without a ticker start at 3) */
const MIN_TICKS = 3;

/**
 * Updates the appending ticker's page needs: more than the 5 elements it
 * keeps, so the layout under the click has stopped growing
 */
const APPEND_TICKS = 6;

/** Whether the file's one session is running (the first page starts it, later ones navigate) */
let sessionRunning = false;

/**
 * Open a fixture page in the file's session, starting it on the first call,
 * and wait until the page has updated itself `minTicks` times (`window.ticks`).
 * A navigation gives each test a fresh document without a new Chrome; it
 * does not wait for the page to settle (a ticker never lets it), the tick
 * count on the new URL is the event waited for.
 *
 * @param url - Page URL
 * @param minTicks - Updates to wait for
 */
async function open(url: string, minTicks = MIN_TICKS): Promise<void> {
  if (sessionRunning) {
    await bdg(['page', 'navigate', url, '--no-wait']);
  } else {
    await cleanupAllSessions();
    const port = await getFreePort();
    const started = await runCommand(url, ['--port', String(port), '--headless'], {
      timeout: 60000,
    });
    assert.equal(started.exitCode, 0, started.stderr);
    sessionRunning = true;
  }
  const expression = `new Promise((resolve) => { const check = () => (location.href === ${JSON.stringify(url)} && window.ticks >= ${minTicks} ? resolve(true) : setTimeout(check, 20)); check(); })`;
  await bdg([
    'cdp',
    'Runtime.evaluate',
    '--params',
    JSON.stringify({ expression, awaitPromise: true }),
  ]);
}

/**
 * Texts of a result's messages.
 *
 * @param data - Action result
 * @returns Message texts
 */
function messageTexts(data: ActionData): string[] {
  return (data.messages ?? []).map((message) => message.text);
}

/**
 * Assert that a ticker is named under `alsoChanging` and not in `messages`.
 *
 * @param data - Action result
 * @param element - The ticker's element description
 * @param text - Pattern its text matches, if it has one
 */
function assertAlsoChanging(data: ActionData, element: string, text?: RegExp): void {
  const json = JSON.stringify(data);
  assert.ok(
    !(data.messages ?? []).some((message) => message.element === element),
    `not New text: ${json}`
  );
  const entry = (data.alsoChanging ?? []).find((changing) => changing.element === element);
  assert.ok(entry, `alsoChanging names ${element}: ${json}`);
  if (text) assert.match(entry.text ?? '', text, json);
}

void describe('Self-updating regions in action results (#774)', () => {
  let fixture: FixtureServer;

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  for (const path of ['self-status-text', 'self-status-live']) {
    void it(`a1/a2 ${path}: the ticker is Also changing, the rows are Shown`, async () => {
      await open(`${fixture.url}${path}`);
      const data = await click('#rows');
      assertAlsoChanging(data, 'aside#t', /^tick \d+$/);
      assert.ok(
        (data.shown ?? []).some((el) => el.text === 'row 0'),
        JSON.stringify(data)
      );
    });
  }

  void it('a1 human output: Also changing row, no New text row', async () => {
    await open(`${fixture.url}self-status-text`);
    const output = await bdg(['dom', 'click', '#rows']);
    assert.match(output, /\nAlso changing: +aside#t "tick \d+" \(changing before the action\)\n/);
    assert.doesNotMatch(output, /New text:/);
  });

  void it('a3 a ticker appending elements does not keep the click still changing', async () => {
    await open(`${fixture.url}self-status-append`, APPEND_TICKS);
    const data = await click('#rows');
    assert.equal(data.settled, undefined, JSON.stringify(data));
    assert.equal(data.pending?.domChanging, undefined, JSON.stringify(data));
    assertAlsoChanging(data, 'aside#t');
  });

  void it('a ticker span inside a status box marks the box', async () => {
    await open(`${fixture.url}self-status-nested`);
    const data = await click('#rows');
    assertAlsoChanging(data, 'div#st', /^Now: tick \d+$/);
  });

  void it('the click’s own message next to a ticker in the same box stays New text', async () => {
    await open(`${fixture.url}self-status-box`);
    const data = await click('#place');
    const message = (data.messages ?? []).find((found) => found.element === 'div#box');
    assert.match(message?.text ?? '', /Order placed$/, JSON.stringify(data));
    assert.equal(data.alsoChanging, undefined, JSON.stringify(data));
  });

  void it('a result appended next to a ticker that replaces its span is New text', async () => {
    await open(`${fixture.url}self-status-replace`);
    const data = await click('#go');
    const message = (data.messages ?? []).find((found) => found.element === 'div#box');
    assert.match(message?.text ?? '', /Saved!$/, JSON.stringify(data));
    assert.equal(data.alsoChanging, undefined, JSON.stringify(data));
  });

  void it('a result streamed next to a ticker is still changing or complete', async () => {
    await open(`${fixture.url}self-status-stream`);
    const data = await click('#go');
    const message = (data.messages ?? []).find((found) => found.element === 'div#box');
    const complete = /part 10$/.test(message?.text ?? '');
    assert.ok(data.settled === false || complete, JSON.stringify(data));
  });

  void it('b a toast the click shows 300 ms later is New text', async () => {
    await open(`${fixture.url}self-status-toast`);
    const data = await click('#save');
    assert.deepEqual(messageTexts(data), ['Saved'], JSON.stringify(data));
    assert.equal(data.alsoChanging, undefined, JSON.stringify(data));
  });

  void it('c a flash message after a submit is New text', async () => {
    await open(`${fixture.url}self-status-flash`);
    const data = await click('#go');
    assert.deepEqual(messageTexts(data), ['Invalid email'], JSON.stringify(data));
    assert.equal(data.alsoChanging, undefined, JSON.stringify(data));
  });

  void it('d Load more chunks: the status and the results are reported as the click’s', async () => {
    await open(`${fixture.url}self-status-more`);
    const data = await click('#more');
    assert.ok(
      messageTexts(data).some((text) => /^Showing \d+ of 90$/.test(text)),
      JSON.stringify(data)
    );
    assert.ok((data.shown ?? []).length > 0, JSON.stringify(data));
    assert.equal(data.alsoChanging, undefined, JSON.stringify(data));
  });

  void it('e a slow response is New text or still pending, never silent', async () => {
    await open(`${fixture.url}self-status-slow`);
    const data = await click('#load');
    const reported = messageTexts(data).includes('Result: 200');
    assert.ok(reported || data.settled === false, JSON.stringify(data));
    assert.equal(data.alsoChanging, undefined, JSON.stringify(data));
  });

  void it('f a polled cart badge is Also changing with the click’s text', async () => {
    await open(`${fixture.url}self-status-cart`);
    const data = await click('#add');
    assertAlsoChanging(data, 'span#cart', /^4 items$/);
  });

  void it('g two #noop clicks on a self-updating list agree', async () => {
    await open(`${fixture.url}self-status-list`);
    const first = await click('#noop');
    const second = await click('#noop');
    const both = JSON.stringify({ first, second });
    assert.equal(first.settled, second.settled, both);
    assert.equal(first.pending?.domChanging, second.pending?.domChanging, both);
    assertAlsoChanging(first, 'ul#list');
    assertAlsoChanging(second, 'ul#list');
  });

  void it('a validation message rendered into a self-updating app root stays New text', async () => {
    await open(`${fixture.url}self-status-app`);
    const data = (
      JSON.parse(await bdg(['dom', 'fill', '#f', 'abcdefg', '--json'])) as { data: ActionData }
    ).data;
    assert.deepEqual(messageTexts(data), ['Too long'], JSON.stringify(data));
    assert.ok(
      !(data.alsoChanging ?? []).some((region) => region.text === 'Too long'),
      JSON.stringify(data)
    );
  });

  void it('h a <search> element scopes Shown like [role=search]', async () => {
    await open(`${fixture.url}self-status-search`);
    const data = await click('#go');
    const texts = (data.shown ?? []).map((el) => el.text);
    assert.deepEqual(texts, ['suggestion ab'], JSON.stringify(data));
  });
});
