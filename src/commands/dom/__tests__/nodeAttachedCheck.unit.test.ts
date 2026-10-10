/**
 * Whether a node id or cached index still names an element of the page
 * (`dom get --node-id`, indices of `dom query`): concurrent commands do not
 * free each other's page objects (#584), and only a missing element is
 * reported as missing.
 */

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { startFakeDaemon, type FakeDaemon } from '@/__testutils__/fakeDaemon.js';
import { FakeObjectPage, RELEASED_OBJECT_ERROR } from '@/__testutils__/fakeObjectPage.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import { assertNodeAttached, getDOMElements } from '@/commands/dom/helpers/query.js';
import { CommandError } from '@/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

let daemon: FakeDaemon | undefined;

/**
 * Serve a fake page on the session socket for the current test.
 *
 * @param page - The page
 */
async function serve(page: { send: FakeObjectPage['send'] }): Promise<void> {
  daemon = await startFakeDaemon(page);
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

void describe('node attached check', () => {
  const sessionDir = process.env['BDG_SESSION_DIR'];

  before(() => {
    process.env['BDG_SESSION_DIR'] = makeTempDir('bdg-584-');
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

  void it('passes for concurrent checks when one releases its objects before the other reads (#584)', async () => {
    const page = new FakeObjectPage({
      lookupsFirst: 2,
      hold: (method, params) => method === 'DOM.resolveNode' && params['backendNodeId'] === 2,
    });
    await serve(page);
    const checks = await Promise.allSettled([assertNodeAttached(1), assertNodeAttached(2)]);
    assert.deepEqual(
      checks.map((check) => (check.status === 'rejected' ? String(check.reason) : 'attached')),
      ['attached', 'attached'],
      'one check released the other check’s element'
    );
    assert.deepEqual(page.releasedUses, []);
  });

  void it('reads concurrent dom get --node-id calls (#584)', async () => {
    const page = new FakeObjectPage({
      lookupsFirst: 2,
      hold: (method, params) => method === 'DOM.resolveNode' && params['backendNodeId'] === 2,
    });
    await serve(page);
    const reads = await Promise.allSettled([1, 2].map((nodeId) => getDOMElements({ nodeId })));
    assert.deepEqual(
      reads.map((read) =>
        read.status === 'rejected' ? String(read.reason) : read.value.nodes[0]?.nodeId
      ),
      [1, 2],
      'a node id was reported as not in the page'
    );
  });

  void it('does not report an element whose page object was released as missing', async () => {
    await serve({
      send: async (method, params) =>
        method === 'Runtime.callFunctionOn'
          ? Promise.reject(new Error(RELEASED_OBJECT_ERROR))
          : new FakeObjectPage().send(method, params),
    });
    const fromIndex = await exitCodeOf(assertNodeAttached(1));
    assert.notEqual(fromIndex, EXIT_CODES.STALE_CACHE, 'reported as no longer in the page');
    const fromNodeId = await exitCodeOf(getDOMElements({ nodeId: 1 }));
    assert.notEqual(fromNodeId, EXIT_CODES.RESOURCE_NOT_FOUND, 'reported as not in the page');
    assert.notEqual(fromNodeId, undefined);
  });

  void it('reports an element that is not in the page as missing', async () => {
    await serve(new FakeObjectPage({ goneNodes: [1] }));
    assert.equal(await exitCodeOf(assertNodeAttached(1)), EXIT_CODES.STALE_CACHE);
    await assert.rejects(getDOMElements({ nodeId: 1 }), (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
      assert.match(error.message, /No element with node id 1 in the page/);
      return true;
    });
  });

  void it('reports a removed element as missing', async () => {
    await serve(
      new FakeObjectPage({ callResult: () => ({ result: { type: 'boolean', value: false } }) })
    );
    assert.equal(await exitCodeOf(assertNodeAttached(1)), EXIT_CODES.STALE_CACHE);
    assert.equal(await exitCodeOf(getDOMElements({ nodeId: 1 })), EXIT_CODES.RESOURCE_NOT_FOUND);
  });
});
