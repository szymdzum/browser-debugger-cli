/**
 * DOM query formatter.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDomGet, formatDomQuery } from '@/ui/formatters/dom.js';

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
void describe('formatDomQuery text hint', () => {
  void it('gives a shell-safe script for the shown match', () => {
    const output = formatDomQuery({
      selector: "a[title='x']",
      count: 1,
      nodes: [{ index: 0, nodeId: 1, tag: 'a' }],
    });
    assert.ok(
      output.includes(
        `bdg dom eval '(el => el && (el.value ?? el.textContent))(document.querySelectorAll("a[title='\\''x'\\'']")[0])'`
      )
    );
  });
});

void describe('formatDomGet', () => {
  void it('numbers several elements from 0', () => {
    const output = formatDomGet({
      nodes: [
        { nodeId: 1, outerHTML: '<p>a</p>' },
        { nodeId: 2, outerHTML: '<p>b</p>' },
      ],
    });
    assert.match(output, /\[0\] <p>a<\/p>/);
    assert.match(output, /\[1\] <p>b<\/p>/);
  });
});
