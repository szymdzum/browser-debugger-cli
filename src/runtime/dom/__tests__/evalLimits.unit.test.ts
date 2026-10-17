import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evalTimeoutMs, terminationGraceMs, unsentGraceMs } from '@/runtime/dom/evalLimits.js';

void describe('eval limits', () => {
  void it('keeps the production defaults without an override', () => {
    assert.equal(evalTimeoutMs({}), 20_000);
    assert.equal(terminationGraceMs({}), 5_000);
    assert.equal(unsentGraceMs({}), 12_000);
  });

  void it('takes a shorter limit from the BDG_TEST_ variables', () => {
    assert.equal(evalTimeoutMs({ BDG_TEST_EVAL_TIMEOUT_MS: '2000' }), 2_000);
    assert.equal(terminationGraceMs({ BDG_TEST_EVAL_GRACE_MS: '500' }), 500);
    assert.equal(unsentGraceMs({ BDG_TEST_EVAL_UNSENT_GRACE_MS: '3000' }), 3_000);
  });

  void it('ignores values that are not whole milliseconds between 100 and the default', () => {
    for (const bad of ['', 'abc', '-5', '1.5', '2e3', '50', '20001', '0x10', ' 2000']) {
      assert.equal(evalTimeoutMs({ BDG_TEST_EVAL_TIMEOUT_MS: bad }), 20_000, JSON.stringify(bad));
      assert.equal(terminationGraceMs({ BDG_TEST_EVAL_GRACE_MS: bad }), 5_000, JSON.stringify(bad));
      assert.equal(
        unsentGraceMs({ BDG_TEST_EVAL_UNSENT_GRACE_MS: bad }),
        12_000,
        JSON.stringify(bad)
      );
    }
  });
});
