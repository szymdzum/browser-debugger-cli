/**
 * The page reports why a secret field is invalid as its validity flags and
 * length limits (#643), never as the browser's text (which gives the
 * value's length).
 *
 * The script runs here in an isolated VM context on element-like objects.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { VALIDITY_REPORT_JS } from '@/runtime/dom/elementInfo.js';

const report = vm.runInNewContext(`(${VALIDITY_REPORT_JS})`) as (el: unknown) => unknown;

void describe('VALIDITY_REPORT_JS', () => {
  void it('lists the flags that are set with the length limits the field declares', () => {
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          report({ validity: { valid: false, tooShort: true }, minLength: 8, maxLength: -1 })
        )
      ),
      { states: ['tooShort'], minLength: 8 }
    );
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          report({
            validity: { valid: false, valueMissing: true, patternMismatch: true },
            minLength: -1,
            maxLength: 20,
          })
        )
      ),
      { states: ['valueMissing', 'patternMismatch'], maxLength: 20 }
    );
  });

  void it('reports no flag for an element without validity', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(report({}))), { states: [] });
  });
});
