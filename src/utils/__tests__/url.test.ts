import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractHostnameWithPath, normalizeUrl, validateUrl } from '@/utils/url.js';

void describe('URL utility contracts', () => {
  void it('normalizes mixed-case protocols without duplicating prefix', () => {
    const result = normalizeUrl('HTTPS://Example.com/Path?x=1');
    assert.equal(result, 'https://Example.com/Path?x=1');

    const fileUrl = normalizeUrl('FILE:///Users/Test/index.html');
    assert.equal(fileUrl, 'file:///Users/Test/index.html');
  });

  void it('accepts javascript and data URLs when validating', () => {
    const jsResult = validateUrl('javascript:alert(1)');
    assert.equal(jsResult.valid, true);

    const dataResult = validateUrl('data:text/plain,hello');
    assert.equal(dataResult.valid, true);
  });

  void it('includes port information when extracting hostname with path', () => {
    const parsed = extractHostnameWithPath('http://localhost:9222/devtools/page/123');
    assert.equal(parsed, 'localhost:9222/devtools/page/123');
  });
});
