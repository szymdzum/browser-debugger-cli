/**
 * Silent action effects smoke test (#670).
 *
 * An action that changed the page in a way no other line reports says so: a
 * hover that removed elements prints `DOM changed (N nodes)` (`domChanges` in
 * `--json`), a click that flipped `aria-expanded` prints `Expanded: true|false`
 * (`expanded`), a fill whose `input` handler moved focus prints
 * `Focus moved to: <element>` (`focusMoved`), and a click whose mouse release
 * landed on another element prints a warning (`releasedOn`). Quiet cases stay
 * quiet: a CSS-only `:hover`, a field echoing its value in a counter, a
 * disclosure that only toggles `hidden`, a page re-rendering a list on a timer.
 *
 * Waits are the actions' own settle; nothing sleeps.
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
  domChanges?: number;
  expanded?: boolean;
  focusMoved?: string;
  releasedOn?: string;
  warning?: string;
  shown?: unknown[];
}

/** The new fields of #670 */
const NEW_FIELDS = ['domChanges', 'expanded', 'focusMoved', 'releasedOn'] as const;

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
 * Assert that none of the new fields is set.
 *
 * @param data - Action result
 */
function assertQuiet(data: ActionData): void {
  for (const field of NEW_FIELDS) assert.equal(data[field], undefined, JSON.stringify(data));
}

/**
 * Start a session on a fixture page.
 *
 * @param url - Page URL
 */
async function open(url: string): Promise<void> {
  await cleanupAllSessions();
  const port = await getFreePort();
  const started = await runCommand(url, ['--port', String(port), '--headless'], {
    timeout: 60000,
  });
  assert.equal(started.exitCode, 0, started.stderr);
}

void describe('Silent action effects', () => {
  let fixture: FixtureServer;

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void describe('hover on /effects', () => {
    before(() => open(`${fixture.url}effects`));

    void it('reports the elements a hover removed as domChanges', async () => {
      const data = await act(['hover', '#shift-target']);
      assert.equal(data.domChanges, 200, JSON.stringify(data));
      assert.equal(data.effect, undefined);
    });

    void it('prints DOM changed (N nodes) in human output', async () => {
      await bdg(['dom', 'hover', '#help']);
      await bdg(['page', 'navigate', `${fixture.url}effects`]);
      const output = await bdg(['dom', 'hover', '#shift-target']);
      assert.match(output, /DOM changed \(200 nodes\)/);
    });
  });

  void describe('actions on /silent-effects', () => {
    before(() => open(`${fixture.url}silent-effects`));

    void it('names the aria-expanded flip of a clicked button, true then false', async () => {
      const opened = await act(['click', '#expander']);
      assert.equal(opened.expanded, true, JSON.stringify(opened));
      assert.equal(opened.domChanges, undefined, 'another effect is reported');
      const closed = await act(['click', '#expander']);
      assert.equal(closed.expanded, false, JSON.stringify(closed));
    });

    void it('names the flip of the button around a clicked icon, in human output', async () => {
      const output = await bdg(['dom', 'click', '#expander-icon']);
      assert.match(output, /\nExpanded: true\n/);
    });

    void it('reports the element a fill handler moved focus to', async () => {
      const data = await act(['fill', '#mover', 'x']);
      assert.match(data.focusMoved ?? '', /^input#other/, JSON.stringify(data));
      await bdg(['page', 'navigate', `${fixture.url}silent-effects`]);
      const output = await bdg(['dom', 'fill', '#mover', 'x']);
      assert.match(output, /Focus moved to: input#other/);
    });

    void it('stays silent for a fill whose value is echoed next to the field', async () => {
      assertQuiet(await act(['fill', '#counted', 'hello']));
    });

    void it('stays silent for a click that only toggles hidden', async () => {
      assertQuiet(await act(['click', '#disclosure']));
    });

    void it('stays silent for DOM changes next to a request the click started', async () => {
      const data = await act(['click', '#fetch-append']);
      assert.equal(data.domChanges, undefined, JSON.stringify(data));
    });

    void it('stays silent for a hover with a CSS-only style', async () => {
      assertQuiet(await act(['hover', '#plain-hover']));
    });
  });

  void describe('click on /press-check', () => {
    before(() => open(`${fixture.url}press-check`));

    void it('warns that the release landed on the element that slid under the mouse', async () => {
      const data = await act(['click', '#gone-mousedown']);
      assert.match(data.releasedOn ?? '', /^button#gone-pointerup/, JSON.stringify(data));
      assert.equal(data.warning, undefined, 'the unmount itself is not reported (#641)');
      await bdg(['page', 'navigate', `${fixture.url}press-check`]);
      const output = await bdg(['dom', 'click', '#gone-mousedown']);
      assert.match(output, /released on button#gone-pointerup/);
    });
  });

  void describe('click on /press-check elements the page renders anew', () => {
    before(() => open(`${fixture.url}press-check`));

    for (const id of ['follow', 'option', 'gone-pointerup']) {
      void it(`stays silent for #${id}, whose release lands on its own element or its replacement`, async () => {
        const data = await act(['click', `#${id}`]);
        assertQuiet(data);
      });
    }

    void it('reports the sibling that slid under the mouse when #item-1 unmounted', async () => {
      const data = await act(['click', '#item-1']);
      assert.match(data.releasedOn ?? '', /^button#item-10/, JSON.stringify(data));
    });
  });

  void describe('a page re-rendering a list on a timer', () => {
    before(() => open(`${fixture.url}silent-effects-busy`));

    void it('does not blame the click for the list', async () => {
      assertQuiet(await act(['click', '#noop']));
    });
  });
});
