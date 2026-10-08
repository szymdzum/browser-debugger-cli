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
      'Foo.bar',
      new CDPProtocolError("'Foo.bar' wasn't found", -32601, undefined)
    );
    assert.equal(error?.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.equal(error?.message, "This Chrome doesn't implement Foo.bar ('Foo.bar' wasn't found)");
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

  void it('keeps pointing wrong parameters to --describe (exit 81)', () => {
    const error = callerError(
      'DOM.getBoxModel',
      new CDPProtocolError('Invalid parameters', -32602, 'Failed to deserialize params')
    );
    assert.equal(error?.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(String(error?.metadata['suggestion']), /bdg cdp DOM\.getBoxModel --describe/);
  });
});
