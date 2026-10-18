/**
 * Parsing a logpoint location (`file:line[:col]`) and matching the file
 * against script URLs (#848). Every row of the tables is one cell of the
 * case matrix.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseLogpointLocation, scriptUrlPattern } from '@/utils/logpointLocation.js';

const PARSE_CASES: Array<[string, ReturnType<typeof parseLogpointLocation>]> = [
  ['app.js:5', { file: 'app.js', line: 5 }],
  ['app.js:5:12', { file: 'app.js', line: 5, column: 12 }],
  ['src/cart/app.js:42', { file: 'src/cart/app.js', line: 42 }],
  ['http://localhost:8080/app.js:5', { file: 'http://localhost:8080/app.js', line: 5 }],
  [
    'http://localhost:8080/app.js:5:3',
    { file: 'http://localhost:8080/app.js', line: 5, column: 3 },
  ],
  ['C:\\src\\app.js:5', { file: 'C:\\src\\app.js', line: 5 }],
  ['C:\\src\\app.js:5:2', { file: 'C:\\src\\app.js', line: 5, column: 2 }],
  ['app.js?v=1:5', { file: 'app.js?v=1', line: 5 }],
  ['my%20file.js:7', { file: 'my%20file.js', line: 7 }],
  ['my file.js:7', { file: 'my file.js', line: 7 }],
  ['app.js', undefined],
  ['app.js:', undefined],
  ['app.js:x', undefined],
  ['app.js:0', undefined],
  ['app.js:5:0', undefined],
  [':5', undefined],
  ['app.js:-1', undefined],
  ['app.js:1.5', undefined],
];

const MATCH_CASES: Array<[file: string, url: string, matches: boolean]> = [
  ['app.js', 'http://h/app.js', true],
  ['app.js', 'http://h/dist/app.js', true],
  ['app.js', 'http://h/app.js?v=1', true],
  ['app.js', 'http://h/app.js#frag', true],
  ['app.js', 'http://h/app.js?v=1#frag', true],
  ['app.js', 'http://h/myapp.js', false],
  ['app.js', 'http://h/app.js.map', false],
  ['app.js', 'http://h/app.jsx', false],
  ['dist/app.js', 'http://h/dist/app.js', true],
  ['dist/app.js', 'http://h/src/app.js', false],
  ['app.js', 'http://h:8080/a/app.js', true],
  ['http://h:8080/app.js', 'http://h:8080/app.js', true],
  ['http://h:8080/app.js', 'http://h:8080/x/app.js', false],
  ['app.js', 'http://h/?file=app.js', false],
  ['my file.js', 'http://h/my%20file.js', true],
  ['my%20file.js', 'http://h/my%20file.js', true],
  ['a+b.js', 'http://h/a+b.js', true],
  ['a+b.js', 'http://h/aab.js', false],
  ['C:\\src\\app.js', 'file:///C:/src/app.js', true],
  ['src\\app.js', 'http://h/src/app.js', true],
  ['app.js', 'http://h/one/app.js', true],
  ['app.js', 'http://h/two/app.js', true],
];

void describe('logpoint location', () => {
  for (const [text, expected] of PARSE_CASES) {
    void it(`parses ${JSON.stringify(text)}`, () => {
      assert.deepEqual(parseLogpointLocation(text), expected);
    });
  }
});

void describe('logpoint script URL pattern', () => {
  for (const [file, url, matches] of MATCH_CASES) {
    void it(`${JSON.stringify(file)} ${matches ? 'matches' : 'does not match'} ${url}`, () => {
      assert.equal(new RegExp(scriptUrlPattern(file)).test(url), matches);
    });
  }
});
