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

  void it('lists at most 50 matches and says how many more there are', () => {
    const nodes = Array.from({ length: 60 }, (_, index) => ({ index, nodeId: index, tag: 'li' }));
    const output = formatDomQuery({ selector: 'li', count: 60, nodes });

    assert.match(output, /\[49\] <li>$/m);
    assert.doesNotMatch(output, /\[50\]/);
    assert.match(output, /\.\.\. and 10 more \(use --json for all\)/);
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
        `bdg dom eval '(el => el && (el.value ?? el.innerText))(document.querySelectorAll("a[title='\\''x'\\'']")[0])'`
      )
    );
  });

  void it('leaves the script out for selectors with text or visibility filters', () => {
    const output = formatDomQuery({
      selector: 'button:has-text("Save")',
      count: 1,
      nodes: [{ index: 0, nodeId: 1, tag: 'button' }],
    });
    assert.ok(!output.includes('Extract text'));
    assert.ok(output.includes('bdg dom get 0'));
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
