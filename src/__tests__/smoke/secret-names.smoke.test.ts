/**
 * Secret field names smoke test (#622, #601).
 *
 * The session opens `/secret-names` with `user:pass@` in its URL. Fields
 * named `api_key`, `token`, `client_secret` and `pass` show `••••` on every
 * DOM surface (`dom query`, `dom get` text, `--raw` and `--node-id`,
 * `dom form`, `dom a11y describe|query|tree`, `dom inspect`, the `dom fill`
 * echo), human and `--json`; a hidden input's value is `••••` in raw HTML;
 * fields whose names only contain a credential word (`passport`, `keyword`)
 * stay readable. The default HAR holds neither the `pass`/`pw` values the
 * page posts nor the URL's credentials.
 */

import * as fs from 'fs';
import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as path from 'path';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';

/** Shown instead of a secret value */
const MASK = '••••';

/** Values of the fields named like secrets, and of the hidden input */
const FIELD_SECRETS = /APIKEYFIELD7|TOKENFIELD8|SECRETFIELD9|PASSFIELD10|TOKEN123/;

/** Values the page posts under short password names, and the URL's password */
const HAR_SECRETS = /HARPASS53|HARPW54|FULLPW|JSONPASS55|JSONPW56|BASICPW46|bob:/;

/** Values of ordinary fields, which stay readable */
const ORDINARY = ['PASSPORT11', 'KEYWORD12'];

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
 * Run a bdg command in human and `--json` mode and return both outputs.
 *
 * @param args - Full bdg argument list without `--json`
 * @returns Human output followed by JSON output
 */
async function bothModes(args: string[]): Promise<string> {
  return `${await bdg(args)}\n${await bdg([...args, '--json'])}`;
}

/**
 * Assert an output shows no secret field value.
 *
 * @param output - Command output
 * @param what - Command, for the message
 */
function assertNoFieldSecret(output: string, what: string): void {
  assert.doesNotMatch(output, FIELD_SECRETS, `${what} shows a secret value`);
}

after(removeTempDirs);

void describe('secret field names', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const url = fixture.url.replace('://', '://bob:BASICPW46@');
    const result = await runCommand(`${url}secret-names`, ['--port', String(port), '--headless'], {
      timeout: 60000,
    });
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
    await bdg(['dom', 'wait', '#sent', '--timeout', '10000']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('dom query masks fields named like keys, tokens and secrets', async () => {
    const output = await bothModes(['dom', 'query', 'input']);
    assertNoFieldSecret(output, 'dom query');
    assert.ok(output.includes(MASK));
    for (const value of ORDINARY) assert.ok(output.includes(value), `dom query hides ${value}`);
  });

  void it('dom get masks them in text, --raw and --node-id', async () => {
    for (const selector of ['#apikey', '#token', '#secret', '#pass']) {
      assertNoFieldSecret(await bothModes(['dom', 'get', selector]), `dom get ${selector}`);
      assertNoFieldSecret(
        await bothModes(['dom', 'get', selector, '--raw']),
        `dom get ${selector} --raw`
      );
    }
    const raw = await bothModes(['dom', 'get', '#account', '--raw']);
    assertNoFieldSecret(raw, 'dom get #account --raw');
    for (const value of ORDINARY) assert.ok(raw.includes(value), `--raw hides ${value}`);
    const query = JSON.parse(await bdg(['dom', 'query', '#account', '--json'])) as {
      data: { nodes: Array<{ nodeId: number }> };
    };
    const nodeId = String(query.data.nodes[0]?.nodeId);
    assertNoFieldSecret(await bothModes(['dom', 'get', '--node-id', nodeId]), 'dom get --node-id');
  });

  void it('dom get --raw shows a hidden input value as •••• (#601)', async () => {
    const output = await bothModes(['dom', 'get', '#csrf', '--raw']);
    assertNoFieldSecret(output, 'dom get #csrf --raw');
    assert.match(output, /value="••••"/);
  });

  void it('dom form masks them', async () => {
    const output = await bothModes(['dom', 'form']);
    assertNoFieldSecret(output, 'dom form');
    for (const value of ORDINARY) assert.ok(output.includes(value), `dom form hides ${value}`);
  });

  void it('dom a11y describe, query and tree mask them', async () => {
    assertNoFieldSecret(
      await bothModes(['dom', 'a11y', 'describe', '#apikey']),
      'dom a11y describe'
    );
    assertNoFieldSecret(await bothModes(['dom', 'a11y', 'query', 'role:textbox']), 'a11y query');
    assertNoFieldSecret(await bothModes(['dom', 'a11y', 'tree']), 'dom a11y tree');
  });

  void it('dom inspect masks them', async () => {
    for (const selector of ['#apikey', '#token', '#secret', '#pass']) {
      assertNoFieldSecret(await bothModes(['dom', 'inspect', selector]), `dom inspect ${selector}`);
    }
  });

  void it('dom fill echoes such a field as •••• with sensitive: true', async () => {
    const human = await bdg(['dom', 'fill', '#apikey', 'NEWKEY13']);
    assert.match(human, /^Value: +••••$/m);
    assert.doesNotMatch(human, /NEWKEY13/);
    const output = await bdg(['dom', 'fill', '#secret', 'NEWSECRET14', '--json']);
    assert.doesNotMatch(output, /NEWSECRET14/);
    const data = (JSON.parse(output) as { data: { value?: string; sensitive?: boolean } }).data;
    assert.equal(data.value, MASK);
    assert.equal(data.sensitive, true);
  });

  void it('the default HAR holds no pass/pw value and no URL credentials', async () => {
    const file = path.join(makeTempDir('bdg-har-'), 'names.har');
    await bdg(['network', 'har', file]);
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, HAR_SECRETS);
    assert.match(text, /secret-names/);
  });
});
