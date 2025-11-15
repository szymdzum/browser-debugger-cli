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

  void it('returns empty object when all properties are undefined', () => {
    const input = { a: undefined, b: undefined };
    const result = filterDefined(input);

    assert.deepEqual(result, {});
    assert.equal(Object.keys(result).length, 0);
  });

  void it('only performs a shallow filter', () => {
    const input = {
      nested: {
        value: undefined,
        keep: 'nested',
      },
      shallow: undefined,
    };

    const result = filterDefined(input);

    assert.deepEqual(result, {
      nested: {
        value: undefined,
        keep: 'nested',
      },
    });
  });
});
