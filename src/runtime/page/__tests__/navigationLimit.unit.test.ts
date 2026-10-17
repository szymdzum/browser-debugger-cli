import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pageReadyTimeoutMs } from '@/runtime/page/navigation.js';

void describe('navigation time limit', () => {
  void it('keeps the production default without an override', () => {
    assert.equal(pageReadyTimeoutMs({}), 15_000);
  });

  void it('takes a shorter limit from BDG_TEST_PAGE_READY_MS', () => {
    assert.equal(pageReadyTimeoutMs({ BDG_TEST_PAGE_READY_MS: '3000' }), 3_000);
  });

  void it('ignores values that are not whole milliseconds between 1000 and the default', () => {
    for (const bad of ['', 'abc', '-5', '1.5', '3e3', '999', '15001', '0x10', ' 3000']) {
      assert.equal(
        pageReadyTimeoutMs({ BDG_TEST_PAGE_READY_MS: bad }),
        15_000,
        JSON.stringify(bad)
      );
    }
  });
});
