/**
 * Additive 0.x surface changes (#465 D14, D10, D3).
 *
 * `dom query` and `dom get --json` carry `backendNodeId` next to `nodeId`;
 * every `--last` option says "newest" and every `--limit` option says "first"
 * in the machine-readable help; `peek -n` prints no deprecation note.
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

interface HelpOption {
  flags: string;
  description: string;
}

interface HelpNode {
  name: string;
  options?: HelpOption[];
  subcommands?: HelpNode[];
}

type Idd = Record<string, unknown>;

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Stdout and stderr
 */
async function bdg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/**
 * The `data` of a `--json` command.
 *
 * @param args - Arguments, `--json` added
 * @returns The envelope's data
 */
async function dataOf<T>(args: string[]): Promise<T> {
  const { stdout } = await bdg([...args, '--json']);
  return (JSON.parse(stdout) as { data: T }).data;
}

/**
 * Every command node under a root.
 *
 * @param node - Tree root
 * @returns The node and all its descendants
 */
function flatten(node: HelpNode): HelpNode[] {
  return [node, ...(node.subcommands ?? []).flatMap(flatten)];
}

/**
 * Assert every node has a `backendNodeId` equal to its `nodeId`.
 *
 * @param nodes - Node objects of a `--json` result
 * @param label - What was run
 */
function assertBackendIds(nodes: Idd[], label: string): void {
  assert.ok(nodes.length > 0, `${label}: no nodes`);
  for (const node of nodes) {
    assert.equal(typeof node['nodeId'], 'number', `${label}: nodeId`);
    assert.equal(node['backendNodeId'], node['nodeId'], `${label}: backendNodeId`);
  }
}

void describe('backendNodeId in dom query and dom get (#465 D14)', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}dom-get-context`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('is next to nodeId on every dom query match', async () => {
    const data = await dataOf<{ nodes: Idd[] }>(['dom', 'query', 'p']);
    assert.equal(data.nodes.length, 2);
    assertBackendIds(data.nodes, 'dom query p');
  });

  void it('is next to nodeId on dom get --raw, single, --all and by index', async () => {
    for (const args of [
      ['dom', 'get', '#x', '--raw'],
      ['dom', 'get', 'p', '--raw', '--all'],
      ['dom', 'get', '0', '--raw'],
    ]) {
      assertBackendIds((await dataOf<{ nodes: Idd[] }>(args)).nodes, args.join(' '));
    }
  });

  void it('is the backend id on the semantic dom get node, by selector and index', async () => {
    const [match] = (await dataOf<{ nodes: Idd[] }>(['dom', 'query', '#x'])).nodes;
    for (const target of ['#x', '0']) {
      const data = await dataOf<{ node: Idd }>(['dom', 'get', target]);
      assert.equal(data.node['backendNodeId'], match?.['nodeId'], `dom get ${target}`);
    }
  });
});

void describe('--last and --limit wording in --help --json (#465 D10)', () => {
  void it('says newest for every --last and first for every --limit', async () => {
    const result = await runCommand('--help', ['--json', '--full'], { timeout: 30000 });
    const root = (JSON.parse(result.stdout) as { command: HelpNode }).command;
    let seen = 0;
    for (const command of flatten(root)) {
      for (const option of command.options ?? []) {
        const word = /^--last\b|, --last\b/.test(option.flags)
          ? 'newest'
          : /^--limit\b|, --limit\b/.test(option.flags)
            ? 'first'
            : undefined;
        if (!word) continue;
        seen += 1;
        assert.match(
          option.description,
          new RegExp(word, 'i'),
          `${command.name} ${option.flags}: ${option.description}`
        );
      }
    }
    assert.ok(seen >= 10, `options checked: ${seen}`);
  });
});

void describe('peek -n prints no deprecation note (#465 D3)', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}dom-get-context`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('works and keeps stderr free of "deprecated"', async () => {
    const { stdout, stderr } = await bdg(['peek', '-n']);
    assert.doesNotMatch(stderr, /deprecated/i);
    assert.match(stdout, /Network/i);
  });
});
