import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  extractHostnameWithPath,
  normalizeUrl,
  safeParseUrl,
  validateChromeWsUrl,
  validateUrl,
} from '@/utils/url.js';

void describe('URL utility contracts', () => {
  void it('normalizes mixed-case protocols without duplicating prefix', () => {
    const result = normalizeUrl('HTTPS://Example.com/Path?x=1');
    assert.equal(result, 'https://Example.com/Path?x=1');

    const fileUrl = normalizeUrl('FILE:///Users/Test/index.html');
    assert.equal(fileUrl, 'file:///Users/Test/index.html');
  });

  void it('accepts data URLs but not javascript: URLs as a start page', () => {
    assert.equal(validateUrl('javascript:alert(1)').valid, false);

    const dataResult = validateUrl('data:text/plain,hello');
    assert.equal(dataResult.valid, true);
  });

  void it('rejects unsupported schemes and hostnames without letters or digits', () => {
    assert.equal(validateUrl('ftp://example.com').valid, false);
    assert.equal(validateUrl('ws://example.com').valid, false);
    assert.equal(validateUrl('-').valid, false);
    assert.equal(validateUrl('localhost:3000').valid, true);
    assert.equal(validateUrl('HTTPS://example.com').valid, true);
  });

  void it('rejects malformed protocols before normalization', () => {
    const result = validateUrl('ht!tp://example.com');
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.match(result.error, /invalid characters/i);
    }
  });

  void it('includes port information when extracting hostname with path', () => {
    const parsed = extractHostnameWithPath('http://localhost:9222/devtools/page/123');
    assert.equal(parsed, 'localhost:9222/devtools/page/123');
  });

  void it('safeParseUrl returns null for invalid inputs and adds protocol when missing', () => {
    const parsed = safeParseUrl('example.com/path');
    assert(parsed);
    assert.equal(parsed?.protocol, 'http:');
    assert.equal(parsed?.hostname, 'example.com');

    const invalid = safeParseUrl('::::');
    assert.equal(invalid, null);
  });

  void it('always adds protocol when missing', () => {
    const inputs = ['localhost:3000', 'example.com', 'foo.bar/baz'];
    for (const input of inputs) {
      const normalized = normalizeUrl(input);
      assert.match(normalized, /^http:\/\//);
    }
  });
});

void describe('validateChromeWsUrl', () => {
  void it('accepts a well-formed ws:// URL', () => {
    const result = validateChromeWsUrl('ws://127.0.0.1:9222/devtools/browser/abc-123');
    assert.equal(result.valid, true);
  });

  void it('accepts a wss:// URL', () => {
    const result = validateChromeWsUrl('wss://remote.host:9999/devtools/browser/xyz');
    assert.equal(result.valid, true);
  });

  void it('rejects empty input', () => {
    const result = validateChromeWsUrl('   ');
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.match(result.error, /cannot be empty/i);
    }
  });

  void it('rejects non-URL garbage', () => {
    const result = validateChromeWsUrl('not a url');
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.match(result.error, /not a valid url/i);
    }
  });

  void it('rejects http:// scheme with a hint for the same host', () => {
    const result = validateChromeWsUrl('http://127.0.0.1:9333/json');
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.match(result.error, /ws:\/\/ or wss:\/\//);
      assert.match(result.suggestion ?? '', /127\.0\.0\.1:9333\/json\/version/);
    }
  });

  void it('requires a browser or page path', () => {
    assert.equal(validateChromeWsUrl('ws://127.0.0.1:9222').valid, false);
    assert.equal(validateChromeWsUrl('ws://127.0.0.1:9222/devtools/page/ABC').valid, true);
  });
});
