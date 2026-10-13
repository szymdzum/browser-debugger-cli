/**
 * ResourceStack: LIFO releases, each isolated, idempotent dispose that also
 * releases what an ongoing acquire registers later.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Logger } from '@/ui/logging/index.js';
import { ResourceStack } from '@/utils/resourceStack.js';

/**
 * A stack with a logger that records debug lines.
 *
 * @returns The stack and the recorded lines
 */
function createStack(): { stack: ResourceStack; debug: string[] } {
  const debug: string[] = [];
  const log = { info: () => {}, debug: (line: string) => debug.push(line) } as unknown as Logger;
  return { stack: new ResourceStack(log), debug };
}

void describe('ResourceStack', () => {
  void it('runs the releases last first', async () => {
    const { stack } = createStack();
    const ran: string[] = [];
    for (const name of ['chrome', 'cdp', 'collectors']) stack.defer(() => void ran.push(name), name);
    await stack.dispose();
    assert.deepEqual(ran, ['collectors', 'cdp', 'chrome']);
  });

  void it('runs the other releases when one throws or rejects, logging the failures', async () => {
    const { stack, debug } = createStack();
    const ran: string[] = [];
    stack.defer(() => void ran.push('chrome'), 'chrome');
    stack.defer(() => Promise.reject(new Error('socket gone')), 'cdp');
    stack.defer(() => {
      throw new Error('collector broke');
    }, 'collectors');
    stack.defer(() => void ran.push('page'), 'page');
    await stack.dispose();
    assert.deepEqual(ran, ['page', 'chrome']);
    assert.equal(debug.filter((line) => /collectors.*collector broke/.test(line)).length, 1);
    assert.equal(debug.filter((line) => /cdp.*socket gone/.test(line)).length, 1);
  });

  void it('releases each resource once however often it is disposed', async () => {
    const { stack } = createStack();
    let runs = 0;
    stack.defer(() => void runs++, 'chrome');
    await Promise.all([stack.dispose(), stack.dispose()]);
    await stack.dispose();
    assert.equal(runs, 1);
  });

  void it('releases what an ongoing acquire registers after a dispose began', async () => {
    const { stack } = createStack();
    const ran: string[] = [];
    let finishChromeRelease = (): void => {};
    const chromeReleaseStarted = new Promise<void>((started) => {
      stack.defer(
        () =>
          new Promise<void>((resolve) => {
            finishChromeRelease = () => {
              ran.push('chrome');
              resolve();
            };
            started();
          }),
        'chrome'
      );
    });
    const first = stack.dispose();
    await chromeReleaseStarted;
    stack.defer(() => void ran.push('cdp'), 'cdp');
    finishChromeRelease();
    await first;
    stack.defer(() => void ran.push('collectors'), 'collectors');
    await stack.dispose();
    assert.deepEqual(ran, ['chrome', 'cdp', 'collectors']);
  });

  void it('acquire registers the release of what it acquired', async () => {
    const { stack } = createStack();
    const ran: string[] = [];
    const value = await stack.acquire(
      'cdp',
      new AbortController().signal,
      () => Promise.resolve('connection'),
      (cdp) => void ran.push(`close ${cdp}`)
    );
    assert.equal(value, 'connection');
    await stack.dispose();
    assert.deepEqual(ran, ['close connection']);
  });

  void it('acquire does not start a step once the signal aborted', async () => {
    const { stack } = createStack();
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    let started = false;
    await assert.rejects(
      stack.acquire('chrome', controller.signal, () => {
        started = true;
        return Promise.resolve(1);
      }),
      /stopped/
    );
    assert.equal(started, false);
  });

  void it('acquire keeps the release of a step that finished after the abort, then throws', async () => {
    const { stack } = createStack();
    const controller = new AbortController();
    const ran: string[] = [];
    await assert.rejects(
      stack.acquire(
        'chrome',
        controller.signal,
        () => {
          controller.abort(new Error('stopped'));
          return Promise.resolve('pid 42');
        },
        (chrome) => void ran.push(`kill ${chrome}`)
      ),
      /stopped/
    );
    await stack.dispose();
    assert.deepEqual(ran, ['kill pid 42']);
  });
});
