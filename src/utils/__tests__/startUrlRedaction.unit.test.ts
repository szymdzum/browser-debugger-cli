/**
 * Start errors never echo URL credentials (#757): the formatter, the URL
 * validation messages and the "Could not load" error, for every input of
 * the case matrix (the error only for the URLs validation lets through, as
 * every start and `page navigate` validates the URL first).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { navigationFailedError } from '@/errors/messages.js';
import { displayRejectedUrl, displayTypedUrl, displayUrl } from '@/utils/displayUrl.js';
import { normalizeUrl, validateChromeWsUrl, validateUrl } from '@/utils/url.js';

/** Any form of the password the inputs carry */
const SECRET = /SECRETPW|SECRET%40PW/;

/** Inputs and the host each error must still name */
const CASES: ReadonlyArray<{ url: string; host: string }> = [
  { url: 'http://user:SECRETPW@localhost', host: 'localhost' },
  { url: 'http://user:SECRETPW@127.0.0.1:1/p', host: '127.0.0.1' },
  { url: 'http://us%40er:SECRETPW@localhost:1', host: 'localhost' },
  { url: 'http://user:SECRET%40PW@localhost:1', host: 'localhost' },
  { url: 'http://user:SECRETPW@[::1]:1/', host: '[::1]' },
  { url: 'http://user@localhost:1/', host: 'localhost' },
  { url: 'user:SECRETPW@localhost:abc/p', host: 'localhost' },
  { url: 'http://user:SECRETPW@localhost:99999/', host: 'localhost' },
  { url: 'http://localhost:1/?token=SECRETPW', host: 'localhost' },
  { url: 'http://localhost:1/#access_token=SECRETPW', host: 'localhost' },
  { url: 'localhost:1/?token=SECRETPW', host: 'localhost' },
  { url: 'htp://user:SECRETPW@localhost', host: 'localhost' },
  { url: 'http://user:SECRETPW@local host/', host: 'local host' },
  { url: 'http://user:SECRETPW@localhost/?', host: 'localhost' },
  { url: 'user:SECRETPW@localhost', host: 'localhost' },
  { url: '//u:SECRETPW@localhost:1', host: 'localhost' },
  { url: '///u:SECRETPW@localhost:1', host: 'localhost' },
  { url: 'http:///u:SECRETPW@localhost:1', host: 'localhost' },
  { url: 'http:////u:SECRETPW@localhost:1', host: 'localhost' },
  { url: 'https:/u:SECRETPW@localhost:1', host: 'localhost' },
  { url: 'http:u:SECRETPW@localhost:1', host: 'localhost' },
  { url: 'x?next=u:SECRETPW@localhost', host: 'localhost' },
  { url: 'localhost:1/?next=https%3A%2F%2Fu%3ASECRETPW%40evil.test', host: 'localhost' },
  { url: 'http://localhost:1/?redirect=https://u:SECRETPW@evil.test', host: 'localhost' },
  { url: 'http://localhost:1/?next=//u:SECRETPW@evil.test', host: 'localhost' },
  { url: 'x y?next=u%3ASECRETPW%40localhost', host: 'localhost' },
];

/** The URLs validation lets through, which reach Chrome and the daemon */
const VALID_CASES = CASES.filter(({ url }) => validateUrl(url).valid);

/**
 * A typed URL as bdg shows it: rejected input as its error does, the rest as
 * status and the daemon do.
 *
 * @param url - URL as typed
 * @returns The URL to show
 */
function shownTyped(url: string): string {
  return validateUrl(url).valid ? displayTypedUrl(url) : displayRejectedUrl(url);
}

void describe('displayTypedUrl and displayRejectedUrl (#757)', () => {
  for (const { url, host } of CASES) {
    void it(`hides the secret of ${url}`, () => {
      const shown = shownTyped(url);
      assert.doesNotMatch(shown, SECRET);
      assert.ok(shown.includes(host), `${shown} names ${host}`);
    });
  }

  void it('keeps a URL without credentials byte for byte', () => {
    for (const url of ['localhost:3000/a?q=1', 'http://example.com/', 'about:blank', 'data:,a@b']) {
      assert.equal(displayTypedUrl(url), url);
      assert.equal(displayRejectedUrl(url), url);
    }
  });
});

void describe('validateUrl messages (#757)', () => {
  for (const { url } of CASES) {
    void it(`echo no secret for ${url}`, () => {
      const result = validateUrl(url);
      if (result.valid) return;
      assert.doesNotMatch(`${result.error}\n${result.suggestion ?? ''}`, SECRET);
    });
  }
});

void describe('navigationFailedError (#757)', () => {
  for (const { url, host } of VALID_CASES) {
    void it(`echoes no secret for ${url}`, () => {
      const normalized = normalizeUrl(url);
      const err = navigationFailedError(
        normalized,
        'net::ERR_CONNECTION_REFUSED',
        normalized === `http://${url}`
      );
      assert.doesNotMatch(`${err.message}\n${err.suggestion}`, SECRET);
      assert.ok(err.message.includes(host), `${err.message} names ${host}`);
    });
  }
});

void describe('validateChromeWsUrl messages (#757 adjacent)', () => {
  for (const value of ['ws://user:SECRETPW@[bad', 'ws://user:SECRETPW@/devtools/browser/x']) {
    void it(`echo no secret for ${value}`, () => {
      const result = validateChromeWsUrl(value);
      assert.equal(result.valid, false);
      if (result.valid) return;
      assert.doesNotMatch(`${result.error}\n${result.suggestion ?? ''}`, SECRET);
    });
  }
});

void describe('displayUrl of a normalized start URL (#757)', () => {
  for (const { url } of VALID_CASES) {
    void it(`hides the secret of ${url} as the daemon logs it`, () => {
      assert.doesNotMatch(displayUrl(normalizeUrl(url)), SECRET);
    });
  }
});

void describe('validateUrl for scheme-less credentials (#757)', () => {
  void it('names the cause without echoing the credentials', () => {
    const result = validateUrl('user:SECRETPW@localhost:3000');
    assert.equal(result.valid, false);
    if (result.valid) return;
    assert.match(result.suggestion ?? '', /credentials.*need a scheme/i);
    assert.doesNotMatch(`${result.error}\n${result.suggestion ?? ''}`, SECRET);
  });
});

void describe('scheme-less credentials hint (#757)', () => {
  void it('is not shown for userinfo in a query value only', () => {
    const result = validateUrl('x?next=u:SECRETPW@localhost');
    assert.equal(result.valid, false);
    if (result.valid) return;
    assert.doesNotMatch(result.suggestion ?? '', /credentials/i);
  });
});

/** URLs with `:` and `@` outside a user info, which every surface keeps as they are */
const LEGIT_URLS = [
  'https://www.google.com/maps/place/A:B@52.1,21.0,15z/data=x',
  'https://www.google.com/maps/@52.1,21.0,15z',
  'https://cdn.example.com/img/a:b@2x.png',
  'https://example.com/?q=a:b@c',
  'https://example.com/?t=12:30@home',
  'https://example.com/app;jsessionid=a:b@c',
  'https://ipfs.io/ipfs/Qm:x@y',
  'https://example.com/?email=a:b@c.com',
  'https://mastodon.social/@user',
  'https://unpkg.com/@scope/pkg@1.2.3/dist/index.js',
  'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js',
  'ws://127.0.0.1:9222/devtools/browser/abc',
  'http://[::1]:8080/a@b',
  'file:///C:/Users/a@b/x.html',
];

void describe('URLs without credentials stay as they are (#757 review)', () => {
  for (const url of LEGIT_URLS) {
    void it(url, () => {
      assert.equal(displayUrl(url), url);
      assert.equal(displayTypedUrl(url), url);
    });
  }
});

/** Inputs that make a backtracking pattern quadratic, built from a repeat count */
const ADVERSARIAL: ReadonlyArray<(n: number) => string> = [
  (n) => ':'.repeat(n * 4),
  (n) => `http://x/${':'.repeat(n * 4)}`,
  (n) => `x${'a:'.repeat(n * 2)}`,
  (n) => '%3A'.repeat(n * 1.4),
  (n) => `http://${'a:/'.repeat(n * 1.4)}`,
  (n) => `http://x/?${'a=b:c&'.repeat(n * 0.68)}`,
];

/** Repeat count of the shorter input; the longer one has four times as many */
const BASE_REPEAT = 25_000;

/** A quadratic pattern grows 16x for a 4x longer input, a linear one about 4x */
const MAX_GROWTH = 8;

/**
 * Fastest of five runs of a display function.
 *
 * @param show - Display function
 * @param input - URL text
 * @returns Duration in milliseconds
 */
function fastestOfFive(show: (url: string) => string, input: string): number {
  let best = Infinity;
  for (let run = 0; run < 5; run++) {
    const started = performance.now();
    show(input);
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

void describe('URL display is linear (#757 review)', () => {
  for (const build of ADVERSARIAL) {
    const short = build(BASE_REPEAT);
    const long = build(BASE_REPEAT * 4);
    void it(`shows ${short.slice(0, 12)}… (${short.length} to ${long.length} chars) in linear time`, () => {
      for (const show of [displayUrl, displayTypedUrl, displayRejectedUrl]) {
        show(short);
        const growth = fastestOfFive(show, long) / Math.max(fastestOfFive(show, short), 2);
        assert.ok(growth < MAX_GROWTH, `${show.name} grew ${growth.toFixed(1)}x for 4x the input`);
      }
    });
  }
});
