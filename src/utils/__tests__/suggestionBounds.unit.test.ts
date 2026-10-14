/**
 * Bounds of "did you mean" (#741): a word is only matched to a close
 * candidate, and the case it was typed in does not matter.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { navigationFailedError } from '@/errors/messages.js';
import { findSimilar, findSimilarCommands } from '@/utils/suggestions.js';
import { validateUrl } from '@/utils/url.js';

const COMMANDS = ['cdp', 'dom', 'help', 'network', 'page', 'peek', 'status', 'stop', 'tabs'];

void describe('findSimilarCommands', () => {
  void it('suggests nothing for words 2 or more edits from every command', () => {
    for (const word of ['foo', 'bdg', 'blorp', 'ab']) {
      assert.deepEqual(findSimilarCommands(word, COMMANDS), [], word);
    }
  });

  void it('folds case before measuring the distance', () => {
    for (const word of ['PEEK', 'Peek', 'pEEk']) {
      assert.deepEqual(findSimilarCommands(word, COMMANDS), ['peek'], word);
    }
  });

  void it('still suggests a close typo', () => {
    assert.deepEqual(findSimilarCommands('netwrk', COMMANDS), ['network']);
    assert.deepEqual(findSimilarCommands('stats', COMMANDS), ['status']);
    assert.deepEqual(findSimilarCommands('dmo', COMMANDS), ['dom']);
    assert.deepEqual(findSimilarCommands('hello', COMMANDS), []);
  });
});

void describe('findSimilar', () => {
  void it('scales the default bound with the word length', () => {
    assert.deepEqual(findSimilar('dark', ['light', 'dark', 'auto']), []);
    assert.deepEqual(findSimilar('drk', ['light', 'dark', 'auto']), ['dark']);
    assert.deepEqual(findSimilar('drak', ['light', 'dark', 'auto']), ['dark']);
    assert.deepEqual(findSimilar('ligt', ['light', 'dark', 'auto']), ['light']);
  });
});

void describe('start URL errors', () => {
  void it('names the port, not the protocol, for a non-numeric port', () => {
    for (const url of ['localhost:abc', 'localhost:99999', 'http://localhost:abc']) {
      const result = validateUrl(url);
      assert.equal(result.valid, false, url);
      assert.match(result.error ?? '', /port/i, url);
      assert.doesNotMatch(result.suggestion ?? '', /protocol/i, url);
    }
  });

  void it('keeps the protocol message for other malformed URLs', () => {
    const result = validateUrl('http://');
    assert.equal(result.valid, false);
    assert.match(result.valid ? '' : result.error, /Invalid URL format|hostname/);
  });

  void it('skips userinfo and never echoes it', () => {
    for (const url of [
      'http://user:BASICPW46@127.0.0.1:51617/secret-names',
      'http://u:PW-BASIC-623@127.0.0.1/url-creds?token=x',
      'http://u:p@w@localhost:3000/',
    ]) {
      assert.equal(validateUrl(url).valid, true, url);
    }
    const bad = validateUrl('http://u:PW-SECRET@localhost:abc');
    assert.equal(bad.valid, false);
    const text = JSON.stringify(bad);
    assert.match(text, /Invalid port: 'abc'/);
    assert.doesNotMatch(text, /PW-SECRET/);
  });

  void it('accepts an empty port and other schemes', () => {
    for (const url of ['localhost:', 'about:blank', 'localhost:3000', 'http://localhost:3000']) {
      assert.equal(validateUrl(url).valid, true, url);
    }
  });

  void it('shows the added-http:// hint only for errors a scheme can cause', () => {
    const unsafe = navigationFailedError('http://localhost:1', 'net::ERR_UNSAFE_PORT', true);
    assert.doesNotMatch(unsafe.suggestion, /added|https:/);
    for (const text of ['ERR_SSL_PROTOCOL_ERROR', 'ERR_EMPTY_RESPONSE', 'ERR_CONNECTION_RESET']) {
      const err = navigationFailedError('http://localhost', `net::${text}`, true);
      assert.match(err.suggestion, /added http:\/\//, text);
    }
  });

  void it('says bdg added http:// and offers https:// when it did', () => {
    const added = navigationFailedError('http://localhost', 'net::ERR_CONNECTION_REFUSED', true);
    assert.match(`${added.message} ${added.suggestion}`, /added http:\/\//);
    assert.match(added.suggestion, /https:\/\/localhost/);
  });

  void it('does not mention http:// when the user typed the scheme', () => {
    const typed = navigationFailedError('http://localhost', 'net::ERR_CONNECTION_REFUSED');
    assert.doesNotMatch(`${typed.message} ${typed.suggestion}`, /added/);
  });
});
