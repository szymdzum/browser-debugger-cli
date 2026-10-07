/**
 * Unit tests for `--json` envelope serialization.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { stringifyEnvelope } from '@/ui/OutputBuilder.js';

const originalIsTTY = process.stdout.isTTY;

/**
 * Make stdout look like a terminal or a pipe.
 *
 * @param isTTY - Whether stdout is a terminal
 */
function setStdoutTTY(isTTY: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true });
}

void describe('stringifyEnvelope', () => {
  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  const envelope = { version: '1.0.0', success: true, data: { items: [1, 2] } };

  void it('prints one line when stdout is not a terminal', () => {
    setStdoutTTY(false);
    assert.equal(
      stringifyEnvelope(envelope),
      '{"version":"1.0.0","success":true,"data":{"items":[1,2]}}'
    );
  });

  void it('indents by two spaces when stdout is a terminal', () => {
    setStdoutTTY(true);
    assert.equal(stringifyEnvelope(envelope), JSON.stringify(envelope, null, 2));
  });
});
