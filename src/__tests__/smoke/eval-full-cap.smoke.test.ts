/**
 * `eval --full` result cap smoke test (#693).
 *
 * A result over 50 MiB is refused with exit 81 and a suggestion, in human and
 * `--json` output, before the CLI holds it (a 200 MB string used to end in a
 * V8 out-of-memory crash, exit 134); a result under the cap, and any result
 * without `--full`, behaves as before.
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
import { MAX_VALUE_LENGTH } from '@/constants.js';

const CAP = 50 * 1024 * 1024;

interface ErrorEnvelope {
  success: boolean;
  error: string;
  exitCode: number;
  suggestion?: string;
}

void describe('eval --full cap', () => {
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

  void it('refuses a string one character over the cap with exit 81 and a suggestion', async () => {
    const result = await runCommand('eval', [`'x'.repeat(${CAP} + 1)`, '--full', '--json'], {
      timeout: 120000,
    });
    assert.equal(result.exitCode, 81, result.stderr);
    const envelope = JSON.parse(result.stdout) as ErrorEnvelope;
    assert.equal(envelope.success, false);
    assert.equal(envelope.exitCode, 81);
    assert.match(envelope.error, /50 MiB/);
    assert.match(envelope.suggestion ?? '', /slice|length|--full/);
  });

  void it('refuses an object over the cap in human output too', async () => {
    const result = await runCommand(
      'eval',
      [`Array.from({ length: 60 }, () => 'y'.repeat(1024 * 1024))`, '--full'],
      { timeout: 120000 }
    );
    assert.equal(result.exitCode, 81, result.stdout.slice(0, 200));
    assert.match(result.stderr, /50 MiB/);
    assert.match(result.stderr, /slice|\.length|without --full/);
    assert.ok(result.stdout.length < 1000, `stdout holds ${result.stdout.length} chars`);
  });

  void it('returns a result under the cap whole', async () => {
    const result = await runCommand('eval', [`'z'.repeat(1_000_000)`, '--full'], {
      timeout: 60000,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `${'z'.repeat(1_000_000)}\n`);
  });

  void it('refuses 200 MB within seconds, and the session stays usable', async () => {
    const startedAt = Date.now();
    const result = await runCommand('eval', [`'x'.repeat(200 * 1024 * 1024)`, '--full'], {
      timeout: 60000,
    });
    assert.equal(result.exitCode, 81, result.stderr.slice(0, 300));
    assert.ok(Date.now() - startedAt < 15000, `took ${Date.now() - startedAt} ms`);
    const after = await runCommand('eval', ['1 + 1'], { timeout: 30000 });
    assert.equal(after.exitCode, 0, after.stderr);
  });

  void it('refuses what the page copy undercounts or the page-side count misses', async () => {
    const cases: Record<string, string> = {
      map: `new Map([[1, 'z'.repeat(60 * 1024 * 1024)]])`,
      multibyte: `'€'.repeat(20 * 1024 * 1024)`,
      floats: `new Array(5e6).fill(0.1234567890123456)`,
    };
    for (const [name, expression] of Object.entries(cases)) {
      const result = await runCommand('eval', [expression, '--full'], { timeout: 120000 });
      assert.equal(result.exitCode, 81, `${name}: ${result.stdout.length} chars out`);
      assert.match(result.stderr, /50 MiB/, name);
    }
  });

  void it('returns an object under the cap exactly as formatted', async () => {
    const result = await runCommand('eval', [`({ a: [1, 2.5, 'é'], b: { c: null } })`, '--full'], {
      timeout: 60000,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    const expected =
      '{\n  "a": [\n    1,\n    2.5,\n    "é"\n  ],\n  "b": {\n    "c": null\n  }\n}\n';
    assert.equal(result.stdout, expected);
  });

  void it('without --full the same 200 MB eval still prints the preview', async () => {
    const result = await runCommand('eval', [`'x'.repeat(200 * 1024 * 1024)`], {
      timeout: 120000,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.length < MAX_VALUE_LENGTH + 100, `${result.stdout.length}`);
    assert.match(result.stdout, /more chars \(use --full\)/);
  });

  void it('refuses an object over the cap on a page that replaced built-ins', async () => {
    const result = await runCommand(
      'eval',
      [`Object.keys = () => ['a']; ({ a: 'z'.repeat(60 * 1024 * 1024) })`, '--full'],
      { timeout: 120000 }
    );
    assert.equal(result.exitCode, 81, `${result.stdout.length} chars out`);
  });
});
