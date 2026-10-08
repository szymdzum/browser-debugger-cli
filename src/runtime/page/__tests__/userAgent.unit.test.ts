/**
 * Client hints for headless Chrome's user-agent override: the brand list
 * Chrome itself builds, and the platform from the host.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import {
  chromeBrandList,
  hideHeadlessUserAgent,
  regularChromeMetadata,
  releasePlatformVersion,
  type HostPlatform,
} from '@/runtime/page/userAgent.js';
import { createLogger } from '@/ui/logging/index.js';

const MAC: HostPlatform = {
  platform: 'macOS',
  platformVersion: '15.7.9',
  architecture: 'arm',
  bitness: '64',
};

const HEADLESS_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36';

/**
 * Brand list as Chrome writes it in `Sec-CH-UA`.
 *
 * @param list - Brands
 * @returns Header value
 */
function header(list: { brand: string; version: string }[]): string {
  return list.map(({ brand, version }) => `"${brand}";v="${version}"`).join(', ');
}

void describe('chromeBrandList', () => {
  void it('matches the Sec-CH-UA of Chrome releases', () => {
    const chrome = (major: number): string =>
      header(
        chromeBrandList(major, String(major), { brand: 'Google Chrome', version: String(major) })
      );
    assert.equal(chrome(120), '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"');
    assert.equal(chrome(122), '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"');
    assert.equal(chrome(124), '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"');
    assert.equal(chrome(131), '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"');
    assert.equal(chrome(154), '"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"');
  });
});

void describe('regularChromeMetadata', () => {
  void it('describes headless Chrome as Google Chrome on the host', () => {
    const metadata = regularChromeMetadata(
      { product: 'Chrome/154.0.8037.98', userAgent: HEADLESS_MAC_UA },
      MAC
    );
    assert.deepEqual(metadata, {
      brands: [
        { brand: 'Chromium', version: '154' },
        { brand: 'Google Chrome', version: '154' },
        { brand: 'Not A(Brand', version: '99' },
      ],
      fullVersionList: [
        { brand: 'Chromium', version: '154.0.8037.98' },
        { brand: 'Google Chrome', version: '154.0.8037.98' },
        { brand: 'Not A(Brand', version: '99.0.0.0' },
      ],
      fullVersion: '154.0.8037.98',
      platform: 'macOS',
      platformVersion: '15.7.9',
      architecture: 'arm',
      bitness: '64',
      model: '',
      mobile: false,
      wow64: false,
      formFactors: ['Desktop'],
    });
  });

  void it('names Microsoft Edge for Edge', () => {
    const metadata = regularChromeMetadata(
      {
        product: 'Edg/154.0.4258.62',
        userAgent: `${HEADLESS_MAC_UA} Edg/154.0.0.0`,
      },
      MAC
    );
    assert.deepEqual(metadata.fullVersionList, [
      { brand: 'Chromium', version: '154.0.0.0' },
      { brand: 'Microsoft Edge', version: '154.0.4258.62' },
      { brand: 'Not A(Brand', version: '99.0.0.0' },
    ]);
  });

  void it('leaves the OS version empty for a Chrome on another platform', () => {
    const metadata = regularChromeMetadata(
      {
        product: 'HeadlessChrome/154.0.8037.98',
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36',
      },
      MAC
    );
    assert.equal(metadata.platform, 'Linux');
    assert.equal(metadata.platformVersion, '');
    assert.equal(metadata.architecture, '');
    assert.equal(metadata.fullVersion, '154.0.8037.98');
  });
});

void describe('releasePlatformVersion', () => {
  void it('keeps the first three numbers of a Linux kernel version', () => {
    assert.equal(releasePlatformVersion('linux', '6.8.0-45-generic'), '6.8.0');
    assert.equal(releasePlatformVersion('linux', '5.15.167.4-microsoft-standard-WSL2'), '5.15.167');
  });

  void it('reports Windows 11 as 13.0.0 and earlier Windows as 10.0.0', () => {
    assert.equal(releasePlatformVersion('win32', '10.0.22631'), '13.0.0');
    assert.equal(releasePlatformVersion('win32', '10.0.19045'), '10.0.0');
    assert.equal(releasePlatformVersion('win32', 'unknown'), '');
  });
});

void describe('hideHeadlessUserAgent', () => {
  /**
   * A connection answering `Browser.getVersion` with the given user agent.
   *
   * @param userAgent - Browser user agent
   * @returns Connection and the calls it was sent
   */
  function fakeCdp(userAgent: string): {
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

  void it('overrides the user agent with client hints in one call', async () => {
    const { cdp, sent } = fakeCdp(HEADLESS_MAC_UA);
    await hideHeadlessUserAgent(cdp, createLogger('session'));
    assert.deepEqual(
      sent.map(({ method }) => method),
      ['Browser.getVersion', 'Emulation.setUserAgentOverride']
    );
    const params = sent[1]?.params as {
      userAgent: string;
      userAgentMetadata: { brands: unknown[] };
    };
    assert.doesNotMatch(params.userAgent, /Headless/);
    assert.equal(params.userAgentMetadata.brands.length, 3);
  });

  void it('leaves a headed Chrome alone', async () => {
    const { cdp, sent } = fakeCdp(HEADLESS_MAC_UA.replace('HeadlessChrome', 'Chrome'));
    await hideHeadlessUserAgent(cdp, createLogger('session'));
    assert.deepEqual(
      sent.map(({ method }) => method),
      ['Browser.getVersion']
    );
  });
});
