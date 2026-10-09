/**
 * Daemon-side screenshots on a fake CDP connection: every emulation change a
 * capture makes is put back, also when the capture fails, and Chrome's error
 * is the one reported.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPProtocolError } from '@/connection/errors.js';
import { CommandError } from '@/errors/index.js';
import { takeScreenshot } from '@/runtime/page/screenshot.js';

/** Viewport of the fake page, in CSS px */
const VIEW = { clientWidth: 1905, clientHeight: 1000, pageX: 0, pageY: 0 };

/** Element of the fake page: 400×3000 at (750, 100), taller than the viewport */
const TALL_BORDER = [750, 100, 1150, 100, 1150, 3100, 750, 3100];

/** A one-pixel PNG header, base64 */
const IMAGE = 'iVBORw0KGgo=';

/** How the fake page behaves */
interface FakePageOptions {
  /** Page's pixel ratio (default 1) */
  pixelRatio?: number;
  /** Error the capture fails with */
  captureError?: Error;
  /** Recorded command (as in `sent`) that fails */
  refuse?: string;
  /** Page scripts never finish: the capture waits until they are terminated, then fails */
  busy?: boolean;
}

/** Chrome's answer to a capture whose page scripts were terminated */
const TERMINATED = new CDPProtocolError('Execution was terminated', -32000, undefined);

/**
 * A page connection answering what a capture asks, recording the
 * emulation-related commands it is sent.
 *
 * @param options - How the page behaves
 * @returns Connection and the commands sent (method, and `hidden` or `deviceScaleFactor`)
 */
function fakePage(options: FakePageOptions = {}): { cdp: CDPConnection; sent: string[] } {
  const sent: string[] = [];
  let terminate: () => void = () => undefined;
  const terminated = new Promise<void>((resolve) => (terminate = resolve));
  const answers: Record<string, (params: Record<string, unknown>) => unknown> = {
    'Runtime.evaluate': (params) => {
      const expression = String(params['expression']);
      if (expression === '1' && options.busy) return new Promise(() => undefined);
      return {
        result: {
          value: expression.includes('devicePixelRatio') ? (options.pixelRatio ?? 1) : [0, 0],
        },
      };
    },
    'Runtime.terminateExecution': () => terminate(),
    'Page.getLayoutMetrics': () => ({
      contentSize: { x: 0, y: 0, width: 1905, height: 1200 },
      visualViewport: VIEW,
      cssVisualViewport: VIEW,
      cssLayoutViewport: VIEW,
    }),
    'DOM.getBoxModel': () => ({ model: { border: TALL_BORDER } }),
    'DOM.resolveNode': () => ({ object: {} }),
    'Page.captureScreenshot': () => {
      if (options.busy) return terminated.then(() => Promise.reject(TERMINATED));
      if (options.captureError) throw options.captureError;
      return { data: IMAGE };
    },
  };
  const cdp = {
    send: (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      const label = describeCall(method, params);
      if (label) sent.push(label);
      if (label !== undefined && label === options.refuse) {
        return Promise.reject(new CDPProtocolError(`${method} refused`, -32000, undefined));
      }
      return Promise.resolve().then(() => answers[method]?.(params) ?? {});
    },
  } as unknown as CDPConnection;
  return { cdp, sent };
}

/**
 * How a test records a command: emulation commands with their `hidden` or
 * `deviceScaleFactor`, the capture and script termination.
 *
 * @param method - CDP method
 * @param params - Its parameters
 * @returns Label, or undefined for commands not recorded
 */
function describeCall(method: string, params: Record<string, unknown>): string | undefined {
  const recorded =
    method.startsWith('Emulation.') ||
    method === 'Page.captureScreenshot' ||
    method === 'Runtime.terminateExecution';
  if (!recorded) return undefined;
  const detail = params['hidden'] ?? params['deviceScaleFactor'];
  const shown = typeof detail === 'boolean' || typeof detail === 'number' ? detail : undefined;
  return shown === undefined ? method : `${method} ${String(shown)}`;
}

/**
 * The session viewport getter of a session without emulation.
 *
 * @returns No viewport
 */
const noViewport = (): undefined => undefined;

void describe('takeScreenshot', () => {
  void it('shows the scrollbars and clears the override after an element capture beyond the viewport', async () => {
    const { cdp, sent } = fakePage();
    const shot = await takeScreenshot(cdp, { format: 'png', backendNodeId: 7 }, noViewport);
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
      takeScreenshot(cdp, { format: 'png', backendNodeId: 7 }, noViewport),
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
    await takeScreenshot(cdp, { format: 'png', fullPage: false }, () => phone);
    assert.deepEqual(sent, [
      'Emulation.setDeviceMetricsOverride 1',
      'Page.captureScreenshot',
      'Emulation.setDeviceMetricsOverride 3',
      'Emulation.setTouchEmulationEnabled',
    ]);
  });

  void it('changes nothing for a page capture at pixel ratio 1', async () => {
    const { cdp, sent } = fakePage();
    const shot = await takeScreenshot(cdp, { format: 'jpeg' }, noViewport);
    assert.deepEqual(sent, ['Page.captureScreenshot']);
    assert.equal(shot.screenshot.quality, 90);
    assert.equal(shot.screenshot.size, 8);
  });

  void it('reports the capture’s error and runs every restore step when one of them fails', async () => {
    const refused = new CDPProtocolError('Unable to capture screenshot', -32000, undefined);
    const { cdp, sent } = fakePage({
      captureError: refused,
      refuse: 'Emulation.setScrollbarsHidden false',
    });
    await assert.rejects(
      takeScreenshot(cdp, { format: 'png', backendNodeId: 7 }, noViewport),
      (error) => error === refused
    );
    assert.deepEqual(sent.slice(-2), [
      'Emulation.setScrollbarsHidden false',
      'Emulation.clearDeviceMetricsOverride',
    ]);
  });

  void it('reports a failed restore step after a capture that worked, once every step ran', async () => {
    const { cdp, sent } = fakePage({ refuse: 'Emulation.setScrollbarsHidden false' });
    await assert.rejects(
      takeScreenshot(cdp, { format: 'png', backendNodeId: 7 }, noViewport),
      /Emulation.setScrollbarsHidden refused/
    );
    assert.equal(sent.at(-1), 'Emulation.clearDeviceMetricsOverride');
  });

  void it('puts back the viewport the session has when the capture ends, not when it started', async () => {
    const { cdp, sent } = fakePage();
    let viewport: { width: number; height: number } | undefined;
    const shot = takeScreenshot(cdp, { format: 'png', backendNodeId: 7 }, () => viewport);
    viewport = { width: 800, height: 600 };
    await shot;
    assert.equal(sent.at(-1), 'Emulation.setDeviceMetricsOverride 0');
  });

  void it('skips the capture of a client that left, and still puts the emulation back', async () => {
    const { cdp, sent } = fakePage({ pixelRatio: 3 });
    const abandoned = new AbortController();
    const shot = takeScreenshot(cdp, { format: 'png', fullPage: false }, noViewport, {
      abandoned: abandoned.signal,
    });
    abandoned.abort();
    await assert.rejects(shot);
    assert.ok(!sent.includes('Page.captureScreenshot'), sent.join(', '));
    assert.equal(sent.at(-1), 'Emulation.clearDeviceMetricsOverride');
  });

  void it('answers a busy page with 102 only after the emulation is back', async () => {
    const { cdp, sent } = fakePage({ busy: true });
    await assert.rejects(
      takeScreenshot(cdp, { format: 'png', backendNodeId: 7 }, noViewport, {
        recovery: { busyAfterMs: 30, livenessMs: 30 },
      }),
      (error) => error instanceof CommandError && error.exitCode === 102
    );
    assert.deepEqual(sent.slice(-3), [
      'Runtime.terminateExecution',
      'Emulation.setScrollbarsHidden false',
      'Emulation.clearDeviceMetricsOverride',
    ]);
  });
});
