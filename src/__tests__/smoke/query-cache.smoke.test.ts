/**
 * The shared "last query" index cache (#610): an index past the list is
 * out of range even after a navigation, every index-based success names the
 * list it resolved against (so an index meant for one list and resolved
 * against another is never silent), and a query that matched nothing or a
 * new session without a query each get their own message (exit 81).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

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
 * The `indexSource` of a command's `--json` data.
 *
 * @param args - Command arguments (without `--json`)
 * @returns `data.indexSource`
 */
async function jsonIndexSource(args: string[]): Promise<unknown> {
  const output = await bdg([...args, '--json']);
  const data = (JSON.parse(output) as { data: Record<string, unknown> }).data;
  return data['indexSource'] ?? (data['element'] as Record<string, unknown>)['indexSource'];
}

const USER_SOURCE = { index: 0, command: 'dom query', query: '#user' };
const USER_SOURCE_TEXT = 'index 0 of the last dom query "#user"';

void describe('Query cache', () => {
  let fixture: FixtureServer;
  let port: number;
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-qcache-shot-'));

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    port = await getFreePort();
    await bdg([`${fixture.url}raw-legacy`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
    fs.rmSync(shotDir, { recursive: true, force: true });
  });

  void it('reports an index past the list as out of range after a navigation', async () => {
    await bdg(['dom', 'query', '#legacy-pass']);
    await bdg(['page', 'navigate', `${fixture.url}components`]);

    const output = await bdg(['dom', 'a11y', 'describe', '24'], 87);

    assert.match(
      output,
      /Index 24 is out of range for the last dom query "#legacy-pass" \(1 result\)/
    );
    assert.doesNotMatch(output, /no longer in the page/);
  });

  void it('names the list an index came from in every index-based success', async () => {
    await bdg(['dom', 'query', '#user']);

    for (const args of [
      ['dom', 'get', '0'],
      ['dom', 'get', '0', '--raw'],
      ['dom', 'a11y', 'describe', '0'],
      ['dom', 'inspect', '0'],
      ['dom', 'listeners', '0'],
      ['dom', 'layout', '0'],
      ['dom', 'hover', '0'],
      ['dom', 'screenshot', path.join(shotDir, 'user.png'), '0'],
    ]) {
      assert.ok(
        (await bdg(args)).includes(USER_SOURCE_TEXT),
        `bdg ${args.join(' ')} names ${USER_SOURCE_TEXT}`
      );
    }
    for (const args of [
      ['dom', 'get', '0'],
      ['dom', 'get', '0', '--raw'],
      ['dom', 'a11y', 'describe', '0'],
      ['dom', 'screenshot', path.join(shotDir, 'user-json.png'), '0'],
    ]) {
      assert.deepEqual(await jsonIndexSource(args), USER_SOURCE, `bdg ${args.join(' ')} --json`);
    }
  });

  void it('names the other list when another command replaced the cache', async () => {
    await bdg(['dom', 'query', '#user']);
    await bdg(['dom', 'a11y', 'query', 'role=link']);

    const output = await bdg(['dom', 'get', '0']);

    assert.match(output, /index 0 of the last dom a11y query "role=link"/);
  });

  void it('says that the last query matched nothing (81)', async () => {
    await bdg(['dom', 'query', '#nothing-here'], 83);

    const output = await bdg(['dom', 'get', '0'], 81);

    assert.match(output, /The last dom query "#nothing-here" matched nothing/);
  });

  void it('says that a new session has no query yet (81)', async () => {
    await bdg(['dom', 'query', '#user']);
    await bdg(['stop']);
    await bdg([`${fixture.url}components`, '--port', String(port), '--headless']);

    const output = await bdg(['dom', 'get', '0'], 81);

    assert.match(output, /No query in this session yet/);
  });
});
