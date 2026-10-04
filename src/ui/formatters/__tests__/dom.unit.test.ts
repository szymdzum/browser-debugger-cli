/**
 * DOM query formatter.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDomQuery } from '@/ui/formatters/dom.js';

void describe('formatDomQuery', () => {
  void it('shows the text preview, and nothing for elements without text', () => {
    const output = formatDomQuery({
      selector: 'img, p',
      count: 2,
      nodes: [
        { index: 0, nodeId: 1, tag: 'img' },
        { index: 1, nodeId: 2, tag: 'p', classes: ['note'], preview: 'Hello' },
      ],
    });

    assert.match(output, /\[0\] <img>$/m);
    assert.match(output, /\[1\] <p class="note"> Hello$/m);
    assert.doesNotMatch(output, /undefined/);
  });

  void it('says where selectors do not reach when nothing matches', () => {
    const output = formatDomQuery({ selector: '#missing', count: 0, nodes: [] });

    assert.match(output, /No nodes found matching "#missing"/);
    assert.match(output, /cross-origin iframes/);
  });
});
