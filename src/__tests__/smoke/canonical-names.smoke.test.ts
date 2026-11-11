/**
 * Canonical command names smoke test (#465, D4 and D13): on `/key-log`,
 * `network cookies` lists a cookie the page set, `bdg eval` evaluates and
 * `dom press-key` presses the key, none with a warning (the old names were
 * removed in 1.0).
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
 * Run a bdg command and assert its exit code.
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
 * The cookie names of a `--json` cookies result.
 *
 * @param stdout - Standard output of the command
 * @returns Names
 */
function cookieNames(stdout: string): string[] {
  const { data } = JSON.parse(stdout) as { data: Array<{ name: string }> };
  return data.map((cookie) => cookie.name);
}

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  await bdg([`${fixture.url}key-log`, '--port', String(port), '--headless']);
  await bdg(['eval', 'document.cookie = "canon=1"; 1']);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('canonical command names (#465)', () => {
  void it('network cookies lists the page cookie, no warning', async () => {
    const current = await bdg(['network', 'cookies', '--json']);
    assert.ok(cookieNames(current.stdout).includes('canon'), current.stdout);
    assert.ok(!current.stdout.includes('"warnings"'), current.stdout);
  });

  void it('eval evaluates, no warning', async () => {
    const result = await bdg(['eval', 'document.title', '--json']);
    const { data } = JSON.parse(result.stdout) as { data: { result: unknown } };
    assert.ok(data.result !== undefined);
    assert.ok(!result.stdout.includes('"warnings"'), result.stdout);
  });

  void it('dom press-key presses the key, no warning', async () => {
    await bdg(['eval', 'window.keyLog = []; 1']);
    const result = await bdg(['dom', 'press-key', '#field', 'a', '--json']);
    assert.ok(!result.stdout.includes('"warnings"'), result.stdout);
    const log = await bdg(['eval', 'window.keyLog', '--json']);
    assert.match(log.stdout, /a\|KeyA\|false/);
  });
});
