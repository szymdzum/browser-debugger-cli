/**
 * Interactions run one at a time and report the dialogs they caused.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { createInteractionRunner } from '@/daemon/session/interactions.js';

/** CDP stub recording page scripts. */
function fakeCdp(): CDPConnection & { expressions: string[] } {
  const expressions: string[] = [];
  return {
    expressions,
    send: (_method: string, params?: { expression?: string }) => {
      if (params?.expression) expressions.push(params.expression);
      return Promise.resolve({});
    },
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
