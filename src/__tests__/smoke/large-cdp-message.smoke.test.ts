/**
 * Large CDP message smoke test (#487).
 *
 * A CDP message over 100 MiB (a 110 MiB `dom eval` result) used to end the
 * whole session: ws refused the frame and closed the socket. It must come
 * back truncated as usual, and the session must keep running. One session,
 * one large message, to keep CI fast.
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

/** A 110 MiB string, over ws's former 100 MiB `maxPayload` */
const LARGE_RESULT = "'a'.repeat(110 * 1024 * 1024)";

/** Most bytes a truncated result prints */
const MAX_OUTPUT_BYTES = 1024 * 1024;

void describe('Large CDP message', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = String(await getFreePort());
    const started = await runCommand(fixture.url, ['--port', port, '--headless'], {
      timeout: 60000,
    });
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('returns a 110 MiB eval result truncated and keeps the session', async () => {
    const result = await runCommand('dom', ['eval', LARGE_RESULT, '--json'], { timeout: 90000 });
    assert.equal(result.exitCode, 0, `${result.stdout}${result.stderr}`);
    assert.ok(result.stdout.length < MAX_OUTPUT_BYTES, `${result.stdout.length} bytes`);
    const data = (JSON.parse(result.stdout) as { data: { result: unknown } }).data;
    assert.match(String(data.result), /^a{100}/);

    const status = await runCommand('status', ['--json'], { timeout: 30000 });
    const parsed = JSON.parse(status.stdout) as { data: { active: boolean } };
    assert.equal(parsed.data.active, true, status.stdout);
  });
});
