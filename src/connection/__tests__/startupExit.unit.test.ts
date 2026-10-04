/**
 * A Chrome that exits during startup is reported with what it said.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import type { ChildProcess } from 'node:child_process';

import { ChromeLaunchError } from '@/connection/errors.js';
import { markStartupLogs, watchStartupExit } from '@/connection/startupExit.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-startup-'));
after(() => fs.rmSync(profile, { recursive: true, force: true }));

/**
 * The issue context of a startup error.
 *
 * @param error - Rejection reason
 * @returns Issue context
 */
function contextOf(error: unknown): Record<string, unknown> {
  assert.ok(error instanceof ChromeLaunchError);
  assert.equal(error.issue?.code, 'CHROME_EXITED_DURING_STARTUP');
  return error.issue.context ?? {};
}

void describe('watchStartupExit', () => {
  void it('rejects with the output Chrome wrote during this launch only', async () => {
    const errLog = path.join(profile, 'chrome-err.log');
    fs.writeFileSync(errLog, 'old line from an earlier launch\n');
    const logs = markStartupLogs(profile);
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
    }) as unknown as ChildProcess;
    const watch = watchStartupExit(() => child, logs, profile);

    fs.appendFileSync(errLog, 'ERROR: Multiple targets are not supported in headless mode.\n');
    child.emit('exit', 13);

    const context = contextOf(await watch.exited.catch((error: unknown) => error));
    assert.equal(context['exitCode'], 13);
    assert.deepEqual(context['output'], [
      'ERROR: Multiple targets are not supported in headless mode.',
    ]);
    assert.equal(context['profileInUse'], false);
  });

  void it('recognizes a profile opened by another Chrome', async () => {
    const logs = markStartupLogs(profile);
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
    }) as unknown as ChildProcess;
    const watch = watchStartupExit(() => child, logs, profile);
    fs.appendFileSync(
      path.join(profile, 'chrome-out.log'),
      'Opening in existing browser session.\n'
    );
    child.emit('exit', 0);

    assert.equal(
      contextOf(await watch.exited.catch((error: unknown) => error))['profileInUse'],
      true
    );
  });

  void it('notices a Chrome that exited before it was first looked at', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: 21, signalCode: null });
    const watch = watchStartupExit(
      () => child as unknown as ChildProcess,
      markStartupLogs(profile),
      profile
    );
    assert.equal(contextOf(await watch.exited.catch((error: unknown) => error))['exitCode'], 21);
  });

  void it('ignores an exit after it was stopped', async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
    }) as unknown as ChildProcess;
    const watch = watchStartupExit(() => child, markStartupLogs(profile), profile);
    watch.stop();
    child.emit('exit', 0);
    const outcome = await Promise.race([
      watch.exited.then(
        () => 'settled',
        () => 'settled'
      ),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 50)),
    ]);
    assert.equal(outcome, 'pending');
  });
});
