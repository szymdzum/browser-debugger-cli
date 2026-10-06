/**
 * Renderer crash tracking: a crash is recorded, a reload or main-frame
 * navigation clears it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { pageCrashedCommandError, startCrashTracking } from '@/telemetry/pageCrash.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** CDP connection mock that records commands and emits events. */
class MockCDP {
  readonly sent: string[] = [];
  private handlers = new Map<string, Array<(params: unknown) => void>>();

  /**
   * Record a command.
   *
   * @param method - CDP method
   * @returns Empty result
   */
  send(method: string): Promise<unknown> {
    this.sent.push(method);
    return Promise.resolve({});
  }

  /**
   * Subscribe to an event.
   *
   * @param event - CDP event
   * @param handler - Handler
   * @returns Unsubscribe function
   */
  on(event: string, handler: (params: unknown) => void): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return () => list.splice(list.indexOf(handler), 1);
  }

  /**
   * Emit an event.
   *
   * @param event - CDP event
   * @param params - Event params
   */
  emit(event: string, params: unknown = {}): void {
    this.handlers.get(event)?.forEach((handler) => handler(params));
  }
}

void describe('startCrashTracking', () => {
  void it('records a crash and clears it when the page loads again', async () => {
    const cdp = new MockCDP();
    const changes: Array<number | undefined> = [];
    const stop = await startCrashTracking(cdp as unknown as CDPConnection, (crashedAt) =>
      changes.push(crashedAt)
    );
    assert.deepEqual(cdp.sent, ['Inspector.enable']);

    cdp.emit('Inspector.targetCrashed');
    assert.equal(typeof changes[0], 'number');
    cdp.emit('Page.frameNavigated', { frame: { id: 'child', parentId: 'main', url: 'x' } });
    assert.equal(changes.length, 1, 'an iframe navigation does not count');
    cdp.emit('Page.frameNavigated', { frame: { id: 'main', url: 'x' } });
    cdp.emit('Inspector.targetReloadedAfterCrash');
    assert.deepEqual(changes.slice(1), [undefined, undefined]);

    stop();
    cdp.emit('Inspector.targetCrashed');
    assert.equal(changes.length, 3);
  });

  void it('fails page commands with exit 107 and the way back', () => {
    const error = pageCrashedCommandError(Date.now());
    assert.equal(error.exitCode, EXIT_CODES.PAGE_CRASHED);
    assert.match(error.message, /The page crashed at .+ \(its renderer is gone\)/);
    assert.match(String(error.metadata['suggestion']), /bdg page reload/);
  });
});
