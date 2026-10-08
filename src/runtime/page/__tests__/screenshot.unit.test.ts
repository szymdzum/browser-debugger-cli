/**
 * Daemon-side screenshots on a fake CDP connection: every emulation change a
 * capture makes is put back, also when the capture fails, and Chrome's error
 * is the one reported.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPProtocolError } from '@/connection/errors.js';
import { takeScreenshot } from '@/runtime/page/screenshot.js';

/** Viewport of the fake page, in CSS px */
const VIEW = { clientWidth: 1905, clientHeight: 1000, pageX: 0, pageY: 0 };

/** Element of the fake page: 400×3000 at (750, 100), taller than the viewport */
const TALL_BORDER = [750, 100, 1150, 100, 1150, 3100, 750, 3100];

/** A one-pixel PNG header, base64 */
const IMAGE = 'iVBORw0KGgo=';

/**
 * A page connection answering what a capture asks, recording the
 * emulation-related commands it is sent.
 *
 * @param options - Page's pixel ratio, and the capture's error if it fails
 * @returns Connection and the commands sent (method, and `hidden` or `deviceScaleFactor`)
 */
function fakePage(options: { pixelRatio?: number; captureError?: Error } = {}): {
  cdp: CDPConnection;
  sent: string[];
} {
  const sent: string[] = [];
  const answers: Record<string, (params: Record<string, unknown>) => unknown> = {
    'Runtime.evaluate': (params) => ({
      result: {
        value: String(params['expression']).includes('devicePixelRatio')
          ? (options.pixelRatio ?? 1)
          : [0, 0],
      },
    }),
    'Page.getLayoutMetrics': () => ({
      contentSize: { x: 0, y: 0, width: 1905, height: 1200 },
      visualViewport: VIEW,
      cssVisualViewport: VIEW,
      cssLayoutViewport: VIEW,
    }),
    'DOM.getBoxModel': () => ({ model: { border: TALL_BORDER } }),
    'DOM.resolveNode': () => ({ object: {} }),
    'Page.captureScreenshot': () => {
      if (options.captureError) throw options.captureError;
      return { data: IMAGE };
    },
  };
  const cdp = {
    send: (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      if (method.startsWith('Emulation.') || method === 'Page.captureScreenshot') {
        const detail = params['hidden'] ?? params['deviceScaleFactor'];
        const shown =
          typeof detail === 'boolean' || typeof detail === 'number' ? detail : undefined;
        sent.push(shown === undefined ? method : `${method} ${String(shown)}`);
      }
      return Promise.resolve().then(() => answers[method]?.(params) ?? {});
    },
  } as unknown as CDPConnection;
  return { cdp, sent };
}

void describe('takeScreenshot', () => {
  void it('shows the scrollbars and clears the override after an element capture beyond the viewport', async () => {
    const { cdp, sent } = fakePage();
    const shot = await takeScreenshot(cdp, { format: 'png', backendNodeId: 7 }, undefined);
    assert.equal(shot.image, IMAGE);
    assert.equal(shot.screenshot.element?.bounds.height, 3000);
    assert.deepEqual(sent, [
      'Emulation.setScrollbarsHidden true',
      'Emulation.setDeviceMetricsOverride 1',
      'Page.captureScreenshot',
      'Emulation.setScrollbarsHidden false',
      'Emulation.clearDeviceMetricsOverride',
    ]);
  });

  void it('puts the emulation back and reports Chrome’s error when the capture fails', async () => {
    const refused = new CDPProtocolError('Unable to capture screenshot', -32000, undefined);
    const { cdp, sent } = fakePage({ captureError: refused });
    await assert.rejects(
      takeScreenshot(cdp, { format: 'png', backendNodeId: 7 }, undefined),
      (error) => error === refused
    );
    assert.deepEqual(sent.slice(-2), [
      'Emulation.setScrollbarsHidden false',
      'Emulation.clearDeviceMetricsOverride',
    ]);
  });

  void it('puts a phone session’s viewport and touch back after a page capture at pixel ratio 1', async () => {
    const { cdp, sent } = fakePage({ pixelRatio: 3 });
    const phone = { width: 390, height: 844, mobile: true as const };
    await takeScreenshot(cdp, { format: 'png', fullPage: false }, phone);
    assert.deepEqual(sent, [
      'Emulation.setDeviceMetricsOverride 1',
      'Page.captureScreenshot',
      'Emulation.setDeviceMetricsOverride 3',
      'Emulation.setTouchEmulationEnabled',
    ]);
  });

  void it('changes nothing for a page capture at pixel ratio 1', async () => {
    const { cdp, sent } = fakePage();
    const shot = await takeScreenshot(cdp, { format: 'jpeg' }, undefined);
    assert.deepEqual(sent, ['Page.captureScreenshot']);
    assert.equal(shot.screenshot.quality, 90);
    assert.equal(shot.screenshot.size, 8);
  });
});
