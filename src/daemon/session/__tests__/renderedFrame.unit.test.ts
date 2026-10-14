/**
 * An attached tab Chrome renders no frame of (in the background) refuses a
 * screenshot at once with 85 instead of hanging (#473 review 3), and bdg
 * never brings the tab to the front.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { assertTabRendered } from '@/daemon/session/renderedFrame.js';
import { CommandError } from '@/errors/index.js';

/**
 * A page connection whose animation frame comes or never comes.
 *
 * @param renders - Whether the tab renders
 * @returns The connection and the methods sent
 */
function page(renders: boolean): { cdp: CDPConnection; sent: string[] } {
  const sent: string[] = [];
  const cdp = {
    send: (method: string) => {
      sent.push(method);
      return renders ? Promise.resolve({ result: { value: true } }) : new Promise(() => undefined);
    },
  } as unknown as CDPConnection;
  return { cdp, sent };
}

void describe('assertTabRendered', () => {
  void it('passes when the tab renders a frame', async () => {
    const { cdp, sent } = page(true);
    await assertTabRendered(cdp, 50);
    assert.deepEqual(sent, ['Runtime.evaluate']);
  });

  void it('exits 85 when no frame comes, without bringing the tab to the front', async () => {
    const { cdp, sent } = page(false);
    const began = Date.now();
    await assert.rejects(assertTabRendered(cdp, 50), (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.exitCode, 85);
      assert.equal(error.message, 'The attached tab is not rendering (in the background, or busy)');
      assert.equal(
        error.metadata.suggestion,
        'Bring the tab to the front in Chrome, or wait until the page is idle, then run the command again'
      );
      return true;
    });
    assert.ok(Date.now() - began < 1000);
    assert.deepEqual(sent, ['Runtime.evaluate']);
  });
});
