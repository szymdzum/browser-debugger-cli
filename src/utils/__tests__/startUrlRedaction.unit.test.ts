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

/** Smallest repeat count of the shorter input; the longer one has four times as many */
const BASE_REPEAT = 25_000;

/** Largest factor the repeat count grows by to reach {@link MIN_SHORT_CPU_MS} */
const MAX_SCALE = 32;

/** CPU time the shorter input must cost, so timer resolution and fixed overhead cannot hide growth */
const MIN_SHORT_CPU_MS = 10;

/**
 * A quadratic pattern grows 16x for a 4x longer input, a linear one about 4x; 10 leaves room for load noise.
 * Catches quadratic or worse growth; an n^1.5 function (about 8x) passes, which is fine for ReDoS.
 */
const MAX_GROWTH = 10;

/** Interleaved rounds per measurement: each input gets its own chance at a quiet slice */
const ROUNDS = 7;

/**
 * Fastest CPU time of a display function for each of two inputs. CPU time, not wall time: a
 * loaded machine deschedules the longer run more often, which inflates the wall-clock ratio.
 * The inputs are measured alternately so a load spike hits both rather than one.
 *
 * @param show - Display function
 * @param short - Shorter input
 * @param long - Longer input
 * @returns Fastest CPU time in milliseconds for each input
 */
function fastestPair(
  show: (url: string) => string,
  short: string,
  long: string
): { short: number; long: number } {
  const best = { short: Infinity, long: Infinity };
  for (let round = 0; round < ROUNDS; round++) {
    for (const [key, input] of [
      ['short', short],
      ['long', long],
    ] as const) {
      const started = process.cpuUsage();
      show(input);
      const used = process.cpuUsage(started);
      best[key] = Math.min(best[key], (used.user + used.system) / 1000);
    }
  }
  return best;
}

/** Measurements of one pair before a load spike counts as a regression */
const MEASUREMENTS = 3;

/**
 * Smallest repeat count (doubling from the base) whose shorter input costs at least the minimum CPU time.
 *
 * @param show - Display function
 * @param build - Input builder
 * @returns Repeat count of the shorter input
 */
function calibratedRepeat(show: (url: string) => string, build: (n: number) => string): number {
  let repeat = BASE_REPEAT;
  while (repeat < BASE_REPEAT * MAX_SCALE) {
    const input = build(repeat);
    show(input);
    const started = process.cpuUsage();
    show(input);
    const used = process.cpuUsage(started);
    if ((used.user + used.system) / 1000 >= MIN_SHORT_CPU_MS) break;
    repeat *= 2;
  }
  return repeat;
}

/**
 * Growth of a display function for the 4x longer input, re-measured while it stays over the limit.
 * A quadratic implementation is over the limit every time; transient load is not.
 *
 * @param show - Display function
 * @param build - Input builder
 * @returns Lowest growth ratio seen
 */
function lowestGrowth(show: (url: string) => string, build: (n: number) => string): number {
  const repeat = calibratedRepeat(show, build);
  const short = build(repeat);
  const long = build(repeat * 4);
  show(short);
  show(long);
  let lowest = Infinity;
  for (let attempt = 0; attempt < MEASUREMENTS && lowest >= MAX_GROWTH; attempt++) {
    const best = fastestPair(show, short, long);
    lowest = Math.min(lowest, best.long / best.short);
  }
  return lowest;
}

void describe('URL display is linear (#757 review)', () => {
  for (const build of ADVERSARIAL) {
    void it(`shows ${build(BASE_REPEAT).slice(0, 12)}… in linear time`, () => {
      for (const show of [displayUrl, displayTypedUrl, displayRejectedUrl]) {
        const growth = lowestGrowth(show, build);
        assert.ok(growth < MAX_GROWTH, `${show.name} grew ${growth.toFixed(1)}x for 4x the input`);
      }
    });
  }
});
