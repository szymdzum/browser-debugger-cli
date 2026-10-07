/**
 * Bounded list output smoke test.
 *
 * `dom query`, `dom a11y query` and `dom a11y tree` list a bounded number of
 * rows by default, also with `--json` (one call must not fill an agent's
 * context), report the total and how many were left out, list everything
 * with `--limit 0`, and keep every match indexed whatever they list.
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

/** Links on the test page */
const LINK_COUNT = 300;

const LINKS_HTML = Array.from(
  { length: LINK_COUNT },
  (_, i) => `<p><a href="#l${i}" onclick="window.hit=${i}">Link ${i}</a></p>`
).join('');

interface ListData {
  count: number;
  nodes: Array<{ index?: number; depth?: number; childIds?: unknown }>;
  omitted?: number;
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
 * Run a `--json` list command and return its data.
 *
 * @param args - bdg arguments without `--json`
 * @returns The envelope's data
 */
async function listJson(args: string[]): Promise<ListData> {
  const result = await runCommand(args[0] ?? '', [...args.slice(1), '--json'], {
    timeout: 60000,
  });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')} --json: ${result.stderr}`);
  return (JSON.parse(result.stdout) as { data: ListData }).data;
}

void describe('Bounded list output', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    await bdg([`${fixture.url}interactions`, '--port', String(await getFreePort()), '--headless']);
    await bdg(['dom', 'eval', `document.body.innerHTML = ${JSON.stringify(LINKS_HTML)}; 1`]);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('dom query --json lists 100 matches, --limit 0 all, and indexes past the list', async () => {
    const listed = await listJson(['dom', 'query', 'a']);
    assert.deepEqual([listed.count, listed.nodes.length, listed.omitted], [LINK_COUNT, 100, 200]);
    const all = await listJson(['dom', 'query', 'a', '--limit', '0']);
    assert.deepEqual(
      [all.count, all.nodes.length, all.omitted],
      [LINK_COUNT, LINK_COUNT, undefined]
    );

    await listJson(['dom', 'query', 'a']);
    assert.match(await bdg(['dom', 'get', '250']), /Link 250/);
    await bdg(['dom', 'click', '250']);
    const hit = await bdg(['dom', 'eval', 'window.hit']);
    assert.match(hit, /250/);
  });

  void it('dom a11y query --json lists 100 matches, --limit 0 all, and indexes all', async () => {
    const listed = await listJson(['dom', 'a11y', 'query', 'role:link']);
    assert.deepEqual([listed.count, listed.nodes.length, listed.omitted], [LINK_COUNT, 100, 200]);
    const quick = await listJson(['dom', 'a11y', 'role:link']);
    assert.deepEqual([quick.count, quick.nodes.length, quick.omitted], [LINK_COUNT, 100, 200]);
    const all = await listJson(['dom', 'a11y', 'query', 'role:link', '--limit', '0']);
    assert.deepEqual(
      [all.count, all.nodes.length, all.omitted],
      [LINK_COUNT, LINK_COUNT, undefined]
    );

    await listJson(['dom', 'a11y', 'query', 'role:link']);
    assert.match(await bdg(['dom', 'get', '250']), /Link 250/);
    await bdg(['dom', 'click', '250']);
    assert.match(await bdg(['dom', 'eval', 'window.hit']), /250/);
  });

  void it('dom a11y tree --json is bounded like human output, with --limit and --depth', async () => {
    const listed = await listJson(['dom', 'a11y', 'tree']);
    assert.equal(listed.nodes.length, 50);
    assert.ok(listed.count > LINK_COUNT, `count is the whole tree: ${listed.count}`);
    assert.ok((listed.omitted ?? 0) >= LINK_COUNT - 50, `omitted: ${listed.omitted}`);
    assert.equal(listed.nodes[0]?.depth, 0);

    const all = await listJson(['dom', 'a11y', 'tree', '--limit', '0']);
    assert.ok(all.nodes.length > LINK_COUNT, `--limit 0 lists all: ${all.nodes.length}`);
    assert.equal(all.omitted, undefined);

    const shallow = await listJson(['dom', 'a11y', 'tree', '--depth', '0', '--limit', '0']);
    assert.equal(shallow.nodes.length, 1);
    assert.ok((shallow.omitted ?? 0) > LINK_COUNT);

    const human = await bdg(['dom', 'a11y', 'tree']);
    assert.match(human, /Showing the first 50 nodes/);
    assert.match(human, /--limit 0/);
    assert.doesNotMatch(human, /--json/);
    assert.match(await bdg(['dom', 'a11y', 'tree', '--limit', '3']), /Showing the first 3 nodes/);
  });
});
