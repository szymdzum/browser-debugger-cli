/**
 * `bdg cdp` with a domain name lists its methods, and a method whose result
 * reports a page exception fails like `dom eval`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isBareDomain, pageExceptionResult } from '@/commands/cdp.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('isBareDomain', () => {
  void it('takes a domain name alone as a request for its methods', () => {
    assert.equal(isBareDomain('Network', {}), true);
    assert.equal(isBareDomain('network', {}), true);
  });

  void it('leaves methods, unknown names and calls with parameters alone', () => {
    assert.equal(isBareDomain('Network.enable', {}), false);
    assert.equal(isBareDomain('Netwrk', {}), false);
    assert.equal(isBareDomain('Network', { params: '{}' }), false);
    assert.equal(isBareDomain('getCookies', { describe: true }), false);
  });
});

void describe('pageExceptionResult', () => {
  void it('fails with the exception text and exit 91', () => {
    const result = pageExceptionResult({
      result: { type: 'object', subtype: 'error' },
      exceptionDetails: {
        exceptionId: 1,
        text: 'Uncaught',
        lineNumber: 0,
        columnNumber: 4,
        exception: {
          type: 'object',
          subtype: 'error',
          description: "SyntaxError: Unexpected token ')'",
        },
      },
    });
    assert.equal(result?.success, false);
    assert.equal(result?.exitCode, EXIT_CODES.SCRIPT_ERROR);
    assert.match(result?.error ?? '', /SyntaxError: Unexpected token/);
  });

  void it('passes results without an exception', () => {
    assert.equal(pageExceptionResult({ result: { type: 'string', value: 'x' } }), undefined);
    assert.equal(pageExceptionResult(undefined), undefined);
  });
});
