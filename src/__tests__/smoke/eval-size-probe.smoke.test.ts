/**
 * `dom eval` results too large to send are refused within seconds (#705).
 *
 * Strings and Maps of 300 MB, an object holding 300 MB without `--full`, and
 * a 900 MB object on a page that replaced built-ins used to end in a 20-30 s
 * timeout (exit 101 or 102).
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

const FAST_MS = 30_000;

/**
 * Run `dom eval` and time it.
 *
 * @param script - The script
 * @param extra - More arguments
 * @returns Exit code, stderr and seconds taken
 */
async function timedEval(
  script: string,
  extra: string[] = []
): Promise<{ exitCode: number; stderr: string; ms: number }> {
  const startedAt = Date.now();
  const result = await runCommand('dom', ['eval', script, ...extra], { timeout: 60000 });
  return { exitCode: result.exitCode, stderr: result.stderr, ms: Date.now() - startedAt };
}

void describe('dom eval size probe', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const start = await runCommand(
      `${fixture.url}interactions`,
      ['--port', String(await getFreePort()), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(start.exitCode, 0, start.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('a 300 MB string fails within seconds, with and without --full', async () => {
    const plain = await timedEval(`'x'.repeat(300e6)`);
    assert.equal(plain.exitCode, 102, plain.stderr.slice(0, 200));
    assert.ok(plain.ms < FAST_MS, `${plain.ms} ms`);
    const full = await timedEval(`'x'.repeat(300e6)`, ['--full']);
    assert.equal(full.exitCode, 81, full.stderr.slice(0, 200));
    assert.ok(full.ms < FAST_MS, `${full.ms} ms`);
  });

  void it('a 300 MB Map fails within seconds, with and without --full', async () => {
    const script = `new Map([['k', 'x'.repeat(300e6)]])`;
    for (const extra of [[], ['--full']]) {
      const result = await timedEval(script, extra);
      assert.ok(
        [81, 102].includes(result.exitCode),
        `${result.exitCode}: ${result.stderr.slice(0, 200)}`
      );
      assert.ok(result.ms < FAST_MS, `${result.ms} ms`);
    }
  });

  void it('an object holding 300 MB is refused within seconds without --full', async () => {
    const result = await timedEval(`({ a: 'x'.repeat(300e6) })`);
    assert.equal(result.exitCode, 81, result.stderr.slice(0, 200));
    assert.match(result.stderr, /too large/i);
    assert.ok(result.ms < FAST_MS, `${result.ms} ms`);
  });

  void it('a 900 MB object on a page that replaced built-ins is refused within seconds', async () => {
    const result = await timedEval(
      `Object.keys = () => ['a']; ({ a: 'x'.repeat(450e6), b: 'y'.repeat(450e6) })`,
      ['--full']
    );
    assert.equal(result.exitCode, 81, result.stderr.slice(0, 200));
    assert.ok(result.ms < FAST_MS, `${result.ms} ms`);
  });

  void it('a healthy script that runs 3 s before returning a small value is not reported lost', async () => {
    const result = await runCommand(
      'dom',
      ['eval', `const e = Date.now(); while (Date.now() - e < 3000); 'done'`],
      { timeout: 60000 }
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'done\n');
  });

  void it('the session stays usable', async () => {
    const result = await runCommand('dom', ['eval', '1 + 1'], { timeout: 30000 });
    assert.equal(result.exitCode, 0, result.stderr);
  });
});
