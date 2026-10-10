/**
 * Unit tests for ExtraInfoTracker: full headers reach the right request
 * regardless of the order Chrome delivers the events in.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { ExtraInfoTracker } from '@/telemetry/networkExtraInfo.js';
import type { BlockedCookie, NetworkRequest } from '@/types.js';

const COOKIE = { cookie: 'session=abc' };
const NOT_SENT: BlockedCookie[] = [
  { name: 'tp_lax', kind: 'not-sent', reasons: ['SchemefulSameSiteLax'] },
];
const SET_REJECTED: BlockedCookie[] = [
  { name: 'nosecure', kind: 'set-rejected', reasons: ['SameSiteNoneInsecure'] },
];
const SET_COOKIE = { 'set-cookie': 'a=1\nb=2', 'content-type': 'text/html' };

function makeRequest(requestId: string): NetworkRequest {
  return { requestId, url: 'https://example.com/', method: 'GET', timestamp: 0 };
}

void describe('ExtraInfoTracker', () => {
  let active: Map<string, NetworkRequest>;
  let tracker: ExtraInfoTracker;

  beforeEach(() => {
    active = new Map();
    tracker = new ExtraInfoTracker((id) => active.get(id));
  });

  void it('applies request headers that arrive before the request', () => {
    tracker.onRequestExtraInfo('r1', COOKIE);
    const request = makeRequest('r1');
    tracker.applyRequest('r1', request);
    assert.deepEqual(request.requestHeaders, COOKIE);
  });

  void it('applies request headers that arrive after the request', () => {
    const request = makeRequest('r1');
    active.set('r1', request);
    tracker.onRequestExtraInfo('r1', COOKIE);
    assert.deepEqual(request.requestHeaders, COOKIE);
  });

  void it('keeps early response headers until the response is recorded', () => {
    const request = makeRequest('r1');
    active.set('r1', request);
    tracker.onResponseExtraInfo('r1', SET_COOKIE);
    assert.equal(request.responseHeaders, undefined, 'not applied before the response');

    request.status = 200;
    request.responseHeaders = { 'content-type': 'text/html' };
    tracker.applyResponse('r1', request);
    assert.deepEqual(request.responseHeaders, SET_COOKIE);
  });

  void it('replaces response headers that arrive after the response', () => {
    const request = { ...makeRequest('r1'), status: 200, responseHeaders: {} };
    active.set('r1', request);
    tracker.onResponseExtraInfo('r1', SET_COOKIE);
    assert.deepEqual(request.responseHeaders, SET_COOKIE);
  });

  void it('reaches requests that already finished', () => {
    const request = { ...makeRequest('r1'), status: 200 };
    tracker.complete('r1', request);
    tracker.onResponseExtraInfo('r1', SET_COOKIE);
    assert.deepEqual(request.responseHeaders, SET_COOKIE);
  });

  void it('applies buffered redirect response headers to the hop entry', () => {
    tracker.onResponseExtraInfo('r1', { location: '/next', 'set-cookie': 'hop=1' });
    const hop = { ...makeRequest('r1:redirect:1'), status: 302 };
    tracker.applyResponse('r1', hop);
    assert.equal(hop.responseHeaders?.['set-cookie'], 'hop=1');
  });

  void it('does not apply redirect headers to the final response', () => {
    const request = makeRequest('r1');
    active.set('r1', request);
    tracker.onResponseExtraInfo('r1', { location: '/next' }, 302);
    request.status = 200;
    request.responseHeaders = { 'content-type': 'text/html' };
    tracker.applyResponse('r1', request);
    assert.deepEqual(request.responseHeaders, { 'content-type': 'text/html' });

    tracker.onResponseExtraInfo('r1', { location: '/late' }, 301);
    assert.deepEqual(request.responseHeaders, { 'content-type': 'text/html' }, 'late 3xx ignored');
  });

  void it('gives late redirect headers to their hop, in a chain of redirects', () => {
    const hop1 = {
      ...makeRequest('r1:redirect:1'),
      url: 'https://example.com/a',
      redirectURL: 'https://example.com/b',
      status: 302,
    };
    tracker.applyResponse('r1', hop1);
    tracker.recordRedirectHop('r1', hop1);
    active.set('r1', { ...makeRequest('r1'), url: 'https://example.com/b' });

    tracker.onResponseExtraInfo('r1', { Location: '/b', 'set-cookie': 'first=1' }, 302);
    tracker.onResponseExtraInfo('r1', { location: '/c', 'set-cookie': 'second=2' }, 302);
    const hop2 = { ...makeRequest('r1:redirect:2'), status: 302 };
    tracker.applyResponse('r1', hop2);

    assert.equal(hop1.responseHeaders?.['set-cookie'], 'first=1', 'late headers reach hop 1');
    assert.equal(hop2.responseHeaders?.['set-cookie'], 'second=2', 'hop 2 keeps its own');
  });

  void it('does not move headers without a matching Location to an earlier hop', () => {
    const hop1 = {
      ...makeRequest('r1:redirect:1'),
      url: 'https://example.com/a',
      redirectURL: 'https://example.com/b',
      status: 302,
      responseHeaders: { location: '/b' },
    };
    tracker.recordRedirectHop('r1', hop1);
    active.set('r1', makeRequest('r1'));

    tracker.onResponseExtraInfo('r1', { 'set-cookie': 'x=1' }, 302);

    assert.deepEqual(hop1.responseHeaders, { location: '/b' });
  });

  void describe('blocked cookies', () => {
    void it('reach a request whose ExtraInfo arrived before it', () => {
      tracker.onRequestExtraInfo('r1', COOKIE, NOT_SENT);
      const request = makeRequest('r1');
      tracker.applyRequest('r1', request);
      assert.deepEqual(request.blockedCookies, NOT_SENT);
    });

    void it('reach a request whose ExtraInfo arrived after it', () => {
      const request = makeRequest('r1');
      active.set('r1', request);
      tracker.onRequestExtraInfo('r1', COOKIE, NOT_SENT);
      assert.deepEqual(request.blockedCookies, NOT_SENT);
    });

    void it('rejected Set-Cookies arriving early wait for the response', () => {
      const request = makeRequest('r1');
      active.set('r1', request);
      tracker.onResponseExtraInfo('r1', SET_COOKIE, 200, SET_REJECTED);
      assert.equal(request.blockedCookies, undefined, 'not applied before the response');

      request.status = 200;
      tracker.applyResponse('r1', request);
      assert.deepEqual(request.blockedCookies, SET_REJECTED);
    });

    void it('rejected Set-Cookies arriving after the response or the end', () => {
      const request = { ...makeRequest('r1'), status: 200 };
      active.set('r1', request);
      tracker.onRequestExtraInfo('r1', COOKIE, NOT_SENT);
      tracker.onResponseExtraInfo('r1', SET_COOKIE, 200, SET_REJECTED);
      assert.deepEqual(request.blockedCookies, [...NOT_SENT, ...SET_REJECTED]);

      const finished = { ...makeRequest('r2'), status: 200 };
      tracker.complete('r2', finished);
      tracker.onResponseExtraInfo('r2', SET_COOKIE, 200, SET_REJECTED);
      assert.deepEqual(finished.blockedCookies, SET_REJECTED);
    });

    void it('rejected Set-Cookies of a redirect stay on its hop', () => {
      const hop1 = {
        ...makeRequest('r1:redirect:1'),
        url: 'https://example.com/a',
        redirectURL: 'https://example.com/b',
        status: 302,
      };
      tracker.recordRedirectHop('r1', hop1);
      const final = { ...makeRequest('r1'), url: 'https://example.com/b', status: 200 };
      active.set('r1', final);

      tracker.onResponseExtraInfo('r1', { location: '/b' }, 302, SET_REJECTED);

      assert.deepEqual(hop1.blockedCookies, SET_REJECTED);
      assert.equal(final.blockedCookies, undefined);
    });
  });
});
