/**
 * Session end smoke test.
 *
 * `bdg stop` must shut Chrome down cleanly so a `--user-data-dir` keeps
 * cookies and storage written just before stopping, and follow modes must
 * stop with 83 when the session ends (no crash, no stack trace).
 */

import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import { ensureTestSessionDir, getTestHomeDir } from '@/__testutils__/testHome.js';

const CLI_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../dist/index.js'
);

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns stdout
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/**
 * Evaluate an expression in the page.
 *
 * @param expression - JavaScript expression
 * @returns Evaluation result
 */
async function evaluate(expression: string): Promise<unknown> {
  const output = await bdg(['dom', 'eval', expression, '--json']);
  return (JSON.parse(output) as { data: { result: unknown } }).data.result;
}

after(removeTempDirs);

void describe('Session end', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('keeps cookies and storage of a user data dir across bdg stop', async () => {
    const profile = makeTempDir('bdg-profile-');
    const start = async (): Promise<void> => {
      const port = await getFreePort();
      await bdg([fixture.url, '--port', String(port), '--headless', '-u', profile]);
    };

    await start();
    await evaluate(
      "document.cookie = 'kept=yes; max-age=3600; path=/'; localStorage.setItem('kept', 'yes'); 1"
    );
    await bdg(['stop']);

    await start();
    try {
      assert.match(String(await evaluate('document.cookie')), /kept=yes/);
      assert.equal(await evaluate("localStorage.getItem('kept')"), 'yes');
    } finally {
      await bdg(['stop']);
    }
  });

  void it('stops a follow mode with 83 when the session ends, without a stack trace', async () => {
    const port = await getFreePort();
    await bdg([fixture.url, '--port', String(port), '--headless']);

    const follower = spawn('node', [CLI_PATH, 'peek', '-f'], {
      env: { ...process.env, BDG_SESSION_DIR: ensureTestSessionDir(), HOME: getTestHomeDir() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    follower.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const following = once(follower.stdout, 'data');
    follower.stdout.resume();

    const closed = once(follower, 'close') as Promise<[number | null]>;
    await Promise.race([following, closed]);
    await bdg(['stop']);
    const [exitCode] = await closed;

    assert.equal(exitCode, 83, stderr);
    assert.doesNotMatch(stderr, /\n\s+at |IPCConnectionError/, stderr);
    assert.match(stderr, /The session ended; stopped following/);
  });
});
