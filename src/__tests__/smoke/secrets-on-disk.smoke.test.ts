/**
 * Secrets in files on disk smoke test (#634, #624).
 *
 * The session opens `/html-secrets`, whose form holds every shape of secret
 * and ordinary control. The default HAR and `details network <doc> --body`
 * mask the values of the secret controls and keep the ordinary ones and the
 * inline script; `--include-sensitive` keeps everything; `network document`
 * (headers only) prints no value at all. `state save` and
 * `cdp --collect --out` write their file 0600 also over an existing 0644
 * file.
 */

import * as fs from 'fs';
import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as path from 'path';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { HTML_SECRET_ROWS } from '@/__testutils__/fixturePages/htmlSecretFixtures.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';

/** Values the sanitiser must replace */
const MASKED = HTML_SECRET_ROWS.filter((row) => !row.kept).map((row) => row.secret);

/** Values that stay as captured */
const KEPT = HTML_SECRET_ROWS.filter((row) => row.kept).map((row) => row.secret);

/** A request of `network list --json` */
interface ListedRequest {
  requestId: string;
  url: string;
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
 * Assert that text holds every kept value and none of the masked ones.
 *
 * @param text - Output or file text
 * @param what - What the text is, for messages
 */
function assertMasked(text: string, what: string): void {
  for (const secret of MASKED) assert.ok(!text.includes(secret), `${what} holds ${secret}`);
  for (const value of KEPT) assert.ok(text.includes(value), `${what} lost ${value}`);
}

/**
 * Id of the document request.
 *
 * @returns Request id of `/html-secrets`
 */
async function documentId(): Promise<string> {
  const out = await bdg(['network', 'list', '--last', '0', '--json']);
  const requests = (JSON.parse(out) as { data: { requests: ListedRequest[] } }).data.requests;
  const doc = requests.find((r) => new URL(r.url).pathname === '/html-secrets');
  assert.ok(doc, `no document request: ${out}`);
  return doc.requestId;
}

/**
 * Make a world-readable file at a path.
 *
 * @param dir - Directory
 * @param name - File name
 * @returns The path
 */
function existing644(dir: string, name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'old\n');
  fs.chmodSync(file, 0o644);
  assert.equal(fs.statSync(file).mode & 0o777, 0o644);
  return file;
}

after(removeTempDirs);

void describe('Secrets in files on disk', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const result = await runCommand(
      `${fixture.url}html-secrets`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('the default HAR masks secret form-control values of the HTML body and says so', async () => {
    const file = path.join(makeTempDir('bdg-html-'), 'default.har');
    const out = await bdg(['network', 'har', file]);
    assertMasked(fs.readFileSync(file, 'utf8'), 'the default HAR');
    assert.match(out, /HTML bodies/);
  });

  void it('--include-sensitive keeps the HTML body as captured', async () => {
    const file = path.join(makeTempDir('bdg-html-'), 'full.har');
    await bdg(['network', 'har', file, '--include-sensitive']);
    const text = fs.readFileSync(file, 'utf8');
    for (const secret of [...MASKED, ...KEPT]) assert.ok(text.includes(secret), `lost ${secret}`);
  });

  void it('details network --body masks the same values; network document prints none', async () => {
    const id = await documentId();
    const body = await bdg(['details', 'network', id, '--body']);
    assertMasked(body, 'details network --body');
    assert.match(body, /••••/);
    const full = await bdg(['details', 'network', id, '--body', '--include-sensitive']);
    for (const secret of MASKED)
      assert.ok(full.includes(secret), `--include-sensitive lost ${secret}`);
    const document = await bdg(['network', 'document']);
    for (const secret of [...MASKED, ...KEPT]) assert.ok(!document.includes(secret));
  });

  void it(
    'state save writes 0600 over an existing 0644 file and says so (#624)',
    { skip: process.platform === 'win32' },
    async () => {
      const dir = makeTempDir('bdg-state-');
      const existing = existing644(dir, 'existing.json');
      const out = await bdg(['state', 'save', existing]);
      assert.equal(fs.statSync(existing).mode & 0o777, 0o600);
      assert.match(out, /readable by its owner only/);
      const fresh = path.join(dir, 'fresh.json');
      await bdg(['state', 'save', fresh]);
      assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
    }
  );

  void it(
    'cdp --collect --out writes 0600 over an existing 0644 file (#624)',
    { skip: process.platform === 'win32' },
    async () => {
      const dir = makeTempDir('bdg-cdp-');
      const existing = existing644(dir, 'events.ndjson');
      const collect = [
        'Runtime.evaluate',
        '--params',
        '{"expression":"console.log(\'collected\')"}',
        '--collect',
        'Runtime.consoleAPICalled',
        '--until',
        'Runtime.consoleAPICalled',
        '--out',
      ];
      await bdg(['cdp', ...collect, existing]);
      assert.equal(fs.statSync(existing).mode & 0o777, 0o600);
      const fresh = path.join(dir, 'fresh.ndjson');
      await bdg(['cdp', ...collect, fresh]);
      assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
    }
  );
});
