/**
 * Child targets (cross-origin iframes, workers) are set up by every collector
 * and always resumed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { attachChildTargets } from '@/telemetry/attachedTargets.js';

/**
 * CDP mock whose `Target.setAutoAttach` on the page reports children that
 * already exist before answering, as Chrome does.
 */
class MockCDP {
  readonly sent: Array<{ method: string; params: unknown; sessionId?: string | undefined }> = [];
  private handlers = new Map<string, Array<(params: unknown, sessionId?: string) => void>>();

  /**
   * @param existingChildren - Session ids of children attached at start
   */
  constructor(private readonly existingChildren: string[] = []) {}

  /**
   * Record a command; announce existing children on the first auto-attach.
   *
   * @param method - CDP method
   * @param params - Parameters
   * @param sessionId - Target session
   * @returns Empty result
   */
  send(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
    this.sent.push({ method, params, sessionId });
    if (method === 'Target.setAutoAttach' && sessionId === undefined) {
      for (const child of this.existingChildren.splice(0)) this.attach(child);
    }
    return Promise.resolve({});
  }

  /**
   * Subscribe to an event.
   *
   * @param event - Event name
   * @param handler - Handler
   * @returns Unsubscribe function
   */
  on(event: string, handler: (params: unknown, sessionId?: string) => void): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return () => list.splice(list.indexOf(handler), 1);
  }

  /**
   * Announce an attached child.
   *
   * @param sessionId - Child session
   */
  attach(sessionId: string): void {
    const params = { sessionId, targetInfo: { url: `https://${sessionId}.test/` } };
    this.handlers.get('Target.attachedToTarget')?.forEach((handler) => handler(params));
  }

  /**
   * Methods sent to a session, in order.
   *
   * @param sessionId - Session
   * @returns Method names
   */
  methodsFor(sessionId: string): string[] {
    return this.sent.filter((call) => call.sessionId === sessionId).map((call) => call.method);
  }
}

/** Let pending setup and resume promises settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

void describe('attachChildTargets', () => {
  void it('sets up and resumes children that exist when collection starts', async () => {
    const cdp = new MockCDP(['frame-1']);
    await attachChildTargets(cdp as unknown as CDPConnection, async (sessionId) => {
      await cdp.send('Runtime.enable', {}, sessionId);
    });
    await flush();

    assert.deepEqual(cdp.methodsFor('frame-1'), [
      'Runtime.enable',
      'Target.setAutoAttach',
      'Runtime.runIfWaitingForDebugger',
    ]);
  });

  void it('resumes a child even when a setup fails', async () => {
    const cdp = new MockCDP();
    await attachChildTargets(cdp as unknown as CDPConnection, () =>
      Promise.reject(new Error('domain not available'))
    );
    cdp.attach('worker-1');
    await flush();

    assert.equal(cdp.methodsFor('worker-1').at(-1), 'Runtime.runIfWaitingForDebugger');
  });

  void it('runs a later collector’s setup on children already attached', async () => {
    const cdp = new MockCDP(['frame-1']);
    await attachChildTargets(cdp as unknown as CDPConnection, async (sessionId) => {
      await cdp.send('Runtime.enable', {}, sessionId);
    });
    await attachChildTargets(cdp as unknown as CDPConnection, async (sessionId) => {
      await cdp.send('Network.enable', {}, sessionId);
    });
    await flush();

    assert.ok(cdp.methodsFor('frame-1').includes('Network.enable'));
    assert.equal(
      cdp.sent.filter((call) => call.method === 'Target.setAutoAttach' && !call.sessionId).length,
      1,
      'auto-attach is started once per connection'
    );
  });

  void it('turns auto-attach off when the last collector stops', async () => {
    const cdp = new MockCDP();
    const stopConsole = await attachChildTargets(cdp as unknown as CDPConnection, () =>
      Promise.resolve()
    );
    const stopNetwork = await attachChildTargets(cdp as unknown as CDPConnection, () =>
      Promise.resolve()
    );
    const pageAutoAttach = (): unknown[] =>
      cdp.sent
        .filter((call) => call.method === 'Target.setAutoAttach' && !call.sessionId)
        .map((call) => (call.params as { autoAttach: boolean }).autoAttach);

    await stopConsole();
    assert.deepEqual(pageAutoAttach(), [true]);
    await stopNetwork();
    assert.deepEqual(pageAutoAttach(), [true, false]);
  });
});
