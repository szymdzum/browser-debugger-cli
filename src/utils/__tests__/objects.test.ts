import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { filterDefined } from '@/utils/objects.js';

void describe('filterDefined contract', () => {
  void it('removes undefined values while preserving other falsy values', () => {
    const input = {
      name: 'test',
      optional: undefined,
      count: 0,
      empty: '',
      nullable: null,
    };

    const result = filterDefined(input);

    assert.deepEqual(result, {
      name: 'test',
      count: 0,
      empty: '',
      nullable: null,
    });
    assert.equal('optional' in result, false);
  });

  void it('does not mutate the original object', () => {
    const input = { keep: 'value', drop: undefined };

    filterDefined(input);

    assert.deepEqual(input, { keep: 'value', drop: undefined });
  });
});
