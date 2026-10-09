/**
 * Short source locations, as `bdg console` and action results print them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatSourceLocation, shortUrlName } from '@/ui/formatters/console/shared.js';

void describe('shortUrlName', () => {
  void it('names the file of the URL path', () => {
    assert.equal(shortUrlName('https://app.test/js/app.js'), 'app.js');
  });

  void it('leaves out the query and hash, also when they contain slashes', () => {
    assert.equal(shortUrlName('https://app.test/a?next=/x/y'), 'a');
    assert.equal(shortUrlName('https://app.test/app.js#/route/b'), 'app.js');
  });

  void it('names the host when the path has no file name', () => {
    assert.equal(shortUrlName('https://app.test/'), 'app.test');
    assert.equal(shortUrlName('http://127.0.0.1:8449/'), '127.0.0.1:8449');
  });

  void it('keeps a text that is not a URL whole', () => {
    assert.equal(shortUrlName('app.js'), 'app.js');
  });
});

void describe('formatSourceLocation', () => {
  void it('names the host for a page URL ending in a slash', () => {
    const frame = { url: 'https://app.test/', lineNumber: 2, columnNumber: 141, scriptId: '1' };
    assert.equal(formatSourceLocation([frame]), 'app.test:3:142');
  });

  void it('names the file without a query that contains slashes', () => {
    const frame = {
      url: 'https://app.test/a?next=/x/y',
      lineNumber: 0,
      columnNumber: 0,
      scriptId: '1',
    };
    assert.equal(formatSourceLocation([frame]), 'a:1:1');
  });
});
