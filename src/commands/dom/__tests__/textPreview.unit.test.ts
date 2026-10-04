/**
 * Text previews of queried elements stay valid and readable.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { textPreview } from '@/commands/dom/helpers/query.js';

void describe('textPreview', () => {
  void it('never splits a character made of two UTF-16 units', () => {
    const preview = textPreview('🚀'.repeat(100));
    assert.equal(preview, `${'🚀'.repeat(80)}...`);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(preview)));
  });

  void it('collapses the whitespace of rendered text', () => {
    assert.equal(textPreview('  Top\n\n\tRow 0  '), 'Top Row 0');
  });
});
