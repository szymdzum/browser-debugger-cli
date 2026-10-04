/**
 * Text previews of queried elements stay valid and readable.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { textPreview } from '@/commands/dom/helpers/query.js';

void describe('textPreview', () => {
  void it('never splits a character made of two UTF-16 units', () => {
    const preview = textPreview(`<p>${'🚀'.repeat(100)}</p>`);
    assert.equal(preview, `${'🚀'.repeat(80)}...`);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(preview)));
  });

  void it('keeps words of separate elements apart and skips styles and scripts', () => {
    assert.equal(
      textPreview(
        '<div><span>Top</span><span>Row 0</span><style>.x{}</style><script>x()</script></div>'
      ),
      'Top Row 0'
    );
  });

  void it('decodes entities but not lone surrogates', () => {
    assert.equal(
      textPreview('<p>Tom &amp; Jerry&nbsp;&#8217;s &#x1F680; &#xD800;</p>'),
      'Tom & Jerry ’s 🚀 &#xD800;'
    );
  });
});
