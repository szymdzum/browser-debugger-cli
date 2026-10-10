/**
 * A mouse click whose press never reached the target (e.g. a browser bubble
 * captured the input) is reported with a warning instead of plain success,
 * or refused with `strict`, as is an element the mouse cannot reach.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import { clickElement, pressReachedTarget } from '@/runtime/dom/formFillHelpers/fill.js';
import { CLICK_NOT_RECEIVED_WARNING } from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

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
 * @param probe - Whether the press probe saw the press arrive (or what it evaluates to), or an error to throw
 * @param failingEvent - Mouse event type whose dispatch fails, if any
 * @param located - What the locate script evaluates to
 * @returns Connection and the methods/expressions it was sent, in order
 */
function fakeCdp(
  probe: unknown,
  failingEvent?: string,
  located: Record<string, unknown> = LOCATED
): { cdp: CDPConnection; sent: string[] } {
  const sent: string[] = [];
  const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const expression = typeof params['expression'] === 'string' ? params['expression'] : '';
    if (method === 'Input.dispatchMouseEvent') {
      sent.push(String(params['type']));
      if (params['type'] === failingEvent) return Promise.reject(new Error('dispatch failed'));
      return Promise.resolve({});
    }
    if (expression.includes('allMatches')) return Promise.resolve({ result: { value: located } });
    if (expression.includes('__bdgClickTarget') && !expression.startsWith('delete')) {
      sent.push('dom-fallback');
      return Promise.resolve({ result: { value: true } });
    }
    if (expression.includes('__bdgPressProbe')) {
      sent.push('probe');
      if (probe instanceof Error) return Promise.reject(probe);
      const value = typeof probe === 'boolean' ? { reached: probe } : probe;
      return Promise.resolve({ result: { value } });
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

  void it('names where the press landed when the page saw it elsewhere', async () => {
    const result = await clickElement(
      fakeCdp({ reached: false, landedOn: 'div#overlay' }).cdp,
      'a'
    );
    assert.equal(
      result.warning,
      'The click may not have reached the element: the press landed on div#overlay'
    );
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

void describe('clickElement --strict', () => {
  const covered = {
    ...LOCATED,
    element: 'button#save "Save"',
    hittable: false,
    obstruction: 'covered by another element (div#shield)',
  };

  /**
   * The error a promise rejects with.
   *
   * @param promise - Promise expected to reject
   * @returns The CommandError
   */
  async function refusal(promise: Promise<unknown>): Promise<CommandError> {
    const error = await promise.then(
      () => undefined,
      (reason: unknown) => reason
    );
    assert.ok(error instanceof CommandError, String(error));
    return error;
  }

  void it('refuses a covered element with exit 90, naming what covers it', async () => {
    const { cdp, sent } = fakeCdp(true, undefined, covered);
    const error = await refusal(clickElement(cdp, 'a', { strict: true }));
    assert.equal(error.exitCode, EXIT_CODES.RESOURCE_CONFLICT);
    assert.match(
      error.message,
      /^Did not click button#save "Save": it is covered by another element \(div#shield\)/
    );
    assert.match(error.metadata.suggestion ?? '', /bdg dom layout 'a'/);
    assert.deepEqual(sent, [], 'neither mouse nor DOM events');
  });

  void it('falls back to DOM events without it', async () => {
    const { cdp, sent } = fakeCdp(true, undefined, covered);
    const result = await clickElement(cdp, 'a');
    assert.equal(result.method, 'dom');
    assert.deepEqual(sent, ['dom-fallback']);
  });

  void it('refuses a hover the same way', async () => {
    const { cdp } = fakeCdp(true, undefined, covered);
    const error = await refusal(clickElement(cdp, 'a', { action: 'hover', strict: true }));
    assert.match(error.message, /^Did not hover /);
  });

  void it('refuses a press that never arrived, releasing it but pressing no more', async () => {
    const { cdp, sent } = fakeCdp(false);
    const error = await refusal(clickElement(cdp, 'a', { action: 'double', strict: true }));
    assert.equal(error.exitCode, EXIT_CODES.RESOURCE_CONFLICT);
    assert.match(
      error.message,
      /the press did not reach the element \(it was sent, but the page saw no press: the browser may be showing a dialog or bubble/
    );
    assert.deepEqual(sent, ['mouseMoved', 'mousePressed', 'probe', 'mouseReleased']);
  });

  void it('names where a missed press landed', async () => {
    const { cdp } = fakeCdp({ reached: false, landedOn: 'div#overlay' });
    const error = await refusal(clickElement(cdp, 'a', { strict: true }));
    assert.match(
      error.message,
      /^Did not click a: the press did not reach the element \(it was sent, but landed on div#overlay\) \(--strict\)$/
    );
  });
});
