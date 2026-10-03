/**
 * Network and navigation smoke test against a real redirect.
 *
 * Starts a session on `/redirect` (302 to `/`) and checks that the redirect hop
 * is recorded, exported to HAR, and that console messages of the page load are
 * not dropped.
 */

import * as fs from 'fs';
import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

/**
 * Run a bdg command with `--json` and return the parsed envelope's `data`.
 *
 * @param command - bdg subcommand
 * @param args - Additional arguments
 * @returns Parsed `data` field
 */
async function runJson<T>(command: string, args: string[] = []): Promise<T> {
  const result = await runCommand(command, [...args, '--json'], { timeout: 30000 });
  assert.equal(result.exitCode, 0, `bdg ${command} ${args.join(' ')} failed: ${result.stderr}`);
  return (JSON.parse(result.stdout) as { data: T }).data;
}

interface ListedRequest {
  requestId: string;
  url: string;
  status?: number;
}

void describe('Network and navigation', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const result = await runCommand(
      `${fixture.url}redirect`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('records the redirect hop and the final document', async () => {
    const data = await runJson<{ requests: ListedRequest[] }>('network', ['list', '--last', '0']);
    const hop = data.requests.find((r) => r.url.endsWith('/redirect'));
    const final = data.requests.find((r) => r.url === fixture.url && r.status === 200);
    assert.equal(hop?.status, 302, `Requests: ${JSON.stringify(data.requests)}`);
    assert.match(hop?.requestId ?? '', /:redirect:1$/);
    assert.ok(final, 'final document request should be recorded');
  });

  void it('exports the redirect target to HAR', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-har-')), 'out.har');
    const result = await runCommand('network', ['har', file], { timeout: 30000 });
    assert.equal(result.exitCode, 0, `HAR failed: ${result.stderr}`);
    const har = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      log: {
        entries: Array<{
          request: { url: string };
          response: { status: number; redirectURL: string };
        }>;
      };
    };
    const hop = har.log.entries.find((e) => e.request.url.endsWith('/redirect'));
    assert.equal(hop?.response.status, 302);
    assert.equal(hop?.response.redirectURL, fixture.url);
  });

  void it('keeps all console messages of the current page load', async () => {
    const data = await runJson<{ messages: Array<{ text: string }> }>('console', ['--list']);
    const texts = data.messages.map((m) => m.text);
    assert.ok(texts.includes('Test page loaded successfully'), `Console: ${texts.join(' | ')}`);
    assert.ok(texts.includes('This is a test warning'), `Console: ${texts.join(' | ')}`);
  });

  void it('serves headers of the main document by default', async () => {
    const data = await runJson<{ url: string }>('network', ['document']);
    assert.equal(data.url, fixture.url);
  });
});
