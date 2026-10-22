/**
 * DOM query formatter.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ScreenshotResult } from '@/types.js';
import {
  formatDomEval,
  formatDomGet,
  formatDomQuery,
  formatDomScreenshot,
} from '@/ui/formatters/dom.js';

void describe('formatDomQuery ids', () => {
  const idLine = (id: string): string =>
    formatDomQuery({ selector: 'p', count: 1, nodes: [{ index: 0, nodeId: 1, tag: 'p', id }] });

  void it('keeps a plain id as written', () => {
    assert.match(idLine('x'), /\[0\] <p id="x">$/m);
  });

  void it('keeps a newline in an id on one line', () => {
    assert.match(idLine('n\nl'), /\[0\] <p id="n\\nl">$/m);
  });

  void it('escapes a double quote in an id', () => {
    assert.match(idLine('a"b\'c'), /\[0\] <p id="a\\"b'c">$/m);
  });

  void it('cuts a 300-character id', () => {
    const line =
      idLine('a'.repeat(300))
        .split('\n')
        .find((l) => l.includes('<p')) ?? '';
    assert.ok(line.length < 70, line);
    assert.match(line, /id="a+…a+"/u);
  });
});

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

  void it('shows the first class and how many more there are', () => {
    const output = formatDomQuery({
      selector: 'a',
      count: 3,
      nodes: [
        {
          index: 0,
          nodeId: 1,
          tag: 'a',
          classes: ['px-2', 'py-4', 'text-sm', 'hover:underline', 'md:flex'],
          preview: 'Home',
        },
        { index: 1, nodeId: 2, tag: 'a', classes: ['nav', 'active'] },
        { index: 2, nodeId: 3, tag: 'a', classes: ['brush:', 'html'] },
      ],
    });

    assert.match(output, /\[0\] <a class="px-2 \+4"> Home$/m);
    assert.match(output, /\[1\] <a class="nav \+1">$/m);
    assert.match(output, /\[2\] <a class="html">$/m);
    assert.doesNotMatch(output, /py-4|active/);
  });

  void it('leaves declaration-like tokens out of the class and its count', () => {
    const output = formatDomQuery({
      selector: 'code',
      count: 2,
      nodes: [
        { index: 0, nodeId: 1, tag: 'code', classes: ['brush:', 'js;'] },
        { index: 1, nodeId: 2, tag: 'code', classes: ['brush:', 'html', 'x'] },
      ],
    });

    assert.match(output, /\[0\] <code>$/m);
    assert.match(output, /\[1\] <code class="html \+1">$/m);
    assert.doesNotMatch(output, /brush|js;/);
  });

  void it('lists the matches given and says how many more there are, and how many are indexed', () => {
    const nodes = Array.from({ length: 50 }, (_, index) => ({ index, nodeId: index, tag: 'li' }));
    const output = formatDomQuery({
      selector: 'li',
      count: 50003,
      nodes,
      omitted: 49953,
      indexed: 1000,
    });

    assert.match(output, /^Found 50003 nodes matching "li":/);
    assert.match(output, /\[49\] <li>$/m);
    assert.match(
      output,
      /\.\.\. and 49953 more \(--limit 0 lists all; indices 0-999 work with other commands\)/
    );
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
        { nodeId: 1, classes: [], outerHTML: '<p>a</p>' },
        { nodeId: 2, classes: [], outerHTML: '<p>b</p>' },
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

  void it('prints a string as is with raw, even when it would read as another value', () => {
    const cases: string[] = ['40.00', '42', 'undefined', '', 'a\nb', '{"a":1}', '[1,2]'];
    for (const result of cases) {
      assert.equal(formatDomEval({ result, type: 'string' }, { raw: true }), result, result);
    }
  });

  void it('leaves other values and --json unchanged with raw', () => {
    assert.equal(formatDomEval({ result: 42, type: 'number' }, { raw: true }), '42');
    assert.equal(
      formatDomEval({ result: [1, 2], type: 'object' }, { raw: true }),
      '[\n  1,\n  2\n]'
    );
    assert.equal(formatDomEval({ result: null, type: 'object' }, { raw: true }), 'null');
    assert.equal(
      formatDomEval({ result: undefined, type: 'undefined' }, { raw: true }),
      'undefined'
    );
  });

  void it('still caps a raw string result without full', () => {
    const long = `${'x'.repeat(20000)}y`;
    const output = formatDomEval({ result: long, type: 'string' }, { raw: true });
    assert.match(output, /1 more chars \(use --full\)$/);
    assert.equal(formatDomEval({ result: long, type: 'string' }, { raw: true, full: true }), long);
  });
});

void describe('formatDomQuery key attributes', () => {
  const line = (node: Parameters<typeof formatDomQuery>[0]['nodes'][number]): string =>
    formatDomQuery({ selector: 'x', count: 1, nodes: [node] })
      .split('\n')[1]
      ?.trim() ?? '';

  void it("shows an image's file name and alt", () => {
    assert.equal(
      line({
        index: 0,
        nodeId: 1,
        tag: 'img',
        classes: ['inventory_item_img'],
        attributes: { src: '/static/media/sl-404.168b1cce.jpg', alt: 'Sauce Labs Backpack' },
      }),
      '[0] <img src="…/sl-404.168b1cce.jpg" alt="Sauce Labs Backpack" class="inventory_item_img">'
    );
  });

  void it('shows links and form targets with their scheme and iframes by host', () => {
    assert.match(
      line({ index: 0, nodeId: 1, tag: 'a', attributes: { href: 'https://saucelabs.com/' } }),
      /<a href="https:\/\/saucelabs\.com">/
    );
    assert.match(
      line({ index: 0, nodeId: 1, tag: 'a', attributes: { href: '#' } }),
      /<a href="#">/
    );
    assert.match(
      line({
        index: 0,
        nodeId: 1,
        tag: 'iframe',
        attributes: { src: 'https://js.stripe.com/v3/elements-inner.html?x=1' },
      }),
      /<iframe src="\/\/js\.stripe\.com\/…">/
    );
    assert.match(
      line({ index: 0, nodeId: 1, tag: 'form', attributes: { action: '/post', method: 'post' } }),
      /<form action="\/post" method="post">/
    );
  });

  void it('cuts long values in the middle', () => {
    const output = line({
      index: 0,
      nodeId: 1,
      tag: 'input',
      type: 'text',
      attributes: { type: 'text', placeholder: `Start ${'x'.repeat(60)} end` },
    });
    const placeholder = /placeholder="([^"]*)"/.exec(output)?.[1] ?? '';
    assert.equal(placeholder.length, 40);
    assert.match(placeholder, /^Start x+…x* end$/);
  });

  void it('shows a field once with its live type, value and checked state', () => {
    assert.equal(
      line({
        index: 0,
        nodeId: 1,
        tag: 'input',
        id: 'password',
        name: 'password',
        type: 'password',
        attributes: { type: 'password', name: 'password', value: '••••' },
      }),
      '[0] <input id="password" name="password" type="password" value="••••">'
    );
    assert.equal(
      line({
        index: 1,
        nodeId: 2,
        tag: 'input',
        name: 'size',
        type: 'radio',
        attributes: { type: 'radio', name: 'size', value: 'medium', checked: true },
      }),
      '[1] <input name="size" type="radio" value="medium" checked>'
    );
  });

  void it("shows a select's selected option and a button's type only as written", () => {
    assert.match(
      line({ index: 0, nodeId: 1, tag: 'select', attributes: { selected: 'Name (A to Z)' } }),
      /<select selected="Name \(A to Z\)">/
    );
    assert.match(
      line({ index: 0, nodeId: 1, tag: 'button', attributes: { type: 'submit' } }),
      /<button>/
    );
    assert.match(
      line({ index: 0, nodeId: 1, tag: 'button', type: 'button', attributes: { type: 'button' } }),
      /<button type="button">/
    );
  });
});

void describe('formatDomScreenshot full page fallback', () => {
  void it('says --no-resize captures the full page (#567)', () => {
    const output = formatDomScreenshot({
      path: './page.png',
      fullPageSkipped: { reason: 'page_too_tall', originalHeight: 9000, aspectRatio: 5.1 },
    } as ScreenshotResult);
    assert.match(output, /viewport only - page too tall/);
    assert.match(output, /--no-resize/);
  });

  void it('names --no-resize once when the image was scaled too', () => {
    const output = formatDomScreenshot({
      path: './page.png',
      fullPageSkipped: { reason: 'page_too_tall', originalHeight: 9000, aspectRatio: 5.1 },
      resized: true,
      originalWidth: 980,
      originalHeight: 2120,
      width: 725,
      height: 1568,
    } as ScreenshotResult);
    assert.equal(
      output,
      'Screenshot saved to ./page.png (viewport only - page too tall; --no-resize captures the full page) (scaled from 980×2120 to 725×1568)'
    );
  });
});
