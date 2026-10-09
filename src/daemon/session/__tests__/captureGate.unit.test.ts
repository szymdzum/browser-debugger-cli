/**
 * Page commands run only once a screenshot before them has ended, restore
 * included (#519); telemetry reads run at once, and a capture that never
 * ends holds a command only for a bounded time.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CaptureGate } from '@/daemon/session/captureGate.js';
import { delay } from '@/utils/async.js';

/**
 * A capture the test ends.
 *
 * @returns The capture's work, and how to end it (ok or failed)
 */
function heldCapture(): {
  work: () => Promise<string>;
  end: (failed?: boolean) => void;
} {
  let end: (failed?: boolean) => void = () => undefined;
  const done = new Promise<string>((resolve, reject) => {
    end = (failed) => (failed ? reject(new Error('capture failed')) : resolve('shot'));
  });
  return { work: () => done, end };
}

void describe('CaptureGate', () => {
  void it('runs a page command only after the capture before it ended', async () => {
    const gate = new CaptureGate();
    const order: string[] = [];
    const capture = heldCapture();
    const shot = gate.run('dom_screenshot', async () => {
      const result = await capture.work();
      order.push('restored');
      return result;
    });
    const evaluated = gate.run('cdp_call', () => {
      order.push('cdp_call');
      return Promise.resolve();
    });
    await delay(20);
    assert.deepEqual(order, []);
    capture.end();
    await Promise.all([shot, evaluated]);
    assert.deepEqual(order, ['restored', 'cdp_call']);
  });

  void it('also waits for a capture that failed', async () => {
    const gate = new CaptureGate();
    const capture = heldCapture();
    const shot = gate.run('dom_screenshot', capture.work);
    let ran = false;
    const next = gate.run('dom_eval', () => {
      ran = true;
      return Promise.resolve();
    });
    await delay(20);
    assert.equal(ran, false);
    capture.end(true);
    await assert.rejects(shot, /capture failed/);
    await next;
    assert.equal(ran, true);
  });

  void it('runs telemetry reads at once during a capture', async () => {
    const gate = new CaptureGate();
    const capture = heldCapture();
    const shot = gate.run('dom_screenshot', capture.work);
    assert.equal(await gate.run('session_peek', () => Promise.resolve('peek')), 'peek');
    capture.end();
    await shot;
  });

  void it('queues a capture behind the capture before it', async () => {
    const gate = new CaptureGate();
    const first = heldCapture();
    const order: string[] = [];
    const one = gate.run('dom_screenshot', async () => {
      await first.work();
      order.push('first');
    });
    const two = gate.run('dom_screenshot', () => {
      order.push('second');
      return Promise.resolve();
    });
    let third = false;
    const after = gate.run('dom_click', () => {
      third = true;
      return Promise.resolve();
    });
    await delay(20);
    assert.deepEqual(order, []);
    first.end();
    await Promise.all([one, two, after]);
    assert.deepEqual(order, ['first', 'second']);
    assert.equal(third, true);
  });

  void it('runs a page command anyway once a capture outlasts the wait', async () => {
    const gate = new CaptureGate(30);
    const capture = heldCapture();
    void gate.run('dom_screenshot', capture.work);
    const started = Date.now();
    await gate.run('dom_eval', () => Promise.resolve());
    assert.ok(Date.now() - started >= 25);
    capture.end();
  });

  void it("holds a capture behind another capture past the wait (it would record the first one's emulation as the page's)", async () => {
    const gate = new CaptureGate(30);
    const first = heldCapture();
    const one = gate.run('dom_screenshot', first.work);
    let second = false;
    const two = gate.run('dom_screenshot', () => {
      second = true;
      return Promise.resolve();
    });
    await delay(90);
    assert.equal(second, false);
    first.end();
    await Promise.all([one, two]);
    assert.equal(second, true);
  });

  void it('runs page commands at once when no capture is running', async () => {
    const gate = new CaptureGate();
    await gate.run('dom_screenshot', () => Promise.resolve());
    let ran = false;
    const next = gate.run('dom_eval', () => {
      ran = true;
      return Promise.resolve();
    });
    await delay(5);
    assert.equal(ran, true);
    await next;
  });
});
