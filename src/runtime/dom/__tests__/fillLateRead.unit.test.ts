/**
 * The late read's page function of `dom fill` (#892) keeps the check the
 * fill left only after a value judged replaced, for the read 500 ms later
 * that bdg waits for itself (#940), and that read removes it.
 *
 * The page function runs here in an isolated VM context on field-like
 * objects, with the check the fill leaves on `window`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { FILL_LATE_READ_FUNCTION } from '@/runtime/dom/reactEventHelpers.js';

/** The page's `window`, holding the fill's check or not */
type PageWindow = { __bdgFillCheck?: unknown };

/**
 * Run the late read on a text field holding `value`, filled with `Jane Smith` over a blank.
 *
 * @param value - What the field holds now
 * @param reread - Whether it is the read after a value judged replaced
 * @param window - The page's window; a fresh one with the check (token `t1`) by default
 * @param token - Check token the read passes
 * @returns What it evaluates to (copied out of the VM realm) and the window
 */
async function lateRead(
  value: string,
  reread: boolean,
  window?: PageWindow,
  token = 't1'
): Promise<{ read: Record<string, unknown> | null; window: PageWindow; droppedAtOnce: boolean }> {
  const el = { isConnected: true, localName: 'input', type: 'text', value };
  const page = window ?? {
    __bdgFillCheck: { el, expected: 'Jane Smith', before: new Map([[el, '']]), token: 't1' },
  };
  const pending = vm.runInNewContext(`(${FILL_LATE_READ_FUNCTION})('#f', null, 0, reread, token)`, {
    window: page,
    MessageChannel,
    reread,
    token,
  }) as Promise<Record<string, unknown> | null> | null;
  const droppedAtOnce = !('__bdgFillCheck' in page);
  const read = await pending;
  const copied = read && (JSON.parse(JSON.stringify(read)) as Record<string, unknown>);
  return { read: copied, window: page, droppedAtOnce };
}

void describe('FILL_LATE_READ_FUNCTION and the read after a replaced value (#940)', () => {
  void it('keeps the check after a value judged replaced', async () => {
    const { read, window } = await lateRead('draft-9f3ac2', false);
    assert.equal(read?.['replaced'], true);
    assert.equal(read?.['actual'], 'draft-9f3ac2');
    assert.ok('__bdgFillCheck' in window);
  });

  void it('removes the check after any other verdict', async () => {
    for (const value of ['Jane Smith', 'JANE SMITH', '']) {
      const { window } = await lateRead(value, false);
      assert.ok(!('__bdgFillCheck' in window), value);
    }
  });

  void it('the read again removes the check at once and judges the field', async () => {
    const replaced = await lateRead('draft-9f3ac2', true);
    assert.equal(replaced.read?.['replaced'], true);
    assert.ok(replaced.droppedAtOnce);
    const streamed = await lateRead('Jane Smith-Kowalska', true);
    assert.deepEqual(streamed.read, { pageValue: 'Jane Smith-Kowalska' });
  });

  void it('the read again says the field kept the value, and null without a check', async () => {
    assert.deepEqual((await lateRead('Jane Smith', true)).read, { kept: true });
    assert.equal((await lateRead('Jane Smith', true, {})).read, null);
  });

  void it("neither read reads nor removes another fill's check", async () => {
    for (const reread of [false, true]) {
      const { read, window } = await lateRead('draft-9f3ac2', reread, undefined, 't2');
      assert.equal(read, null);
      assert.ok('__bdgFillCheck' in window);
    }
  });
});
