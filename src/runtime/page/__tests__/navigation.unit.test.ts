/**
 * Page navigation: commands that must answer while a navigation waits for the server.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  documentResponse,
  navigatePage,
  pendingNavigationUrl,
  withStatus,
} from '@/runtime/page/navigation.js';
import { documentStatusWarning } from '@/ui/messages/commands.js';
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

/**
 * Event source stub: handlers by event name, and a function to fire one.
 *
 * @returns Stub `on` and `emit`
 */
function fakeEvents(): {
  cdp: Pick<CDPConnection, 'on'>;
  emit: (event: string, params: unknown) => void;
} {
  const handlers = new Map<string, Array<(params: unknown) => void>>();
  const cdp = {
    on: (event: string, handler: (params: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () =>
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((h) => h !== handler)
        );
    },
  } as unknown as Pick<CDPConnection, 'on'>;
  const emit = (event: string, params: unknown): void =>
    (handlers.get(event) ?? []).forEach((handler) => handler(params));
  return { cdp, emit };
}

/**
 * Fire the request and response of a main-frame document.
 *
 * @param emit - Event emitter
 * @param id - Request and loader id
 * @param url - Document URL
 * @param status - HTTP status
 * @param frameId - Frame the document loads in
 */
function loadDocument(
  emit: (event: string, params: unknown) => void,
  id: string,
  url: string,
  status: number,
  frameId = 'main'
): void {
  const base = { requestId: id, loaderId: id, type: 'Document', frameId };
  emit('Network.requestWillBeSent', base);
  emit('Network.responseReceived', { ...base, response: { status, url } });
}

void describe('documentStatusWarning', () => {
  void it('warns about an error status, or a later document that answered differently', () => {
    assert.equal(documentStatusWarning(200), undefined);
    assert.equal(documentStatusWarning(200, { status: 200, url: 'http://a.test/b' }), undefined);
    assert.equal(documentStatusWarning(404), 'The page responded with HTTP 404');
    assert.equal(
      documentStatusWarning(404, { status: 200, url: 'http://a.test/?/x' }),
      'The page responded with HTTP 404, then loaded http://a.test/?/x (HTTP 200)'
    );
    assert.equal(
      documentStatusWarning(200, { status: 404, url: 'http://a.test/gone' }),
      'The page responded with HTTP 200, then loaded http://a.test/gone (HTTP 404)'
    );
  });
});

void describe('documentResponse and withStatus', () => {
  const page = { action: 'navigate' as const, url: 'http://a.test/x', title: '' };

  void it('reports the 404 of a page whose script loads the app', () => {
    const { cdp, emit } = fakeEvents();
    const watch = documentResponse(cdp, 'main');
    loadDocument(emit, 'L1', 'http://a.test/x', 404);
    loadDocument(emit, 'L2', 'http://a.test/?/x', 200);
    const result = withStatus(page, watch.response('L1'));
    assert.equal(result.status, 404);
    assert.match(
      result.warning ?? '',
      /HTTP 404, then loaded http:\/\/a\.test\/\?\/x \(HTTP 200\)/
    );
  });

  void it('reports a 200 page whose script loads a 404', () => {
    const { cdp, emit } = fakeEvents();
    const watch = documentResponse(cdp, 'main');
    loadDocument(emit, 'L1', 'http://a.test/x', 200);
    loadDocument(emit, 'L2', 'http://a.test/gone', 404);
    const result = withStatus(page, watch.response('L1'));
    assert.equal(result.status, 200);
    assert.match(result.warning ?? '', /HTTP 200, then loaded http:\/\/a\.test\/gone \(HTTP 404\)/);
  });

  void it('reports a 404 with no later document', () => {
    const { cdp, emit } = fakeEvents();
    const watch = documentResponse(cdp, 'main');
    loadDocument(emit, 'L1', 'http://a.test/x', 404);
    const result = withStatus(page, watch.response());
    assert.equal(result.status, 404);
    assert.equal(result.warning, 'The page responded with HTTP 404');
  });

  void it('ignores documents of earlier requests, other frames and other loaders', () => {
    const { cdp, emit } = fakeEvents();
    const watch = documentResponse(cdp, 'main');
    emit('Network.responseReceived', {
      requestId: 'OLD',
      loaderId: 'OLD',
      type: 'Document',
      frameId: 'main',
      response: { status: 500, url: 'http://a.test/old' },
    });
    loadDocument(emit, 'F1', 'http://a.test/frame', 404, 'child');
    loadDocument(emit, 'L0', 'http://a.test/before', 503);
    loadDocument(emit, 'L1', 'http://a.test/x', 200);
    assert.deepEqual(watch.response('L1'), { first: { status: 200, url: 'http://a.test/x' } });
    assert.equal(watch.response('MISSING'), undefined);
    watch.stop();
    loadDocument(emit, 'L2', 'http://a.test/late', 404);
    assert.deepEqual(watch.response('L1'), { first: { status: 200, url: 'http://a.test/x' } });
  });
});
