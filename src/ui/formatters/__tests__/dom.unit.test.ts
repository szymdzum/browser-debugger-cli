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

void describe('formatDomQuery identifying details', () => {
  void it('shows id, name, type and the enclosing frame or shadow root', () => {
    const output = formatDomQuery({
      selector: 'input',
      count: 1,
      nodes: [
        {
          index: 0,
          nodeId: 7,
          tag: 'input',
          id: 'email',
          name: 'email',
          type: 'email',
          context: 'iframe#login > shadow root of <x-field>',
        },
      ],
    });
    assert.match(
      output,
      /\[0\] <input id="email" name="email" type="email"> \(in iframe#login > shadow root of <x-field>\)/
    );
  });
});
