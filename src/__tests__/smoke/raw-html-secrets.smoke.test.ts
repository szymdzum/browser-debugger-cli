/**
 * Secrets in raw HTML smoke test (#583).
 *
 * `dom get --raw` (one match or `--all`) and `dom get --node-id` show the
 * value of each field `dom query` masks as `••••`, in the outer HTML and in
 * the JSON attributes, for the field itself and for fields inside the
 * element read (a form); other values stay as they are.
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

/** Shown instead of a secret value */
const MASK = '••••';

/** Secret values on `/shadow-forms` */
const SHADOW_SECRETS = /Hunter2Secret|4321/;

/** Secret values on `/raw-secrets` */
const RAW_SECRETS = /TopSecret99|Shown88Secret|777111|4111111111111111|905512/;

/** What the tests read of `dom get --raw --json` */
interface GetJson {
  nodes: Array<{ nodeId: number; attributes?: Record<string, string>; outerHTML?: string }>;
}

/** What the tests read of `dom query --json` */
interface QueryJson {
  nodes: Array<{ nodeId: number; id?: string; attributes?: { value?: string } }>;
}

/**
 * Run a bdg command and assert it succeeds.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

/**
 * Run a bdg command with `--json` and return its data.
 *
 * @param args - Full bdg argument list without `--json`
 * @returns The `data` of the envelope
 */
async function bdgJson<T>(args: string[]): Promise<T> {
  return (JSON.parse(await bdg([...args, '--json'])) as { data: T }).data;
}

/**
 * Backend node id of the first match of a selector.
 *
 * @param selector - CSS selector
 * @returns Node id `dom query` reports
 */
async function nodeIdOf(selector: string): Promise<number> {
  const node = (await bdgJson<QueryJson>(['dom', 'query', selector])).nodes[0];
  assert.ok(node, `no match for ${selector}`);
  return node.nodeId;
}

void describe('Secrets in raw HTML (#583)', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}shadow-forms`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('dom get input --raw --all masks the password and PIN values (issue reproduction)', async () => {
    const human = await bdg(['dom', 'get', 'input', '--raw', '--all']);
    assert.doesNotMatch(human, SHADOW_SECRETS);
    assert.match(human, /<input id="pw"[^>]*value="••••">/);
    assert.match(human, /<input id="pin"[^>]*value="••••">/);

    const json = await bdg(['dom', 'get', 'input', '--raw', '--all', '--json']);
    assert.doesNotMatch(json, SHADOW_SECRETS);
    const nodes = (JSON.parse(json) as { data: GetJson }).data.nodes;
    const secrets = nodes.filter((node) => /id="(pw|pin)"/.test(node.outerHTML ?? ''));
    assert.equal(secrets.length, 2);
    for (const node of secrets) assert.equal(node.attributes?.['value'], MASK);
  });

  void it('dom get --node-id masks a password value, with and without --raw', async () => {
    const id = String(await nodeIdOf('#pw'));
    for (const args of [
      ['dom', 'get', '--node-id', id],
      ['dom', 'get', '--node-id', id, '--raw'],
    ]) {
      const human = await bdg(args);
      assert.doesNotMatch(human, SHADOW_SECRETS, args.join(' '));
      assert.match(human, /value="••••"/, args.join(' '));
      const json = await bdg([...args, '--json']);
      assert.doesNotMatch(json, SHADOW_SECRETS, `${args.join(' ')} --json`);
      const node = (JSON.parse(json) as { data: GetJson }).data.nodes[0];
      assert.equal(node?.attributes?.['value'], MASK);
      assert.match(node?.outerHTML ?? '', /value="••••"/);
    }
  });

  void it('masks the secret fields inside an element read whole (a form in a shadow root)', async () => {
    const human = await bdg(['dom', 'get', '#login', '--raw']);
    assert.doesNotMatch(human, SHADOW_SECRETS);
    assert.match(human, /^<form id="login">/);
    assert.equal(human.split('value="••••"').length - 1, 2, human);
    const json = await bdg(['dom', 'get', '#login', '--raw', '--json']);
    assert.doesNotMatch(json, SHADOW_SECRETS);
  });

  void it('masks exactly the fields dom query masks, values and text alike', async () => {
    await bdg(['page', 'navigate', `${fixture.url}raw-secrets`]);
    const form = await bdg(['dom', 'get', '#signup', '--raw']);
    assert.doesNotMatch(form, RAW_SECRETS);
    assert.match(form, /<input id="user" name="user" value="ada">/);
    assert.match(form, /<textarea id="otp" name="otp">••••<\/textarea>/);

    const query = await bdgJson<QueryJson>(['dom', 'query', 'input, textarea']);
    const raw = await bdgJson<GetJson>(['dom', 'get', 'input, textarea', '--raw', '--all']);
    assert.equal(raw.nodes.length, query.nodes.length);
    assert.doesNotMatch(JSON.stringify(raw), RAW_SECRETS);
    query.nodes.forEach((queried, i) => {
      const masked = queried.attributes?.value === MASK;
      const html = raw.nodes[i]?.outerHTML ?? '';
      assert.equal(html.includes(MASK), masked, `${queried.id}: ${html}`);
    });
    assert.deepEqual(
      query.nodes.filter((node) => node.attributes?.value === MASK).map((node) => node.id),
      ['pass', 'shown', 'masked', 'card', 'otp']
    );
  });

  void it('masks a copy: the page keeps its values and no custom element is constructed', async () => {
    const before = await bdgJson<{ result: unknown }>([
      'dom',
      'eval',
      '[window.badges, document.querySelector("#pass").getAttribute("value")]',
    ]);
    await bdg(['dom', 'get', '#signup', '--raw']);
    const afterRead = await bdgJson<{ result: unknown }>([
      'dom',
      'eval',
      '[window.badges, document.querySelector("#pass").getAttribute("value")]',
    ]);
    assert.deepEqual(before.result, [1, 'TopSecret99']);
    assert.deepEqual(afterRead.result, before.result);
  });

  void it('masks the whole document read by its node id, after its doctype', async () => {
    const document = await bdgJson<{ result: { root: { backendNodeId: number } } }>([
      'cdp',
      'DOM.getDocument',
      '--params',
      '{"depth":0}',
    ]);
    const html = await bdg(['dom', 'get', '--node-id', String(document.result.root.backendNodeId)]);
    assert.match(html, /^<!DOCTYPE html><html>/);
    assert.doesNotMatch(html, RAW_SECRETS);
    assert.match(html, /<input id="pass" name="pass" type="password" value="••••">/);
  });
});
