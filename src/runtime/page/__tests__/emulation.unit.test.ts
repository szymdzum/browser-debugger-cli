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

void describe('emulatePage leaving phone emulation', () => {
  const desktop =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

  /**
   * A connection whose browser has the given user agent, recording calls.
   *
   * @param userAgent - Browser user agent
   * @returns Connection and the calls it was sent
   */
  function browserCdp(userAgent: string): {
    cdp: CDPConnection;
    sent: { method: string; params: unknown }[];
  } {
    const sent: { method: string; params: unknown }[] = [];
    const cdp = {
      send: (method: string, params: unknown): Promise<unknown> => {
        sent.push({ method, params });
        return Promise.resolve(
          method === 'Browser.getVersion' ? { product: 'Chrome/154.0.8037.98', userAgent } : {}
        );
      },
    } as unknown as CDPConnection;
    return { cdp, sent };
  }

  /**
   * The user-agent overrides sent when a phone's emulation is reset.
   *
   * @param userAgent - Browser user agent
   * @returns Calls sent
   */
  async function resetPhone(userAgent: string): Promise<{ method: string; params: unknown }[]> {
    const { cdp, sent } = browserCdp(userAgent);
    await emulatePage(
      cdp,
      { viewport: { width: 390, height: 844, mobile: true } },
      { reset: true },
      () => undefined
    );
    return sent.filter(({ method }) => method.includes('UserAgent') || method.includes('Version'));
  }

  void it('gives headless Chrome its regular-Chrome identity in one override', async () => {
    const sent = await resetPhone(desktop.replace('Chrome/', 'HeadlessChrome/'));
    assert.deepEqual(
      sent.map(({ method }) => method),
      ['Browser.getVersion', 'Emulation.setUserAgentOverride']
    );
    const params = sent[1]?.params as { userAgent: string; userAgentMetadata?: unknown };
    assert.equal(params.userAgent, desktop);
    assert.ok(params.userAgentMetadata);
  });

  void it('clears the override in headed Chrome', async () => {
    const sent = await resetPhone(desktop);
    assert.deepEqual(sent, [
      { method: 'Browser.getVersion', params: {} },
      { method: 'Emulation.setUserAgentOverride', params: { userAgent: '' } },
    ]);
  });
});
