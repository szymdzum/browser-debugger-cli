/**
 * A mouse click whose press never reached the target (e.g. a browser bubble
 * captured the input) is reported with a warning instead of plain success.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { clickElement, pressReachedTarget } from '@/runtime/dom/formFillHelpers/fill.js';
import { CLICK_NOT_RECEIVED_WARNING } from '@/ui/messages/commands.js';

/** Located, hittable click target as returned by the locate script */
const LOCATED = {
  success: true,
  selector: 'a',
  elementType: 'a',
  matchCount: 1,
  x: 10,
  y: 20,
  hittable: true,
  obstruction: null,
};

/**
 * Fake CDP connection answering the locate script and the press probe.
 *
 * @param probe - What reading the press probe evaluates to, or an error to throw
 * @param failingEvent - Mouse event type whose dispatch fails, if any
 * @returns Connection and the methods/expressions it was sent, in order
 */
function fakeCdp(probe: unknown, failingEvent?: string): { cdp: CDPConnection; sent: string[] } {
  const sent: string[] = [];
  const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const expression = typeof params['expression'] === 'string' ? params['expression'] : '';
    if (method === 'Input.dispatchMouseEvent') {
      sent.push(String(params['type']));
      if (params['type'] === failingEvent) return Promise.reject(new Error('dispatch failed'));
      return Promise.resolve({});
    }
    if (expression.includes('allMatches')) return Promise.resolve({ result: { value: LOCATED } });
    if (expression.includes('__bdgPressProbe')) {
      sent.push('probe');
      if (probe instanceof Error) return Promise.reject(probe);
      return Promise.resolve({ result: { value: probe } });
    }
    return Promise.resolve({});
  };
  return { cdp: { send } as unknown as CDPConnection, sent };
}

void describe('pressReachedTarget', () => {
  void it('is false only when the probe says the press did not arrive', async () => {
    assert.equal(await pressReachedTarget(fakeCdp(false).cdp), false);
    assert.equal(await pressReachedTarget(fakeCdp(true).cdp), true);
    assert.equal(await pressReachedTarget(fakeCdp(undefined).cdp), true);
    assert.equal(await pressReachedTarget(fakeCdp(new Error('gone')).cdp), true);
  });
});

void describe('clickElement press check', () => {
  void it('warns when the target never received the mouse press', async () => {
    const result = await clickElement(fakeCdp(false).cdp, 'a');
    assert.equal(result.success, true);
    assert.equal(result.warning, CLICK_NOT_RECEIVED_WARNING);
  });

  void it('adds no warning when the press arrived', async () => {
    const result = await clickElement(fakeCdp(true).cdp, 'a');
    assert.equal(result.warning, undefined);
  });

  void it('reads the probe once, right after the first press', async () => {
    const { cdp, sent } = fakeCdp(true);
    await clickElement(cdp, 'a', { action: 'double' });
    assert.deepEqual(sent, [
      'mouseMoved',
      'mousePressed',
      'probe',
      'mouseReleased',
      'mousePressed',
      'mouseReleased',
    ]);
  });

  void it('does not check hovering, which has no press', async () => {
    const { cdp, sent } = fakeCdp(false);
    const result = await clickElement(cdp, 'a', { action: 'hover' });
    assert.deepEqual(sent, ['mouseMoved']);
    assert.equal(result.warning, undefined);
  });

  void it('removes the probe when dispatching fails before the press', async () => {
    const { cdp, sent } = fakeCdp(true, 'mousePressed');
    await assert.rejects(clickElement(cdp, 'a'));
    assert.deepEqual(sent, ['mouseMoved', 'mousePressed', 'probe']);
  });
});
