/**
 * `dom fill` on a `<select>` whose option was not found names the option
 * and lists the options, unless the select holds a secret (#625): then
 * neither the option looked for nor the options are shown, only how many
 * there are.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { optionNotFoundError } from '@/errors/messages.js';

void describe('optionNotFoundError', () => {
  void it('names the option and lists the options of an ordinary select', () => {
    assert.deepEqual(optionNotFoundError({ count: 2, value: 'xl', options: ['s', 'm (Medium)'] }), {
      message: 'Option not found: xl',
      suggestion: 'Available options: s, m (Medium)',
    });
  });

  void it('says how many options a secret select has, naming none', () => {
    const err = optionNotFoundError({ count: 2 });
    assert.equal(err.message, 'Option not found');
    assert.match(err.suggestion, /^2 options available/);
    assert.match(optionNotFoundError({ count: 1 }).suggestion, /^1 option available/);
  });
});
