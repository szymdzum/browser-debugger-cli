/**
 * Interactions run one at a time and report the dialogs they caused.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { createInteractionRunner } from '@/daemon/session/interactions.js';

/** What the stub's page scripts evaluate to */
interface PageReplies {
  /** Snapshot before the action */
  start?: unknown;
  /** Read after the action */
  read?: unknown;
}

/**
 * CDP stub recording page scripts; the effect snapshots evaluate to the
 * given replies (to nothing by default).
 *
 * @param replies - Values of the effect scripts
 * @returns Stub
 */
function fakeCdp(replies: PageReplies = {}): CDPConnection & { expressions: string[] } {
  const expressions: string[] = [];
  const valueOf = (expression: string): unknown => {
    if (expression.includes('new MutationObserver')) return replies.start;
    if (expression.includes('const scrolled')) return replies.read;
    return undefined;
  };
  return {
    expressions,
    send: (_method: string, params?: { expression?: string }) => {
      if (!params?.expression) return Promise.resolve({});
      expressions.push(params.expression);
      return Promise.resolve({ result: { value: valueOf(params.expression) } });
    },
    on: () => () => undefined,
  } as unknown as CDPConnection & { expressions: string[] };
}

/**
 * Resolve after a macrotask turn.
 *
 * @param ms - Delay in milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void describe('createInteractionRunner', () => {
  void it('runs a second interaction only after the first finished', async () => {
    const interact = createInteractionRunner(new TelemetryStore());
    const cdp = fakeCdp();
    const order: string[] = [];

    await Promise.all([
      interact(cdp, async () => {
        order.push('first:start');
        await delay(20);
        order.push('first:end');
        return { success: true };
      }),
      interact(cdp, () => {
        order.push('second:start');
        return Promise.resolve({ success: true });
      }),
    ]);

    assert.deepEqual(order, ['first:start', 'first:end', 'second:start']);
  });

  void it('keeps running after a failed interaction', async () => {
    const interact = createInteractionRunner(new TelemetryStore());
    const cdp = fakeCdp();

    await assert.rejects(interact(cdp, () => Promise.reject(new Error('boom'))));
    assert.deepEqual(await interact(cdp, () => Promise.resolve({ success: true })), {
      success: true,
    });
  });

  void it('adds the dialogs opened during the interaction and unbinds the target', async () => {
    const store = new TelemetryStore();
    store.recordDialog({ type: 'alert', message: 'before' });
    const interact = createInteractionRunner(store);
    const cdp = fakeCdp();

    const result = await interact(cdp, () => {
      store.recordDialog({ type: 'confirm', message: 'Sure?' });
      return Promise.resolve({ success: true });
    });

    assert.deepEqual(result.dialogs, [{ type: 'confirm', message: 'Sure?' }]);
    assert.ok(cdp.expressions.includes('delete window.__bdgTarget'));
  });

  void it('adds the URL change and the messages that appeared', async () => {
    const interact = createInteractionRunner(new TelemetryStore());
    const cdp = fakeCdp({
      start: { href: 'https://todo.test/#/', messages: [] },
      read: {
        href: 'https://todo.test/#/active',
        fresh: false,
        changes: 3,
        messages: [{ id: 1, text: 'Saved', element: 'div.toast' }],
      },
    });

    const result = await interact(cdp, () => Promise.resolve({ success: true }));

    assert.deepEqual(result.navigation, { url: 'https://todo.test/#/active', sameDocument: true });
    assert.deepEqual(result.messages, [{ text: 'Saved', element: 'div.toast' }]);
    assert.equal(result.effect, undefined);
  });

  void it('reports no effect only when asked to and nothing changed', async () => {
    const quiet = {
      start: { href: 'https://shop.test/', messages: [] },
      read: { href: 'https://shop.test/', fresh: false, changes: 0, messages: [] },
    };
    const interact = createInteractionRunner(new TelemetryStore());
    const action = (): Promise<{ success: boolean }> => Promise.resolve({ success: true });

    const detected = await interact(fakeCdp(quiet), action, { detectNoEffect: true });
    assert.equal(detected.effect, 'none');
    assert.equal((await interact(fakeCdp(quiet), action)).effect, undefined);
    const failed = await interact(fakeCdp(quiet), () => Promise.resolve({ success: false }), {
      detectNoEffect: true,
    });
    assert.equal(failed.effect, undefined);
  });

  void it('says the page was still changing only when asked to', async () => {
    const waiting = {
      start: { href: 'https://shop.test/', messages: [] },
      read: {
        href: 'https://shop.test/',
        fresh: false,
        changes: 0,
        messages: [],
        settle: { burstAges: [], timers: 1, loading: null },
      },
    };
    const interact = createInteractionRunner(new TelemetryStore());
    const action = (): Promise<{ success: boolean }> => Promise.resolve({ success: true });

    const detected = await interact(fakeCdp(waiting), action, { detectUnsettled: true });
    assert.equal(detected.settled, false);
    assert.deepEqual(detected.pending, { timers: 1 });
    const plain = await interact(fakeCdp(waiting), action);
    assert.equal(plain.settled, undefined);
    assert.equal('work' in plain, false, 'the page work stays internal');
  });

  void it('reports nothing when effects are off or the page could not be read', async () => {
    const interact = createInteractionRunner(new TelemetryStore());
    const action = (): Promise<{ success: boolean }> => Promise.resolve({ success: true });

    const off = fakeCdp({ start: { href: 'a', messages: [] } });
    assert.deepEqual(await interact(off, action, { reportEffects: false }), { success: true });
    assert.ok(!off.expressions.some((expression) => expression.includes('MutationObserver')));
    assert.deepEqual(await interact(fakeCdp(), action, { detectNoEffect: true }), {
      success: true,
    });
  });
});

void describe('TelemetryStore.recordDialog', () => {
  void it('also lists the dialog among console messages', () => {
    const store = new TelemetryStore();
    store.activeTelemetry = ['console'];
    store.recordDialog({ type: 'alert', message: 'Saved' });
    assert.equal(store.consoleMessages[0]?.text, 'alert() dialog accepted: "Saved"');
  });

  void it('leaves console messages alone when console telemetry is off', () => {
    const store = new TelemetryStore();
    store.recordDialog({ type: 'alert', message: 'Saved' });
    assert.equal(store.consoleMessages.length, 0);
    assert.equal(store.dialogs.length, 1);
  });
});
