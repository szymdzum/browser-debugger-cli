/**
 * `bdg dom frames` and `bdg dom eval --frame` smoke test.
 *
 * A same-origin iframe and a cross-origin one (`localhost` vs `127.0.0.1`,
 * which Chrome runs out of process) are listed, scripts run in each frame's
 * own globals, and an ambiguous or unknown frame is a user error.
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
import type { DomFrame } from '@/ipc/protocol/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

interface Envelope<T> {
  data?: T;
  error?: string;
  suggestion?: string;
}

/**
 * Run a bdg command with `--json` and parse its envelope.
 *
 * @param args - Command and arguments
 * @returns Exit code and envelope
 */
async function runJson<T>(args: string[]): Promise<{ exitCode: number } & Envelope<T>> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, [...rest, '--json'], { timeout: 60000 });
  return { exitCode: result.exitCode, ...(JSON.parse(result.stdout) as Envelope<T>) };
}

void describe('dom eval --frame', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}eval-frames`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('lists same-origin and out-of-process cross-origin iframes', async () => {
    const { exitCode, data } = await runJson<{ frames: DomFrame[] }>(['dom', 'frames']);
    assert.equal(exitCode, 0);
    const [same, cross] = data?.frames ?? [];
    assert.equal(data?.frames.length, 2);
    assert.equal(same?.name, 'same');
    assert.equal(same?.crossOrigin, false);
    assert.equal(same?.outOfProcess, false);
    assert.equal(cross?.id, 'cross');
    assert.equal(cross?.crossOrigin, true);
    assert.equal(cross?.outOfProcess, true);
  });

  void it('evaluates in a same-origin iframe', async () => {
    const { exitCode, data } = await runJson<{ result: unknown; frame: string }>([
      'dom',
      'eval',
      'document.querySelector(".note").textContent',
      '--frame',
      'same',
    ]);
    assert.equal(exitCode, 0);
    assert.equal(data?.result, 'frame');
    assert.match(data?.frame ?? '', /\/deep-frame$/);
  });

  void it('evaluates in a cross-origin iframe with top-level await', async () => {
    const { exitCode, data } = await runJson<{ result: unknown; frame: string }>([
      'dom',
      'eval',
      'await Promise.resolve(location.hostname)',
      '--frame',
      'cross',
    ]);
    assert.equal(exitCode, 0);
    assert.equal(data?.result, 'localhost');
    assert.match(data?.frame ?? '', /^http:\/\/localhost:\d+\/frame-child$/);
  });

  void it('fails with 81 for an ambiguous frame and 83 for an unknown one', async () => {
    const ambiguous = await runJson(['dom', 'eval', '1', '--frame', 'frame']);
    assert.equal(ambiguous.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(ambiguous.suggestion ?? '', /\[0\].*\n.*\[1\]/);
    const unknown = await runJson(['dom', 'eval', '1', '--frame', 'nope']);
    assert.equal(unknown.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.match(unknown.suggestion ?? '', /Available frames/);
  });

  void it('reports a script error in a frame as exit 91', async () => {
    const result = await runJson(['dom', 'eval', 'missingName', '--frame', '1']);
    assert.equal(result.exitCode, EXIT_CODES.SCRIPT_ERROR);
    assert.match(result.error ?? '', /missingName is not defined/);
  });
});
