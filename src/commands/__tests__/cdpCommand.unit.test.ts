/**
 * `bdg cdp` with a domain name lists its methods, a method whose result
 * reports a page exception fails like `dom eval`, methods missing from the
 * bundled protocol are sent anyway, and `--describe` shows redirects, enums
 * and types.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cdpCallResult,
  handleDescribeMethod,
  isBareDomain,
  methodToSend,
  pageExceptionResult,
} from '@/commands/cdp.js';
import { CommandError } from '@/errors/index.js';
import type { CdpMethodDescription, CdpTypeDescription } from '@/ui/formatters/cdp.js';
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

void describe('methodToSend', () => {
  void it('sends a well-formed method missing from the bundled protocol, with a warning', () => {
    const target = methodToSend('Storage.getRelatedWebsiteSets');
    assert.equal(target.method, 'Storage.getRelatedWebsiteSets');
    assert.match(
      target.warning ?? '',
      /^Storage\.getRelatedWebsiteSets is not in the bundled protocol \(devtools-protocol 0\.0\.\d+\); sending it to Chrome as is$/
    );
  });

  void it('sends bundled methods without a warning', () => {
    assert.deepEqual(methodToSend('network.getcookies'), { method: 'Network.getCookies' });
  });

  void it('stops a close typo with a suggestion (exit 81)', () => {
    assert.throws(
      () => methodToSend('Network.getCookes'),
      (error: unknown) =>
        error instanceof CommandError &&
        error.exitCode === EXIT_CODES.INVALID_ARGUMENTS &&
        /Network\.getCookies/.test(String(error.metadata['suggestion']))
    );
  });

  void it('names --send-anyway in the typo error', () => {
    assert.throws(
      () => methodToSend('Browser.getWindowBound'),
      (error: unknown) =>
        error instanceof CommandError &&
        /bdg cdp Browser\.getWindowBound --send-anyway/.test(String(error.metadata['suggestion']))
    );
  });

  void it('sends a close typo as typed with --send-anyway, with the warning', () => {
    const target = methodToSend('browser.getWindowBound', { sendAnyway: true });
    assert.equal(target.method, 'Browser.getWindowBound');
    assert.match(target.warning ?? '', /not in the bundled protocol/);
  });

  void it('keeps blocking blocked and malformed names with --send-anyway', () => {
    for (const name of ['Page.captureScreenshot', 'getCookies', 'Network.CookieSameSite']) {
      assert.throws(
        () => methodToSend(name, { sendAnyway: true }),
        (error: unknown) =>
          error instanceof CommandError && error.exitCode === EXIT_CODES.INVALID_ARGUMENTS,
        name
      );
    }
  });

  void it('stops a type name and points to --describe (exit 81)', () => {
    assert.throws(
      () => methodToSend('Network.CookieSameSite'),
      (error: unknown) =>
        error instanceof CommandError &&
        error.exitCode === EXIT_CODES.INVALID_ARGUMENTS &&
        /bdg cdp Network\.CookieSameSite --describe/.test(String(error.metadata['suggestion']))
    );
  });

  void it('stops blocked and malformed names (exit 81)', () => {
    for (const name of ['Page.captureScreenshot', 'getCookies']) {
      assert.throws(
        () => methodToSend(name),
        (error: unknown) =>
          error instanceof CommandError && error.exitCode === EXIT_CODES.INVALID_ARGUMENTS,
        name
      );
    }
  });
});

void describe('cdpCallResult', () => {
  void it('puts the warning at the top of a success result', () => {
    const result = cdpCallResult('Foo.bar', { ok: 1 }, 'Foo.bar is not in the bundled protocol');
    assert.equal(result.success, true);
    assert.equal(result.warning, 'Foo.bar is not in the bundled protocol');
    assert.deepEqual(result.data, { method: 'Foo.bar', result: { ok: 1 } });
  });

  void it('keeps the warning when the result reports a page exception', () => {
    const result = cdpCallResult(
      'Foo.evaluate',
      {
        exceptionDetails: {
          exceptionId: 1,
          text: 'Uncaught',
          lineNumber: 0,
          columnNumber: 0,
          exception: { type: 'object', subtype: 'error', description: 'Error: boom' },
        },
      },
      'Foo.evaluate is not in the bundled protocol'
    );
    assert.equal(result.success, false);
    assert.equal(result.exitCode, EXIT_CODES.SCRIPT_ERROR);
    assert.equal(result.warning, 'Foo.evaluate is not in the bundled protocol');
  });
});

void describe('handleDescribeMethod', () => {
  void it('shows the redirect of DOM.highlightNode and its parameters', () => {
    const result = handleDescribeMethod('DOM.highlightNode');
    assert.equal(result.success, true);
    const data = result.data as CdpMethodDescription;
    assert.equal(data.redirect?.method, 'Overlay.highlightNode');
    assert.ok(data.redirect?.parameters.some((p) => p.name === 'highlightConfig'));
  });

  void it('expands the CookieSameSite enum of Network.setCookie', () => {
    const data = handleDescribeMethod('Network.setCookie').data as CdpMethodDescription;
    const sameSite = data.parameters.find((p) => p.name === 'sameSite');
    assert.deepEqual(sameSite?.enum, ['Strict', 'Lax', 'None']);
    assert.equal(sameSite?.ref, 'Network.CookieSameSite');
  });

  void it('describes a type', () => {
    const result = handleDescribeMethod('Network.CookieSameSite');
    assert.equal(result.success, true);
    const data = result.data as CdpTypeDescription;
    assert.equal(data.type, 'type');
    assert.equal(data.name, 'Network.CookieSameSite');
    assert.deepEqual(data.enum, ['Strict', 'Lax', 'None']);
  });

  void it('says an unknown well-formed method can still be sent', () => {
    const result = handleDescribeMethod('Storage.getRelatedWebsiteSets');
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /not in the bundled protocol/);
    assert.match(String(result.errorContext?.['suggestion']), /sends it to Chrome as is/);
  });
});
