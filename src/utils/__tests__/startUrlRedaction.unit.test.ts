/**
 * Start errors never echo URL credentials (#757): the formatter, the URL
 * validation messages and the "Could not load" error, for every input of
 * the case matrix.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { navigationFailedError } from '@/errors/messages.js';
import { displayTypedUrl } from '@/utils/displayUrl.js';
import { normalizeUrl, validateUrl } from '@/utils/url.js';

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
];

void describe('displayTypedUrl (#757)', () => {
  for (const { url, host } of CASES) {
    void it(`hides the secret of ${url}`, () => {
      const shown = displayTypedUrl(url);
      assert.doesNotMatch(shown, SECRET);
      assert.ok(shown.includes(host), `${shown} names ${host}`);
    });
  }

  void it('keeps a URL without credentials byte for byte', () => {
    for (const url of ['localhost:3000/a?q=1', 'http://example.com/', 'about:blank', 'data:,a@b']) {
      assert.equal(displayTypedUrl(url), url);
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
  for (const { url, host } of CASES) {
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
