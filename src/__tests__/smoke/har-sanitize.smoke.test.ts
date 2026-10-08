/**
 * HAR sanitization smoke test.
 *
 * A fixture page logs in with `Authorization: Bearer SECRET`, an `X-Api-Key`
 * header and `{"password":"hunter2"}`, gets an HttpOnly session cookie and
 * sends it back. The default HAR export holds none of these values;
 * `--include-sensitive` keeps them.
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

/** Secret values the fixture page sends or receives */
const SECRETS = ['SECRET', 'hunter2'];

/** Result data of `network har --json` */
interface HarExport {
  file: string;
  entries: number;
  sanitized: boolean;
}

/**
 * Export the session's HAR to a new file.
 *
 * @param args - Extra arguments for `network har`
 * @returns Export result and the file's text
 */
async function exportHar(args: string[] = []): Promise<{ data: HarExport; text: string }> {
  const file = path.join(makeTempDir('bdg-har-'), 'out.har');
  const result = await runCommand('network', ['har', file, ...args, '--json'], { timeout: 30000 });
  assert.equal(result.exitCode, 0, `HAR failed: ${result.stderr}`);
  const data = (JSON.parse(result.stdout) as { data: HarExport }).data;
  return { data, text: fs.readFileSync(file, 'utf8') };
}

/**
 * Wait until both login requests of the fixture page have finished.
 */
async function waitForLogins(): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await runCommand('network', ['list', '--last', '0', '--json'], {
      timeout: 30000,
    });
    const requests = (
      JSON.parse(result.stdout) as { data: { requests: Array<{ url: string; status?: number }> } }
    ).data.requests;
    if (requests.filter((r) => r.url.endsWith('/har-login') && r.status === 200).length >= 2) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail('the fixture page did not finish its login requests');
}

after(removeTempDirs);

void describe('HAR export sanitization', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const result = await runCommand(
      `${fixture.url}har-secrets`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
    await waitForLogins();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('writes no credentials by default and says so', async () => {
    const { data, text } = await exportHar();
    for (const secret of SECRETS) {
      assert.ok(!text.includes(secret), `default HAR should not contain ${secret}`);
    }
    assert.equal(data.sanitized, true);
    assert.match(text, /"name": "Authorization",\s*"value": "\[redacted\]"/);
    assert.match(text, /"name": "har_session",\s*"value": "\[redacted\]"/);
    assert.match(text, /\\"password\\":\\"\[redacted\]\\"/);
  });

  void it('keeps credentials with --include-sensitive', async () => {
    const { data, text } = await exportHar(['--include-sensitive']);
    assert.equal(data.sanitized, false);
    assert.ok(text.includes('Bearer SECRET'), 'Authorization value kept');
    assert.ok(text.includes('SECRET-KEY'), 'X-Api-Key value kept');
    assert.ok(text.includes('SECRET-SESSION'), 'cookie value kept');
    assert.ok(text.includes('hunter2'), 'password kept');
  });

  void it('names the flag in the human success message', async () => {
    const file = path.join(makeTempDir('bdg-har-'), 'human.har');
    const result = await runCommand('network', ['har', file], { timeout: 30000 });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /sanitized.*--include-sensitive/);
  });

  void it(
    'writes the file readable by its owner only',
    { skip: process.platform === 'win32' },
    async () => {
      const { data } = await exportHar();
      assert.equal(fs.statSync(data.file).mode & 0o777, 0o600);
    }
  );
});
