/**
 * Page URLs as bdg shows them (#623): `user:pass@` removed, secret-named
 * query and fragment parameters masked, the rest byte for byte;
 * `--include-sensitive` shows the parameters but never the user info.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { displayUrl, displayUrls } from '@/utils/displayUrl.js';

const MASK = '••••';

/** URL shapes × what is shown by default and with --include-sensitive */
const CASES: Array<{ url: string; shown: string; sensitive: string }> = [
  {
    url: 'http://bob:PW@host/p',
    shown: 'http://host/p',
    sensitive: 'http://host/p',
  },
  {
    url: 'http://host/p?token=T',
    shown: `http://host/p?token=${MASK}`,
    sensitive: 'http://host/p?token=T',
  },
  {
    url: 'http://host/p?access_token=T&code=C',
    shown: `http://host/p?access_token=${MASK}&code=${MASK}`,
    sensitive: 'http://host/p?access_token=T&code=C',
  },
  {
    url: 'http://host/p#id_token=T',
    shown: `http://host/p#id_token=${MASK}`,
    sensitive: 'http://host/p#id_token=T',
  },
  {
    url: 'http://host/p?password=P&cc-number=4111111111111111',
    shown: `http://host/p?password=${MASK}&cc-number=${MASK}`,
    sensitive: 'http://host/p?password=P&cc-number=4111111111111111',
  },
  {
    url: 'http://host/p?q=plain&page=2',
    shown: 'http://host/p?q=plain&page=2',
    sensitive: 'http://host/p?q=plain&page=2',
  },
  {
    url: 'ws://host/ws?token=T',
    shown: `ws://host/ws?token=${MASK}`,
    sensitive: 'ws://host/ws?token=T',
  },
  {
    url: 'http://bob:PW@host/p?token=T&q=plain#id_token=T',
    shown: `http://host/p?token=${MASK}&q=plain#id_token=${MASK}`,
    sensitive: 'http://host/p?token=T&q=plain#id_token=T',
  },
];

void describe('displayUrl', () => {
  for (const { url, shown, sensitive } of CASES) {
    void it(`shows ${url} as ${shown}`, () => {
      assert.equal(displayUrl(url), shown);
    });

    void it(`shows ${url} with --include-sensitive as ${sensitive}`, () => {
      assert.equal(displayUrl(url, true), sensitive);
    });
  }

  for (const includeSensitive of [false, true]) {
    const mode = includeSensitive ? 'with' : 'without';
    void it(`removes the user info of a URL nested in a query value, ${mode} --include-sensitive`, () => {
      assert.equal(
        displayUrl('http://host/login?next=http://u:p@x/path&q=plain', includeSensitive),
        'http://host/login?next=http://x/path&q=plain'
      );
      assert.equal(
        displayUrl('http://host/login?next=http%3A%2F%2Fu%3Ap%40x%2Fpath', includeSensitive),
        'http://host/login?next=http%3A%2F%2Fx%2Fpath'
      );
      assert.equal(
        displayUrl('http://host/p#return=//u:p@x/', includeSensitive),
        'http://host/p#return=//x/'
      );
    });

    void it(`removes the user info of the URL a blob: URL wraps, ${mode} --include-sensitive`, () => {
      assert.equal(
        displayUrl('blob:http://u:p@h/550e8400-e29b', includeSensitive),
        'blob:http://h/550e8400-e29b'
      );
    });
  }

  void it('keeps an @ that is not the user info of a nested URL', () => {
    for (const url of [
      'http://host/p?q=a+b//c@d',
      'http://host/p#/users//a@b',
      'http://host/p?to=me@x.test',
    ]) {
      assert.equal(displayUrl(url), url);
      assert.equal(displayUrl(url, true), url);
    }
  });

  void it('keeps the encoding of the untouched characters of a nested URL', () => {
    assert.equal(
      displayUrl('http://host/p?next=http%3A%2F%2Fu%3Ap%40x%2Fa+b%20c'),
      'http://host/p?next=http%3A%2F%2Fx%2Fa+b%20c'
    );
  });

  void it('leaves a URL without a query, fragment or user info alone', () => {
    for (const url of ['about:blank', '', 'http://host/', 'data:text/html,<p>x</p>']) {
      assert.equal(displayUrl(url), url);
    }
  });

  void it('is idempotent', () => {
    const once = displayUrl('http://bob:PW@host/p?token=T#id_token=T');
    assert.equal(displayUrl(once), once);
  });
});

void describe('displayUrls', () => {
  void it('maps the url of each item and keeps the other fields', () => {
    const items = [
      { url: 'http://bob:PW@host/a?token=T', id: 1 },
      { url: 'http://host/b?q=plain', id: 2 },
    ];
    assert.deepEqual(displayUrls(items), [
      { url: `http://host/a?token=${MASK}`, id: 1 },
      { url: 'http://host/b?q=plain', id: 2 },
    ]);
    assert.deepEqual(displayUrls(items, true), [
      { url: 'http://host/a?token=T', id: 1 },
      { url: 'http://host/b?q=plain', id: 2 },
    ]);
  });
});
