/**
 * Releasing a command's object group is housekeeping (#606): a release that
 * fails or times out never replaces the command's own error or result, never
 * stalls it, and a group is released even when the call that created it failed.
 */

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { startFakeDaemon, type FakeDaemon } from '@/__testutils__/fakeDaemon.js';
import { UNKNOWN_NODE_ERROR } from '@/__testutils__/fakeObjectPage.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import { assertNodeAttached, queryDOMElements } from '@/commands/dom/helpers/query.js';
import { CommandError } from '@/errors/index.js';
import { raceTimeout } from '@/utils/async.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** A recorded CDP call */
interface Call {
  method: string;
  params: Record<string, unknown>;
}

/** How the fake page answers a release */
type Release = 'ok' | 'timeout' | 'hang';

/** Longest a check may take with a page that never answers the release */
const STALL_LIMIT_MS = 6000;

let daemon: FakeDaemon | undefined;

/**
 * The daemon's answer for a page that did not answer in time (102).
 *
 * @param method - The CDP method
 * @returns The error
 */
function timedOut(method: string): Error {
  return Object.assign(new Error(`${method} timed out`), { exitCode: EXIT_CODES.CDP_TIMEOUT });
}

/**
 * Serve a page whose element 1 resolves (or is gone) and whose check of it
 * fails, with the given release behaviour.
 *
 * @param options - Element state, release behaviour, creating call failure
 * @returns The calls the page received
 */
async function serve(options: {
  gone?: boolean;
  release: Release;
  selectionFails?: boolean;
}): Promise<Call[]> {
  const calls: Call[] = [];
  daemon = await startFakeDaemon({
    send: (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Runtime.releaseObjectGroup') {
        if (options.release === 'hang') return new Promise(() => undefined);
        return options.release === 'timeout'
          ? Promise.reject(timedOut(method))
          : Promise.resolve({});
      }
      if (method === 'DOM.resolveNode') {
        return options.gone
          ? Promise.reject(new Error(UNKNOWN_NODE_ERROR))
          : Promise.resolve({ object: { type: 'object', objectId: 'o1' } });
      }
      if (method === 'Runtime.callFunctionOn' && options.selectionFails) {
        return Promise.reject(timedOut(method));
      }
      if (method === 'Runtime.callFunctionOn') {
        return Promise.reject(new Error('Execution context was destroyed.'));
      }
      return Promise.resolve({});
    },
  });
  return calls;
}

/**
 * The exit code a call failed with.
 *
 * @param call - The call
 * @returns Its CommandError's exit code, or undefined when it succeeded
 */
async function exitCodeOf(call: Promise<unknown>): Promise<number | undefined> {
  try {
    await call;
    return undefined;
  } catch (error) {
    assert.ok(error instanceof CommandError, `not a CommandError: ${String(error)}`);
    return error.exitCode;
  }
}

void describe('object group release (#606)', () => {
  const sessionDir = process.env['BDG_SESSION_DIR'];

  before(() => {
    process.env['BDG_SESSION_DIR'] = makeTempDir('bdg-606-');
  });

  afterEach(async () => {
    await daemon?.close();
    daemon = undefined;
  });

  after(() => {
    if (sessionDir === undefined) delete process.env['BDG_SESSION_DIR'];
    else process.env['BDG_SESSION_DIR'] = sessionDir;
    removeTempDirs();
  });

  void it('keeps the 110 of a failed node check when the release times out', async () => {
    await serve({ release: 'timeout' });
    assert.equal(await exitCodeOf(assertNodeAttached(1)), EXIT_CODES.SOFTWARE_ERROR);
  });

  void it('keeps the 87 of a stale index when the release times out', async () => {
    await serve({ gone: true, release: 'timeout' });
    assert.equal(await exitCodeOf(assertNodeAttached(1)), EXIT_CODES.STALE_CACHE);
  });

  void it('is not stalled by a page that never answers the release', async () => {
    await serve({ gone: true, release: 'hang' });
    const code = await raceTimeout(exitCodeOf(assertNodeAttached(1)), STALL_LIMIT_MS, {
      onTimeout: () => assert.fail('the release stalled the command'),
    });
    assert.equal(code, EXIT_CODES.STALE_CACHE);
  });

  void it('releases the selection group when the query that creates it fails', async () => {
    const calls = await serve({ release: 'ok', selectionFails: true });
    assert.equal(await exitCodeOf(queryDOMElements('a')), EXIT_CODES.CDP_TIMEOUT);
    const created = calls.find(
      (call) => call.method === 'Runtime.callFunctionOn' && call.params['objectGroup']
    )?.params['objectGroup'];
    assert.equal(typeof created, 'string');
    const released = calls
      .filter((call) => call.method === 'Runtime.releaseObjectGroup')
      .map((call) => call.params['objectGroup']);
    assert.deepEqual(released, [created], 'the selection group was left in the page');
  });
});
