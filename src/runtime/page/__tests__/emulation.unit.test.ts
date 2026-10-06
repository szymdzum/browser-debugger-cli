/**
 * `bdg page emulate` on a fake CDP connection: what is sent, and what the
 * session records when Chrome refuses a step.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { emulatePage, type SessionEmulation } from '@/runtime/page/emulation.js';

/**
 * A connection that records calls and fails the given method.
 *
 * @param failing - Method that throws
 * @returns Connection and the methods it was sent
 */
function fakeCdp(failing?: string): { cdp: CDPConnection; sent: string[] } {
  const sent: string[] = [];
  const cdp = {
    send: (method: string): Promise<unknown> => {
      sent.push(method);
      return method === failing ? Promise.reject(new Error('refused')) : Promise.resolve({});
    },
  } as unknown as CDPConnection;
  return { cdp, sent };
}

void describe('emulatePage', () => {
  void it('sets what is given and keeps the rest', async () => {
    const { cdp, sent } = fakeCdp();
    const records: SessionEmulation[] = [];
    const result = await emulatePage(
      cdp,
      { viewport: { width: 1280, height: 800 } },
      { colorScheme: 'dark' },
      (emulation) => records.push(emulation)
    );
    assert.deepEqual(sent, ['Emulation.setEmulatedMedia']);
    assert.deepEqual(result, { viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  });

  void it('clears both on reset', async () => {
    const { cdp, sent } = fakeCdp();
    const result = await emulatePage(
      cdp,
      { viewport: { width: 900, height: 700 }, colorScheme: 'light' },
      { reset: true },
      () => undefined
    );
    assert.deepEqual(sent, ['Emulation.clearDeviceMetricsOverride', 'Emulation.setEmulatedMedia']);
    assert.deepEqual(result, {});
  });

  void it('records the steps Chrome accepted before one it refused', async () => {
    const { cdp } = fakeCdp('Emulation.setEmulatedMedia');
    const records: SessionEmulation[] = [];
    await assert.rejects(
      emulatePage(
        cdp,
        {},
        { viewport: { width: 900, height: 700 }, colorScheme: 'dark' },
        (emulation) => records.push(emulation)
      )
    );
    assert.deepEqual(records, [{ viewport: { width: 900, height: 700 } }]);
  });
});
