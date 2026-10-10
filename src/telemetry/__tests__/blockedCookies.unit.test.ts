/**
 * Unit tests for blocked cookies from ExtraInfo events: names and reasons
 * only (never values), cookies that do not apply to the URL left out, and a
 * bound per request.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Protocol } from '@/connection/typed-cdp.js';
import { MAX_BLOCKED_COOKIES } from '@/constants.js';
import {
  addBlockedCookies,
  blockedAssociatedCookies,
  blockedSetCookies,
} from '@/telemetry/blockedCookies.js';
import type { NetworkRequest } from '@/types.js';

/**
 * A cookie as CDP reports it.
 *
 * @param name - Cookie name
 * @param value - Cookie value
 * @returns Cookie
 */
function cookie(name: string, value = 'secret-value'): Protocol.Network.Cookie {
  return {
    name,
    value,
    domain: 'localhost',
    path: '/',
    expires: -1,
    size: name.length + value.length,
    httpOnly: false,
    secure: false,
    session: true,
    priority: 'Medium',
    sameParty: false,
    sourceScheme: 'NonSecure',
    sourcePort: 80,
  } as Protocol.Network.Cookie;
}

/**
 * An associated cookie with reasons.
 *
 * @param name - Cookie name
 * @param blockedReasons - Chrome's reasons
 * @returns Associated cookie
 */
function associated(
  name: string,
  blockedReasons: Protocol.Network.CookieBlockedReason[]
): Protocol.Network.AssociatedCookie {
  return { cookie: cookie(name), blockedReasons };
}

function makeRequest(): NetworkRequest {
  return { requestId: 'r1', url: 'http://localhost/', method: 'GET', timestamp: 0 };
}

void describe('blockedSetCookies', () => {
  void it('keeps the name and reasons of each rejected Set-Cookie, never the value', () => {
    const blocked = blockedSetCookies([
      {
        cookieLine: 'nosecure=secret-value; SameSite=None',
        blockedReasons: ['SameSiteNoneInsecure'],
        cookie: cookie('nosecure'),
      },
      { cookieLine: 'dom=secret-value; Domain=example.com', blockedReasons: ['InvalidDomain'] },
    ]);
    assert.deepEqual(blocked, [
      { name: 'nosecure', kind: 'set-rejected', reasons: ['SameSiteNoneInsecure'] },
      { name: 'dom', kind: 'set-rejected', reasons: ['InvalidDomain'] },
    ]);
    assert.ok(!JSON.stringify(blocked).includes('secret-value'), 'no value kept');
  });

  void it('takes a line without "=" as a cookie without a name', () => {
    const blocked = blockedSetCookies([
      { cookieLine: 'secret-value; Path=/', blockedReasons: ['SyntaxError'] },
    ]);
    assert.deepEqual(blocked, [{ name: '', kind: 'set-rejected', reasons: ['SyntaxError'] }]);
  });

  void it('leaves out entries without reasons and accepts a missing list', () => {
    assert.deepEqual(blockedSetCookies([{ cookieLine: 'a=1', blockedReasons: [] }]), []);
    assert.deepEqual(blockedSetCookies(undefined), []);
  });

  void it('cuts very long names', () => {
    const [entry] = blockedSetCookies([
      { cookieLine: `${'n'.repeat(5000)}=v`, blockedReasons: ['NameValuePairExceedsMaxSize'] },
    ]);
    assert.ok(entry !== undefined && entry.name.length <= 200);
  });
});

void describe('blockedAssociatedCookies', () => {
  void it('keeps cookies not sent with their reasons, never the value', () => {
    const blocked = blockedAssociatedCookies([
      associated('tp_lax', ['SchemefulSameSiteLax']),
      associated('tp_strict', ['SchemefulSameSiteStrict']),
      associated('sent', []),
    ]);
    assert.deepEqual(blocked, [
      { name: 'tp_lax', kind: 'not-sent', reasons: ['SchemefulSameSiteLax'] },
      { name: 'tp_strict', kind: 'not-sent', reasons: ['SchemefulSameSiteStrict'] },
    ]);
    assert.ok(!JSON.stringify(blocked).includes('secret-value'), 'no value kept');
  });

  void it('leaves out cookies that do not apply to the URL', () => {
    const blocked = blockedAssociatedCookies([
      associated('other_site', ['DomainMismatch']),
      associated('other_path', ['NotOnPath']),
      associated('other_path_2', ['PathMismatch' as Protocol.Network.CookieBlockedReason]),
      associated('other_site_lax', ['DomainMismatch', 'SameSiteLax']),
    ]);
    assert.deepEqual(blocked, []);
  });

  void it('accepts a missing list', () => {
    assert.deepEqual(blockedAssociatedCookies(undefined), []);
  });
});

void describe('addBlockedCookies', () => {
  void it('adds entries once, whatever the event repeats', () => {
    const request = makeRequest();
    const entries = blockedAssociatedCookies([associated('a', ['SameSiteLax'])]);
    addBlockedCookies(request, entries);
    addBlockedCookies(request, entries);
    assert.deepEqual(request.blockedCookies, [
      { name: 'a', kind: 'not-sent', reasons: ['SameSiteLax'] },
    ]);
  });

  void it('leaves the request without the field when nothing was blocked', () => {
    const request = makeRequest();
    addBlockedCookies(request, []);
    assert.equal('blockedCookies' in request, false);
  });

  void it(`keeps at most ${MAX_BLOCKED_COOKIES} per request and counts the rest`, () => {
    const request = makeRequest();
    const many = Array.from({ length: MAX_BLOCKED_COOKIES + 7 }, (_, i) =>
      associated(`c${i}`, ['SameSiteStrict'])
    );
    addBlockedCookies(request, blockedAssociatedCookies(many));
    addBlockedCookies(
      request,
      blockedSetCookies([{ cookieLine: 'late=1', blockedReasons: ['InvalidDomain'] }])
    );
    assert.equal(request.blockedCookies?.length, MAX_BLOCKED_COOKIES);
    assert.equal(request.blockedCookiesOmitted, 8);
  });
});
