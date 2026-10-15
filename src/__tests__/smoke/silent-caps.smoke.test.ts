/**
 * Silent caps and filters smoke test (#759).
 *
 * A cap or filter that drops items says how many it dropped: an action's
 * `Shown:` list (`(+N more)`, JSON `moreShown`) and `bdg console --level`
 * (a note with the hidden count per level, JSON `hiddenByLevel`, while
 * `summary.total` keeps counting the listed messages).
 *
 * Timing: the page logs its messages and appends its rows synchronously, so
 * they are there at the first read.
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

void describe('Silent caps', () => {
  let fixture: FixtureServer;

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void describe('Shown on /shown-repeat', () => {
    before(() => open(`${fixture.url}shown-repeat`));

    void it('says how many appended rows Shown does not list', async () => {
      const data = (
        JSON.parse(await bdg(['dom', 'click', '#more', '--json'])) as {
          data: { shown?: unknown[]; moreShown?: number };
        }
      ).data;
      assert.equal(data.shown?.length, 3);
      assert.equal(data.moreShown, 1);
      assert.match(await bdg(['dom', 'click', '#more']), /\(\+1 more\)/);
    });
  });

  void describe('Shown on /caps-shown', () => {
    before(() => open(`${fixture.url}caps-shown`));

    void it('counts the rows beyond the 10 a read returns', async () => {
      const data = (
        JSON.parse(await bdg(['dom', 'click', '#big', '--json'])) as {
          data: { shown?: unknown[]; moreShown?: number; moreShownPartial?: boolean };
        }
      ).data;
      assert.equal(data.shown?.length, 3);
      assert.equal(data.moreShown, 12);
      assert.equal(data.moreShownPartial, undefined);
    });
  });

  void describe('Shown on /caps-shown under CPU throttling (#776)', () => {
    before(async () => {
      await open(`${fixture.url}caps-shown`);
      await bdg(['cdp', 'Emulation.setCPUThrottlingRate', '--params', '{"rate":30}']);
    });

    void it('lists the first rows with their count, or says the scan is partial', async () => {
      const data = (
        JSON.parse(await bdg(['dom', 'click', '#big', '--json'])) as {
          data: { shown?: Array<{ text: string }>; moreShown?: number; moreShownPartial?: boolean };
        }
      ).data;
      const rows = data.shown?.map((row) => row.text) ?? [];
      const all = ['big 0', 'big 1', 'big 2'];
      if (data.moreShownPartial === true) {
        assert.deepEqual(
          rows,
          all.slice(0, rows.length),
          'a partial scan lists an in-order prefix'
        );
        return;
      }
      assert.deepEqual(rows, all);
      assert.equal(data.moreShown, 12);
    });
  });

  void describe('console --level on /caps-console', () => {
    before(() => open(`${fixture.url}caps-console`));

    void it('says how many messages --level hid, in JSON and in text', async () => {
      const json = JSON.parse(await bdg(['console', '--level', 'error', '--json'])) as {
        data: { summary: { total: number }; hiddenByLevel?: Record<string, number> };
      };
      assert.equal(json.data.summary.total, 0);
      assert.deepEqual(json.data.hiddenByLevel, { info: 3 });
      assert.match(
        await bdg(['console', '--level', 'error']),
        /3 messages hidden by --level error \(3 info\)/
      );
    });

    void it('says nothing when --level hid nothing', async () => {
      const json = JSON.parse(await bdg(['console', '--level', 'info', '--json'])) as {
        data: { hiddenByLevel?: unknown };
      };
      assert.equal(json.data.hiddenByLevel, undefined);
    });
  });
});
