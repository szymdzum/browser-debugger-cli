/**
 * Action outcomes smoke test (#593).
 *
 * An action result must not let a failure pass for a success, nor a success
 * for "nothing happened": a form submit the action fired is reported
 * (`submitted`, `Form:` row; cancelled or not), also for a submit that
 * changed nothing visible; a click whose handler prevents the submit, and
 * Enter in a form field that submits nothing, keep "no visible effect";
 * plain text a handler adds near the clicked control is reported as shown
 * (never a field's value); the clicked button's own change (disabled, new
 * label) is reported; a key that activated the button it was pressed on says
 * so; console errors from scripts on hosts the tracking filter drops are left
 * out of `Errors:` (with a count of those hidden) unless the session runs
 * with `--all`, and `network list` says when tracker requests were excluded
 * at capture; errors whose sources shorten to the same name print one row.
 *
 * Timing: every handler runs synchronously in the click or key event, so its
 * DOM change, submit and console errors are there at the first read after
 * the action.
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
  effect?: string;
  submitted?: { form: string; cancelled: boolean };
  shown?: Array<{ text: string; element: string }>;
  controlChange?: { element: string; disabled?: boolean; text?: string };
  activated?: string;
  errors?: Array<{ text: string; source?: string; count: number }>;
  hiddenTrackerErrors?: number;
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
 * Run a DOM action with `--json` and return its result.
 *
 * @param args - Arguments after `dom`
 * @returns Result data
 */
async function act(args: string[]): Promise<ActionData> {
  return (JSON.parse(await bdg(['dom', ...args, '--json'])) as { data: ActionData }).data;
}

/**
 * Start a session on a fixture page.
 *
 * @param url - Page URL
 * @param extra - More start arguments
 */
async function open(url: string, extra: string[] = []): Promise<void> {
  await cleanupAllSessions();
  const port = await getFreePort();
  const started = await runCommand(url, ['--port', String(port), '--headless', ...extra], {
    timeout: 60000,
  });
  assert.equal(started.exitCode, 0, started.stderr);
}

void describe('Action outcomes', () => {
  let fixture: FixtureServer;

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void describe('tracker errors and index targets on /tracker-rows (#694)', () => {
    before(() => open(`${fixture.url}tracker-rows`));

    void it('says the page had no errors when only trackers logged', async () => {
      const output = await bdg(['dom', 'click', '#trk']);
      assert.match(
        output,
        /^Errors: {8}none from the page \(2 from filtered trackers hidden; bdg console --level error\)$/m
      );
    });

    void it('keeps the tail after a page error', async () => {
      const output = await bdg(['dom', 'click', '#mixed']);
      assert.match(output, /^Errors: {8}app failed/m);
      assert.match(output, /^ {15}\(\+1 from filtered trackers\)$/m);
    });

    void it('shows the unique selector for an a11y index', async () => {
      await bdg(['dom', 'a11y', 'query', 'name=Cancel']);
      const output = await bdg(['dom', 'click', '0']);
      assert.match(output, /^Selector: {6}html > body > .*button:nth-of-type\(2\)$/m);
    });

    void it('shows a path that starts at an ancestor id for a custom element button', async () => {
      await bdg(['dom', 'a11y', 'query', 'name=Menu']);
      const output = await bdg(['dom', 'click', '0']);
      assert.match(output, /^Selector: {6}#nav > x-dd > button$/m);
    });
  });

  void describe('submits on /submit-blocked', () => {
    before(() => open(`${fixture.url}submit-blocked`));

    void it('reports the submit of a novalidate form the page cancelled', async () => {
      const data = await act(['click', '#loose-go']);
      assert.deepEqual(data.submitted, { form: 'form#loose', cancelled: true });
      assert.equal(data.effect, undefined);
      const output = await bdg(['dom', 'click', '#loose-go']);
      assert.match(output, /Form submitted \(cancelled by the page\)/);
      assert.doesNotMatch(output, /no visible effect/);
    });

    void it('reports the submit whose handler cleared the field', async () => {
      await bdg(['dom', 'fill', '#chat [name=msg]', 'hello']);
      const data = await act(['click', '#chat-send']);
      assert.deepEqual(data.submitted, { form: 'form#chat', cancelled: true });
      assert.equal(data.effect, undefined);
    });

    void it('keeps "no visible effect" for a click whose handler prevents the submit', async () => {
      const data = await act(['click', '#guarded-go']);
      assert.equal(data.submitted, undefined);
      assert.equal(data.effect, 'none');
    });

    void it('warns "no visible effect" when Enter in a form field submits nothing', async () => {
      await bdg(['dom', 'fill', '#guarded [name=nick]', 'ada']);
      const data = await act(['press-key', '#guarded [name=nick]', 'Enter']);
      assert.equal(data.submitted, undefined);
      assert.equal(data.effect, 'none');
      const output = await bdg(['dom', 'press-key', '#guarded [name=nick]', 'Enter']);
      assert.match(output, /no visible effect/);
    });
  });

  void describe('submits on /implicit-submit and /shadow-forms', () => {
    void it('reports the submit of the notes form', async () => {
      await open(`${fixture.url}implicit-submit`);
      await bdg(['dom', 'fill', '#notes [name=title]', 'Hello']);
      const data = await act(['click', '#notes-go']);
      assert.deepEqual(data.submitted, { form: 'form#notes', cancelled: true });
      assert.equal(data.effect, undefined);
    });

    void it('reports the submit of a form in an open shadow root', async () => {
      await open(`${fixture.url}shadow-forms`);
      await bdg(['dom', 'fill', '[name=email]', 'ada@example.com']);
      const data = await act(['press-key', '[name=email]', 'Enter']);
      assert.deepEqual(data.submitted, { form: 'form#login', cancelled: true });
      assert.equal(data.effect, undefined);
    });
  });

  void describe('handlers on /redspan', () => {
    before(() => open(`${fixture.url}redspan`));

    void it('reports plain text a click added near the button, never a field value', async () => {
      const data = await act(['click', '#redspan-go']);
      assert.deepEqual(
        (data.shown ?? []).map((shown) => shown.text),
        ['Something went wrong']
      );
      assert.doesNotMatch(JSON.stringify(data), /Hunter2Secret|654321/);
      const output = await bdg(['dom', 'click', '#redspan-go']);
      assert.match(output, /Something went wrong/);
      assert.doesNotMatch(output, /Hunter2Secret|654321/);
    });

    void it("reports the clicked button's own change", async () => {
      const output = await bdg(['dom', 'click', '#sending']);
      assert.match(output, /Button changed: disabled, "Sending…"/);
    });

    void it('reports that Enter activated the button it was pressed on', async () => {
      const data = await act(['press-key', '#plain', 'Enter']);
      assert.equal(data.activated, 'button#plain');
      assert.match(await bdg(['dom', 'press-key', '#plain', 'Enter']), /Activated:\s+button#plain/);
    });

    void it('reports the JS-handled submit Enter in a field started', async () => {
      await bdg(['dom', 'fill', '[name=q]', 'ada']);
      const data = await act(['press-key', '[name=q]', 'Enter']);
      assert.deepEqual(data.submitted, { form: 'form#lookup', cancelled: true });
      assert.match(
        await bdg(['dom', 'press-key', '[name=q]', 'Enter']),
        /Form submitted \(cancelled by the page\)/
      );
    });
  });

  void describe('a ticker on /ticker', () => {
    before(() => open(`${fixture.url}ticker`));

    void it('does not attribute toasts added elsewhere to a click', async () => {
      const data = await act(['click', '#like']);
      assert.deepEqual(data.shown ?? [], []);
      assert.doesNotMatch(await bdg(['dom', 'click', '#like']), /Shown:|Score \d/);
    });

    void it('reports a status the click added far from the button', async () => {
      const output = await bdg(['dom', 'click', '#notify']);
      assert.match(output, /(New text|Shown):.*Saved/);
      assert.doesNotMatch(output, /Score \d/);
    });
  });

  void describe('what Shown lists (#750)', () => {
    void it('lists a dialog rendered inside an open shadow root', async () => {
      await open(`${fixture.url}shown-shadow`);
      const data = await act(['click', '#open-dialog']);
      assert.match((data.shown ?? []).map((item) => item.text).join('|'), /Search the site/);
    });

    void it('lists what an aria-expanded button un-hid', async () => {
      await open(`${fixture.url}shown-disclosure`);
      const near = await act(['click', '#near-toggle']);
      assert.match((near.shown ?? []).map((item) => item.text).join('|'), /Pricing/);
      const far = await act(['click', '#far-toggle']);
      assert.match((far.shown ?? []).map((item) => item.text).join('|'), /Ships within 3 days/);
    });

    void it('keeps a click without aria-expanded quiet about un-hidden elements', async () => {
      const data = await act(['click', '#plain']);
      assert.equal(data.shown, undefined);
    });
  });

  void describe('content a user action adds again and again', () => {
    before(() => open(`${fixture.url}shown-repeat`));

    /**
     * Texts a click listed as shown or new.
     *
     * @param selector - Button to click
     * @returns Texts joined by `|`
     */
    async function listed(selector: string): Promise<string> {
      const data = (await act(['click', selector])) as ActionData & {
        messages?: Array<{ text: string }>;
      };
      return [...(data.shown ?? []), ...(data.messages ?? [])].map((item) => item.text).join('|');
    }

    void it('shows each Load more of 4 rows added at once', async () => {
      for (let click = 1; click <= 3; click++) {
        assert.match(await listed('#more'), new RegExp(`Row ${click * 4 - 3}`), `click ${click}`);
      }
    });

    void it('shows replaced search results', async () => {
      for (let click = 1; click <= 3; click++) {
        assert.match(await listed('#search'), new RegExp(`Result ${click}\\.`), `click ${click}`);
      }
    });

    void it('shows each todo added', async () => {
      for (let click = 1; click <= 3; click++) {
        assert.match(await listed('#add'), new RegExp(`Todo ${click}`), `click ${click}`);
      }
    });
  });

  void describe('a carousel beside an aria-expanded button', () => {
    before(() => open(`${fixture.url}shown-quiet`));

    for (const button of ['#car-btn']) {
      void it(`${button} stays quiet`, async () => {
        const data = await act(['click', button]);
        assert.equal(data.shown, undefined);
      });
    }
  });

  void describe('dialogs without text (#750)', () => {
    void it('lists the search dialog of /shadow-forms by its field', async () => {
      await open(`${fixture.url}shadow-forms`);
      const data = await act(['click', '#open-search']);
      assert.deepEqual(
        (data.shown ?? []).map((item) => item.text),
        ['Search']
      );
    });

    void it('lists a text-less dialog in the light DOM the same way', async () => {
      await open(`${fixture.url}shown-shadow`);
      const data = await act(['click', '#open-bare']);
      assert.deepEqual(
        (data.shown ?? []).map((item) => item.text),
        ['Search']
      );
    });
  });

  void describe('console errors on /tracker-errors', () => {
    before(() => open(`${fixture.url}tracker-errors`));

    void it('leaves tracker errors out, saying how many', async () => {
      const data = await act(['click', '#track']);
      assert.deepEqual(
        (data.errors ?? []).map((error) => error.text),
        ['app failed']
      );
      assert.equal(data.hiddenTrackerErrors, 2);
      assert.match(await bdg(['dom', 'click', '#track']), /\(\+2 from filtered trackers\)/);
    });

    void it('says network list excluded tracker requests', async () => {
      assert.match(await bdg(['network', 'list']), /tracking request.* excluded/);
    });

    void it('prints one row for one error from sources with the same short name', async () => {
      const data = await act(['click', '#dupes']);
      assert.equal(data.errors?.length, 2);
      const output = await bdg(['dom', 'click', '#dupes']);
      assert.equal(output.split('\n').filter((line) => line.includes('beacon failed')).length, 1);
    });

    void it('lists tracker errors in a session with --all', async () => {
      await open(`${fixture.url}tracker-errors`, ['--all']);
      const data = await act(['click', '#track']);
      assert.ok(
        (data.errors ?? []).some((error) => error.text === 'tracker failed'),
        JSON.stringify(data.errors)
      );
      assert.equal(data.hiddenTrackerErrors, undefined);
    });
  });
});
