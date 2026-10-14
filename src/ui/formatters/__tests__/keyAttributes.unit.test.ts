/**
 * `shortId`: an id on one line inside `id="..."`, unambiguous and cut
 * without splitting an escape (#586).
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shortId } from '@/ui/formatters/keyAttributes.js';

void describe('shortId', () => {
  void it('leaves a plain id and one with a space as written', () => {
    assert.equal(shortId('x'), 'x');
    assert.equal(shortId('a b'), 'a b');
  });

  void it('escapes line breaks, tabs, quotes and control characters', () => {
    assert.equal(shortId('a\nb\r\nc\td'), 'a\\nb\\r\\nc\\td');
    assert.equal(shortId('a"b'), 'a\\"b');
    assert.equal(shortId('a\u001bb'), 'a\\u001bb');
  });

  void it('escapes a backslash, so it differs from the escapes it could imitate', () => {
    assert.equal(shortId('a\\nb'), 'a\\\\nb');
    assert.notEqual(shortId('a\\nb'), shortId('a\nb'));
    assert.equal(shortId('a\\"'), 'a\\\\\\"');
  });

  void it('cuts a long id to about 40 characters', () => {
    const cut = shortId('a'.repeat(300));
    assert.ok(cut.length <= 40, cut);
    assert.match(cut, /^a+…a+$/u);
  });

  void it('never splits an escape at the cut', () => {
    for (const piece of ['\n', '"', '\\', '\u001b']) {
      for (let before = 0; before < 45; before++) {
        const id = `${'a'.repeat(before)}${piece.repeat(40)}${'b'.repeat(before)}`;
        const [head = '', tail = ''] = shortId(id).split('…');
        const unescaped = `${head}${tail}`.replace(/\\(\\|"|n|r|t|u[0-9a-f]{4})/g, '');
        assert.equal(unescaped.includes('\\'), false, `${before} ${JSON.stringify(piece)}`);
      }
    }
  });
});
