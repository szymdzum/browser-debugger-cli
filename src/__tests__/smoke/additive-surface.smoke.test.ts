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

/** Every `--last` or `--limit` option in `--help --json --full`, sorted (hidden `tail` is no longer listed) */
const EXPECTED_PATHS = [
  'console --last',
  'css search --limit',
  'debug hits --last',
  'dom a11y query --limit',
  'dom a11y tree --limit',
  'dom audit --limit',
  'dom query --limit',
  'dom screenshot --limit',
  'network list --last',
  'peek --last',
].sort();

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
 * Every command node under a root, with its path below the root.
 *
 * @param node - Tree root
 * @param parent - Path of the parent (empty at the root)
 * @returns The node and all its descendants
 */
function flatten(node: HelpNode, parent = ''): Array<HelpNode & { path: string }> {
  const path = `${parent} ${node.name}`.trim();
  return [{ ...node, path }, ...(node.subcommands ?? []).flatMap((s) => flatten(s, path))];
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
    await bdg([`${fixture.url}backend-node-id`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('is next to nodeId on every dom query match, frame and shadow root included', async () => {
    const data = await dataOf<{ nodes: Idd[] }>(['dom', 'query', '.t']);
    assert.equal(data.nodes.length, 4);
    assertBackendIds(data.nodes, 'dom query .t');
  });

  void it('is next to nodeId on dom get --raw, single, --all and by index', async () => {
    for (const [args, count] of [
      [['dom', 'get', '.t', '--raw'], 1],
      [['dom', 'get', '.t', '--raw', '--all'], 4],
      [['dom', 'get', '0', '--raw'], 1],
      [['dom', 'get', '3', '--raw'], 1],
    ] as const) {
      const { nodes } = await dataOf<{ nodes: Idd[] }>([...args]);
      assert.equal(nodes.length, count, args.join(' '));
      assertBackendIds(nodes, args.join(' '));
    }
  });

  void it('leaves the semantic dom get node to its accessibility id and backendDOMNodeId', async () => {
    const [match] = (await dataOf<{ nodes: Idd[] }>(['dom', 'query', '.t'])).nodes;
    for (const target of ['.t', '0']) {
      const { node } = await dataOf<{ node: Idd }>(['dom', 'get', target]);
      assert.equal(node['backendDOMNodeId'], match?.['nodeId'], `dom get ${target}`);
      assert.equal('backendNodeId' in node, false, `dom get ${target}: no backendNodeId`);
    }
  });
});

void describe('--last and --limit wording in --help --json (#465 D10)', () => {
  void it('says "newest N" for every --last and "first N" for every --limit', async () => {
    const result = await runCommand('--help', ['--json', '--full'], { timeout: 30000 });
    const root = (JSON.parse(result.stdout) as { command: HelpNode }).command;
    const seen: string[] = [];
    for (const command of flatten(root)) {
      for (const option of command.options ?? []) {
        const flag = option.flags.match(/--(?:last|limit)/)?.[0];
        const phrase = /(^|, )--last\b/.test(option.flags)
          ? /newest N/
          : /(^|, )--limit\b/.test(option.flags)
            ? /first N/i
            : undefined;
        if (!phrase) continue;
        seen.push(`${command.path.replace(/^bdg /, '')} ${flag}`);
        assert.match(option.description, phrase, `${command.name} ${option.flags}`);
      }
    }
    assert.deepEqual(seen.sort(), EXPECTED_PATHS);
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
