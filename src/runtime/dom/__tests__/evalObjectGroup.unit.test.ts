/**
 * `dom eval` results: evals that run at the same time do not free each
 * other's result before it is copied (#584).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FakeObjectPage } from '@/__testutils__/fakeObjectPage.js';
import type { CDPConnection } from '@/connection/cdp.js';
import { evaluateScript } from '@/runtime/dom/evalHelpers.js';
import { wrapEvalScript } from '@/runtime/dom/evalSource.js';

void describe('evaluateScript', () => {
  void it('copies the results of concurrent evals when one releases its objects first (#584)', async () => {
    const page = new FakeObjectPage({
      lookupsFirst: 2,
      hold: (method, params) =>
        method === 'Runtime.evaluate' && params['expression'] === wrapEvalScript('second'),
      callResult: () => ({ result: { type: 'object', value: { copy: { copied: true } } } }),
      releaseFreesHeld: (objectGroup) => objectGroup.startsWith('bdg-eval'),
    });
    const cdp = page as unknown as CDPConnection;
    const evals = await Promise.allSettled([
      evaluateScript(cdp, 'first'),
      evaluateScript(cdp, 'second'),
    ]);
    assert.deepEqual(
      evals.map((result) =>
        result.status === 'rejected' ? String(result.reason) : result.value.value
      ),
      [{ copied: true }, { copied: true }]
    );
    assert.deepEqual(page.releasedUses, []);
  });
});
