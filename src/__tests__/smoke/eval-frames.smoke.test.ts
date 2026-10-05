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

  void it('points to dom frames when a selector finds nothing on a page with cross-origin iframes', async () => {
    const query = await runJson<never>(['dom', 'query', '#missing']);
    assert.equal(query.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.match(
      query.suggestion ?? '',
      /The page has cross-origin iframes, which are not searched/
    );
    assert.match(query.suggestion ?? '', /bdg dom eval --frame <n>/);
    const click = await runJson<never>(['dom', 'click', '#missing']);
    assert.equal(click.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.match(click.suggestion ?? '', /The page has cross-origin iframes/);
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

  void it('prints the Frame: line on stderr so stdout pipes cleanly', async () => {
    const result = await runCommand('dom', [
      'eval',
      '({ title: document.title })',
      '--frame',
      'same',
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { title: '' });
    assert.match(result.stderr, /^Frame: http:\/\/127\.0\.0\.1:\d+\/deep-frame$/m);
    const quiet = await runCommand('dom', ['eval', '1', '--frame', 'same', '-q']);
    assert.equal(quiet.stderr, '');
  });

  void it('reports a frame that navigates while the script runs as 83', async () => {
    const result = await runJson([
      'dom',
      'eval',
      'location.href = "/deep-frame?next"; await new Promise((r) => setTimeout(r, 3000)); 1',
      '--frame',
      'same',
    ]);
    assert.equal(result.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.match(result.error ?? '', /The frame navigated while the script ran/);
  });

  void it('reports the origin scripts run with for srcdoc, data: and sandboxed frames', async () => {
    const navigated = await runCommand('page', ['navigate', `${fixture.url}frame-origins`]);
    assert.equal(navigated.exitCode, 0, navigated.stderr);
    const { data } = await runJson<{ frames: DomFrame[] }>(['dom', 'frames']);
    const top = new URL(fixture.url).origin;
    const byId = new Map(data?.frames.map((frame) => [frame.id, frame]));
    const summary = (id: string): string => {
      const frame = byId.get(id);
      return `${frame?.origin === top ? 'top' : frame?.origin}:${frame?.crossOrigin}`;
    };
    assert.deepEqual(['sd', 'inner', 'blank', 'dataf', 'sb', 'sbso'].map(summary), [
      'top:false',
      'top:false',
      'top:false',
      'null:true',
      'null:true',
      'top:false',
    ]);
    assert.equal(byId.get('inner')?.parentIndex, byId.get('sd')?.index);
    const sandboxed = await runJson<{ result: unknown }>([
      'dom',
      'eval',
      'origin',
      '--frame',
      'sb',
    ]);
    assert.equal(sandboxed.data?.result, 'null');
  });

  void it('lists frames in document order and refuses an index that went stale', async () => {
    const navigated = await runCommand('page', ['navigate', `${fixture.url}frame-order`]);
    assert.equal(navigated.exitCode, 0, navigated.stderr);
    const names = async (): Promise<Array<string | undefined>> =>
      (await runJson<{ frames: DomFrame[] }>(['dom', 'frames'])).data?.frames.map((f) => f.name) ??
      [];
    assert.deepEqual(await names(), ['shadowed', 'cross', 'last']);
    assert.deepEqual(await names(), ['shadowed', 'cross', 'last']);

    const added = await runJson(['dom', 'eval', 'await addFirst()']);
    assert.equal(added.exitCode, 0, added.error);
    const stale = await runJson(['dom', 'eval', 'window.name', '--frame', '0']);
    assert.equal(stale.exitCode, EXIT_CODES.STALE_CACHE);
    assert.match(stale.error ?? '', /Frame index 0 is stale/);
    assert.match(stale.suggestion ?? '', /Re-run bdg dom frames/);
    const byName = await runJson<{ result: unknown }>([
      'dom',
      'eval',
      'window.name',
      '--frame',
      'cross',
    ]);
    assert.equal(byName.data?.result, 'cross', 'names still work');

    assert.deepEqual(await names(), ['first', 'shadowed', 'cross', 'last']);
    const fresh = await runJson<{ result: unknown }>([
      'dom',
      'eval',
      'window.name',
      '--frame',
      '0',
    ]);
    assert.equal(fresh.exitCode, 0, fresh.error);
    assert.equal(fresh.data?.result, 'first');
  });
});
