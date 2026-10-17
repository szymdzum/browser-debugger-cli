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

/** Window size of the fake page (`innerWidth`, `innerHeight`), in CSS px */
const WINDOW = [1920, 1000];

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
  /** The page never sees a metrics change: its window keeps its size */
  fixedWindow?: boolean;
  /** Page script reading the window that throws: its size, or the wait for a resize */
  windowError?: 'size' | 'wait';
  /**
   * Clearing the override, the page first has the size of the override
   * before the last one again (Chrome after an element capture beyond the
   * viewport), and its own size only while a later resize wait runs
   */
  clearPassesThrough?: boolean;
  /**
   * After the capture, the page sees the first metrics change only once the
   * wait for it timed out, and the next one only while a later wait runs
   */
  lateTaller?: boolean;
}

/** A metrics change the fake page has not seen yet, and when it sees it */
interface PendingResize {
  size: number[];
  arrives: 'during-wait' | 'after-timeout';
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
function fakePage(options: FakePageOptions = {}): {
  cdp: CDPConnection;
  sent: string[];
  overrides: Array<Record<string, unknown>>;
  waits: string[];
  windowNow: () => number[];
} {
  const sent: string[] = [];
  const overrides: Array<Record<string, unknown>> = [];
  const waits: string[] = [];
  let window = WINDOW;
  let captured = false;
  let pending: PendingResize[] = [];
  const resize = (size: number[]): void => {
    if (options.fixedWindow) return;
    if (options.lateTaller && captured) {
      pending.push({ size, arrives: pending.length === 0 ? 'after-timeout' : 'during-wait' });
      return;
    }
    window = size;
  };
  const clear = (): void => {
    const previous = overrides.at(-2);
    if (!options.clearPassesThrough || !previous) return resize(WINDOW);
    window = [Number(previous['width']), Number(previous['height'])];
    pending.push({ size: WINDOW, arrives: 'during-wait' });
  };
  /**
   * The page sees the metrics changes that arrive at the given time.
   *
   * @param arrives - When
   */
  const arrive = (arrives: PendingResize['arrives']): void => {
    for (const change of pending.filter((p) => p.arrives === arrives)) window = change.size;
    pending = pending.filter((p) => p.arrives !== arrives);
  };
  /**
   * Answer a page script reading the window's size.
   *
   * @returns Evaluate response
   */
  const readWindow = (): unknown => {
    if (options.windowError === 'size') throw contextDestroyed();
    return { result: { value: window } };
  };
  /**
   * Answer the page function waiting for the window to leave or reach a size
   * (the window's size then, null when it did not happen).
   *
   * @param params - `Runtime.callFunctionOn` parameters: leave, width, height
   * @returns Call response
   */
  const waitForWindow = (params: Record<string, unknown>): unknown => {
    if (options.windowError === 'wait') throw contextDestroyed();
    const args = params['arguments'] as Array<{ value: unknown }>;
    const [leave, width, height] = args.map(({ value }) => value);
    const done = (): boolean => (window[0] === width && window[1] === height) !== leave;
    if (!done()) arrive('during-wait');
    const happened = done();
    const value = happened ? window : null;
    if (!happened) arrive('after-timeout');
    const label = happened ? (leave ? 'resized' : 'reached') : 'timed out';
    waits.push(`${leave ? '' : 'to '}${String(width)}x${String(height)} ${label}`);
    return { result: { value } };
  };
  let terminate: () => void = () => undefined;
  const terminated = new Promise<void>((resolve) => (terminate = resolve));
  const answers: Record<string, (params: Record<string, unknown>) => unknown> = {
    'Runtime.evaluate': (params) => {
      const expression = String(params['expression']);
      if (expression === '1' && options.busy) return new Promise(() => undefined);
      if (expression.includes('devicePixelRatio')) {
        return { result: { value: options.pixelRatio ?? 1 } };
      }
      if (expression.includes('innerWidth')) return readWindow();
      return { result: { value: [0, 0] } };
    },
    'Runtime.callFunctionOn': waitForWindow,
    'DOM.getDocument': () => ({ root: { nodeId: 1 } }),
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
      captured = true;
      if (options.busy) return terminated.then(() => Promise.reject(TERMINATED));
      if (options.captureError) throw options.captureError;
      return { data: IMAGE };
    },
  };
  const cdp = {
    send: (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      const label = describeCall(method, params);
      if (label) sent.push(label);
      if (method === 'Emulation.setDeviceMetricsOverride') {
        overrides.push(params);
        resize([Number(params['width']), Number(params['height'])]);
      }
      if (method === 'Emulation.clearDeviceMetricsOverride') clear();
      if (label !== undefined && label === options.refuse) {
        return Promise.reject(new CDPProtocolError(`${method} refused`, -32000, undefined));
      }
      return Promise.resolve().then(() => answers[method]?.(params) ?? {});
    },
  } as unknown as CDPConnection;
  return { cdp, sent, overrides, waits, windowNow: () => window };
}

/**
 * Chrome's error for a script whose page went away.
 *
 * @returns The error
 */
function contextDestroyed(): CDPProtocolError {
  return new CDPProtocolError('Execution context was destroyed.', -32000, undefined);
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
    assert.equal(shot.screenshot.captureMode, 'element');
    assert.deepEqual(sent, [
      'Emulation.setScrollbarsHidden true',
      'Emulation.setDeviceMetricsOverride 1',
      'Page.captureScreenshot',
      'Emulation.setScrollbarsHidden false',
      'Emulation.setDeviceMetricsOverride 0',
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
    assert.deepEqual(sent.slice(-3), [
      'Emulation.setScrollbarsHidden false',
      'Emulation.setDeviceMetricsOverride 0',
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

  void it('changes nothing for a viewport capture at pixel ratio 1', async () => {
    const { cdp, sent } = fakePage();
    const shot = await takeScreenshot(cdp, { format: 'jpeg', fullPage: false }, noViewport);
    assert.deepEqual(sent, ['Page.captureScreenshot']);
    assert.equal(shot.screenshot.captureMode, 'viewport');
    assert.equal(shot.screenshot.quality, 90);
    assert.equal(shot.screenshot.size, 8);
  });

  void it('lays the page out again after a full-page capture: one px taller, then no override (#514)', async () => {
    const { cdp, sent, overrides, waits } = fakePage();
    const shot = await takeScreenshot(cdp, { format: 'png' }, noViewport);
    assert.equal(shot.screenshot.captureMode, 'full_page');
    assert.deepEqual(sent, [
      'Page.captureScreenshot',
      'Emulation.setDeviceMetricsOverride 0',
      'Emulation.clearDeviceMetricsOverride',
    ]);
    assert.deepEqual(overrides, [
      { width: 1920, height: 1001, deviceScaleFactor: 0, mobile: false },
    ]);
    assert.deepEqual(waits, ['1920x1000 resized', '1920x1001 resized']);
  });

  void it('skips the second wait when the page never saw the taller viewport, and still clears it (#514)', async () => {
    const { cdp, sent, waits } = fakePage({ fixedWindow: true });
    await takeScreenshot(cdp, { format: 'png' }, noViewport);
    assert.deepEqual(waits, ['1920x1000 timed out']);
    assert.equal(sent.at(-1), 'Emulation.clearDeviceMetricsOverride');
  });

  void it('returns only once the page has its size back after an element capture beyond the viewport, not at the size the capture overrode (#529)', async () => {
    const { cdp, windowNow } = fakePage({ clearPassesThrough: true });
    await takeScreenshot(cdp, { format: 'png', backendNodeId: 7 }, noViewport);
    assert.deepEqual(windowNow(), WINDOW, 'the restore returned before the page had its size back');
  });

  void it('returns only once the page has its size back when it saw the taller viewport after the wait for it (#529)', async () => {
    const { cdp, windowNow } = fakePage({ lateTaller: true });
    await takeScreenshot(cdp, { format: 'png', backendNodeId: 7 }, noViewport);
    assert.deepEqual(windowNow(), WINDOW, 'the restore returned before the page had its size back');
  });

  void it('waits on a page that never resizes at most twice after an element capture beyond the viewport (#529)', async () => {
    const { cdp, waits } = fakePage({ fixedWindow: true });
    await takeScreenshot(cdp, { format: 'png', backendNodeId: 7 }, noViewport);
    assert.deepEqual(waits, ['1920x1000 timed out', 'to 1920x1000 reached']);
  });

  void it('clears the taller viewport when the wait for it fails, and reports the capture (#514)', async () => {
    const { cdp, sent } = fakePage({ windowError: 'wait' });
    const shot = await takeScreenshot(cdp, { format: 'png' }, noViewport);
    assert.equal(shot.screenshot.captureMode, 'full_page');
    assert.deepEqual(sent.slice(-2), [
      'Emulation.setDeviceMetricsOverride 0',
      'Emulation.clearDeviceMetricsOverride',
    ]);
  });

  void it('puts the session’s viewport back when the window cannot be read, and reports the error (#514)', async () => {
    const { cdp, sent, overrides } = fakePage({ windowError: 'size' });
    await assert.rejects(
      takeScreenshot(cdp, { format: 'png' }, () => ({ width: 1600, height: 900 })),
      /Execution context was destroyed/
    );
    assert.deepEqual(sent, ['Page.captureScreenshot', 'Emulation.setDeviceMetricsOverride 0']);
    assert.deepEqual(
      overrides.map(({ height }) => height),
      [900]
    );
  });

  void it('lays the page out again after a full-page capture at the session’s viewport, then puts it back (#514)', async () => {
    const { cdp, sent, overrides } = fakePage();
    await takeScreenshot(cdp, { format: 'png' }, () => ({ width: 1600, height: 900 }));
    assert.deepEqual(sent, [
      'Page.captureScreenshot',
      'Emulation.setDeviceMetricsOverride 0',
      'Emulation.setDeviceMetricsOverride 0',
    ]);
    assert.deepEqual(
      overrides.map(({ width, height }) => [width, height]),
      [
        [1600, 901],
        [1600, 900],
      ]
    );
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
    assert.deepEqual(sent.slice(-3), [
      'Emulation.setScrollbarsHidden false',
      'Emulation.setDeviceMetricsOverride 0',
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
    assert.deepEqual(sent.slice(-4), [
      'Runtime.terminateExecution',
      'Emulation.setScrollbarsHidden false',
      'Emulation.setDeviceMetricsOverride 0',
      'Emulation.clearDeviceMetricsOverride',
    ]);
  });
});
