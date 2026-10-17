/**
 * Suggestions for `bdg eval` scripts that threw.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { scriptExecutionError } from '@/errors/messages.js';

void describe('scriptExecutionError()', () => {
  void it('explains a redeclared name instead of suspecting stripped quotes', () => {
    const { suggestion } = scriptExecutionError(
      "SyntaxError: Identifier 'x' has already been declared",
      'const x = 2.5; Math.round(x)'
    );

    assert.doesNotMatch(suggestion, /quote damage/);
    assert.doesNotMatch(suggestion, /Math\.round\("x"\)/);
    assert.match(suggestion, /'x' is already declared in this script/);
    assert.doesNotMatch(suggestion, /wrap the script in a block/);
  });

  void it('suggests quoting a selector the shell left bare', () => {
    const { suggestion } = scriptExecutionError(
      'ReferenceError: input is not defined\n    at <anonymous>:1:24',
      'document.querySelector(input)'
    );

    assert.match(suggestion, /Shell quote damage detected/);
    assert.match(suggestion, /document\.querySelector\("input"\)/);
  });

  void it('leaves an undefined variable outside a selector method alone', () => {
    const { suggestion } = scriptExecutionError(
      'ReferenceError: x is not defined\n    at <anonymous>:1:12',
      'Math.round(x)'
    );

    assert.doesNotMatch(suggestion, /quote damage/);
  });
});
