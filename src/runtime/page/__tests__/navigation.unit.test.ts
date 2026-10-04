/**
 * Page navigation: commands that must answer while a navigation waits for the server.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import { navigatePage, pendingNavigationUrl } from '@/runtime/page/navigation.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * CDP stub for a page whose target shows `targetUrl` while history has `committedUrl`.
 * Page commands other than the browser-side ones never answer, like a page
 * whose navigation waits for the server.
 *
 * @param targetUrl - URL the page target reports
 * @param committedUrl - URL of the current history entry
 * @returns Stub and the methods it received
 */
function fakeCdp(targetUrl: string, committedUrl: string): { cdp: CDPConnection; sent: string[] } {
  const sent: string[] = [];
  const answers: Record<string, unknown> = {
    'Target.getTargetInfo': { targetInfo: { targetId: 'main', url: targetUrl } },
    'Page.getNavigationHistory': {
      currentIndex: 1,
      entries: [{ url: 'about:blank' }, { url: committedUrl }],
    },
  };
  const cdp = {
    send: (method: string) => {
      sent.push(method);
      return method in answers ? Promise.resolve(answers[method]) : new Promise(() => undefined);
    },
  } as unknown as CDPConnection;
  return { cdp, sent };
}

void describe('pendingNavigationUrl', () => {
  void it('reports the URL a navigation is waiting for', async () => {
    const { cdp } = fakeCdp('http://a.test/slow', 'http://a.test/');
    assert.equal(await pendingNavigationUrl(cdp), 'http://a.test/slow');
  });

  void it('reports nothing for a page that is not navigating', async () => {
    const { cdp } = fakeCdp('http://a.test/', 'http://a.test/');
    assert.equal(await pendingNavigationUrl(cdp), undefined);
  });
});

void describe('navigatePage without waiting', () => {
  void it('returns while the server has not answered', async () => {
    const { cdp, sent } = fakeCdp('http://a.test/', 'http://a.test/');
    const result = await navigatePage(cdp, 'navigate', { url: 'http://a.test/slow', wait: false });
    assert.equal(result.url, 'http://a.test/slow');
    assert.ok(sent.includes('Page.navigate'));
  });

  void it('still reports a missing history entry', async () => {
    const { cdp } = fakeCdp('http://a.test/', 'http://a.test/');
    await assert.rejects(navigatePage(cdp, 'forward', { wait: false }), (error) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
      return true;
    });
  });

  void it('reports the page being reloaded', async () => {
    const { cdp, sent } = fakeCdp('http://a.test/', 'http://a.test/');
    const result = await navigatePage(cdp, 'reload', { wait: false });
    assert.equal(result.url, 'http://a.test/');
    assert.ok(sent.includes('Page.reload'));
  });
});
