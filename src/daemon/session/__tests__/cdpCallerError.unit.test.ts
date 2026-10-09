/**
 * How `bdg cdp` reports the errors Chrome returns for a call.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CDPProtocolError } from '@/connection/errors.js';
import { callerError } from '@/daemon/session/commandRegistry.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('callerError', () => {
  void it("says this Chrome doesn't implement a method it doesn't know (-32601, exit 83)", () => {
    const error = callerError(
      'Storage.fooBar',
      new CDPProtocolError("'Storage.fooBar' wasn't found", -32601, undefined)
    );
    assert.equal(error?.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.equal(
      error?.message,
      "This Chrome doesn't implement Storage.fooBar ('Storage.fooBar' wasn't found)"
    );
    const suggestion = String(error?.metadata['suggestion']);
    assert.doesNotMatch(suggestion, /--describe/);
    assert.match(suggestion, /bdg cdp --search/);
  });

  void it('says when the bundled protocol is newer than this Chrome', () => {
    const error = callerError(
      'FindInPage.findFirst',
      new CDPProtocolError("'FindInPage.findFirst' wasn't found", -32601, undefined)
    );
    assert.equal(error?.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.match(String(error?.metadata['suggestion']), /bundled protocol/);
  });

  void it('says a domain neither the bundled protocol nor Chrome has is unknown', () => {
    const error = callerError(
      'Foo.bar',
      new CDPProtocolError("'Foo.bar' wasn't found", -32601, undefined)
    );
    assert.equal(error?.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.match(String(error?.message), /^Unknown CDP domain Foo:/);
    assert.match(String(error?.metadata['suggestion']), /bdg cdp --list/);
  });

  void it('suggests the domain an unknown one is a typo of', () => {
    const error = callerError(
      'Ntwrk.getCookies',
      new CDPProtocolError("'Ntwrk.getCookies' wasn't found", -32601, undefined)
    );
    assert.match(String(error?.message), /^Unknown CDP domain Ntwrk:/);
    assert.match(String(error?.metadata['suggestion']), /Did you mean: Network\?/);
  });

  void it('names the missing redirect target instead of blaming an older Chrome', () => {
    const error = callerError(
      'Page.deleteCookie',
      new CDPProtocolError("'Network.deleteCookie' wasn't found", -32601, undefined)
    );
    assert.equal(error?.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.match(String(error?.message), /redirects it to Network\.deleteCookie/);
    const suggestion = String(error?.metadata['suggestion']);
    assert.doesNotMatch(suggestion, /older/);
    assert.match(suggestion, /Network\.deleteCookies/);
  });

  void it('says method names are case-sensitive for a method typed in one case', () => {
    const error = callerError(
      'Storage.getrelatedwebsitesets',
      new CDPProtocolError("'Storage.getrelatedwebsitesets' wasn't found", -32601, undefined)
    );
    assert.equal(error?.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    const suggestion = String(error?.metadata['suggestion']);
    assert.match(suggestion, /case-sensitive for methods bdg doesn't know/);
    assert.match(suggestion, /lowerCamelCase/);
  });

  void it('gives no case hint for a method typed in camelCase', () => {
    const error = callerError(
      'Storage.getRelatedWebsiteSet',
      new CDPProtocolError("'Storage.getRelatedWebsiteSet' wasn't found", -32601, undefined)
    );
    assert.doesNotMatch(String(error?.metadata['suggestion']), /lowerCamelCase/);
  });

  void it('keeps pointing wrong parameters to --describe (exit 81)', () => {
    const error = callerError(
      'DOM.getBoxModel',
      new CDPProtocolError('Invalid parameters', -32602, 'Failed to deserialize params')
    );
    assert.equal(error?.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(String(error?.metadata['suggestion']), /bdg cdp DOM\.getBoxModel --describe/);
  });
});
