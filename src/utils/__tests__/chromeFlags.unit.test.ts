/**
 * Unit tests for the Chrome flag list parser shared by `BDG_CHROME_FLAGS`
 * and `--chrome-flags` (#657).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseChromeFlags } from '@/utils/chromeFlags.js';

void describe('parseChromeFlags', () => {
  void it('splits on spaces', () => {
    assert.deepEqual(parseChromeFlags('--a --b=1'), ['--a', '--b=1']);
  });

  void it('drops the empty strings that repeated or edge spaces leave', () => {
    assert.deepEqual(parseChromeFlags('  --a   --b '), ['--a', '--b']);
  });

  void it('returns no flags for undefined and for an empty string', () => {
    assert.deepEqual(parseChromeFlags(undefined), []);
    assert.deepEqual(parseChromeFlags(''), []);
  });
});
