/**
 * DOM query formatter.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDomEval, formatDomGet, formatDomQuery } from '@/ui/formatters/dom.js';

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

  void it('lists at most 50 matches and says how many more there are', () => {
    const nodes = Array.from({ length: 60 }, (_, index) => ({ index, nodeId: index, tag: 'li' }));
    const output = formatDomQuery({ selector: 'li', count: 60, nodes });

    assert.match(output, /\[49\] <li>$/m);
    assert.doesNotMatch(output, /\[50\]/);
    assert.match(output, /\.\.\. and 10 more \(use --json for all\)/);
  });
});

void describe('formatDomQuery viewport hints', () => {
  void it('marks elements outside the viewport or hidden, and nothing for visible ones', () => {
    const output = formatDomQuery({
      selector: 'button',
      count: 5,
      nodes: [
        { index: 0, nodeId: 1, tag: 'button', preview: 'Top', inViewport: 'visible' },
        { index: 1, nodeId: 2, tag: 'button', preview: 'Edge', inViewport: 'partly' },
        { index: 2, nodeId: 3, tag: 'button', preview: 'Save', inViewport: 'below' },
        { index: 3, nodeId: 4, tag: 'button', inViewport: 'hidden' },
        { index: 4, nodeId: 5, tag: 'li', inViewport: 'below', clippedBy: 'ul#list' },
      ],
    });
    assert.match(output, /\[4\] <li> \(out of view in ul#list\)$/m);
    assert.match(output, /\[0\] <button> Top$/m);
    assert.match(output, /\[1\] <button> Edge$/m);
    assert.match(output, /\[2\] <button> Save \(below fold\)$/m);
    assert.match(output, /\[3\] <button> \(hidden\)$/m);
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
void describe('formatDomQuery next steps', () => {
  void it('is one line of bdg commands by index (they reach shadow roots and iframes)', () => {
    const output = formatDomQuery({
      selector: "a[title='x']",
      count: 2,
      nodes: [
        { index: 0, nodeId: 1, tag: 'a', context: 'shadow root of <x-card>' },
        { index: 1, nodeId: 2, tag: 'a' },
      ],
    });
    const next = output.split('\n').filter((line) => line.startsWith('Next: '));
    assert.equal(next.length, 1);
    assert.match(
      next[0] ?? '',
      /bdg dom get 0 \(text\), bdg dom get 0 --raw \(HTML\), bdg dom layout 0/
    );
    assert.doesNotMatch(output, /querySelectorAll|Extract text/);
  });
});

void describe('formatDomQuery options', () => {
  void it('shows the value and label of an <option>', () => {
    const output = formatDomQuery({
      selector: 'option',
      count: 1,
      nodes: [{ index: 0, nodeId: 1, tag: 'option', value: 'ca', preview: 'Canada' }],
    });
    assert.match(output, /\[0\] <option value="ca"> Canada/);
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

void describe('formatDomEval', () => {
  void it('prints strings as is, multi-line text included', () => {
    assert.equal(formatDomEval({ result: 'My Page', type: 'string' }), 'My Page');
    assert.equal(formatDomEval({ result: 'a "b"\nline 2', type: 'string' }), 'a "b"\nline 2');
    assert.equal(formatDomEval({ result: '1px solid', type: 'string' }), '1px solid');
  });

  void it('quotes strings that would read as another value', () => {
    const cases: Array<[string, string]> = [
      ['', '""'],
      ['undefined', '"undefined"'],
      ['42', '"42"'],
      ['true', '"true"'],
      ['null', '"null"'],
      ['[1,2]', '"[1,2]"'],
      ['{"a":1}', '"{\\"a\\":1}"'],
    ];
    for (const [result, expected] of cases) {
      assert.equal(formatDomEval({ result, type: 'string' }), expected, result);
    }
  });

  void it('keeps other values as before', () => {
    assert.equal(formatDomEval({ result: 42, type: 'number' }), '42');
    assert.equal(formatDomEval({ result: [1, 2], type: 'object' }), '[\n  1,\n  2\n]');
    assert.equal(formatDomEval({ result: null, type: 'object' }), 'null');
    assert.equal(formatDomEval({ result: undefined, type: 'undefined' }), 'undefined');
    assert.equal(formatDomEval({ result: '-0', type: 'number' }), '-0');
    assert.equal(formatDomEval({ result: 'body', type: 'object' }), 'body');
  });
});
