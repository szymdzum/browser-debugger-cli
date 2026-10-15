/**
 * Human output must not say something different from the data (#645, #585,
 * #734): attribute values and ids are escaped and cut on one line, links are
 * shown as the page has them, `dom get` shows `invalid`, `dom a11y describe`
 * shows a missing name and one id line, and `dom query` names icon-only
 * buttons.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatSemanticNodeWithContext } from '@/commands/dom/semanticUtils.js';
import type { ElementLayout } from '@/ipc/protocol/domTypes.js';
import type { A11yNode } from '@/types.js';
import { formatA11yNodeWithContext } from '@/ui/formatters/a11y.js';
import { formatDomQuery } from '@/ui/formatters/dom.js';
import type { InspectOutput } from '@/ui/formatters/inspect.js';
import { formatInspect } from '@/ui/formatters/inspect.js';
import { inspectHeader } from '@/ui/formatters/inspect.js';
import { layoutLine } from '@/ui/formatters/layout.js';
import { formatListeners } from '@/ui/formatters/listeners.js';

/** Value, and how it is written inside `"..."` (300 characters are cut: see `LONG`) */
const ESCAPES: ReadonlyArray<readonly [string, string, string]> = [
  ['double quote', 'say "hi"', 'say \\"hi\\"'],
  ['backslash', 'C:\\dir', 'C:\\\\dir'],
  ['newline', 'one\ntwo', 'one\\ntwo'],
  ['tab', 'one\ttwo', 'one\\ttwo'],
  ['escape character', 'a\u001bb', 'a\\u001bb'],
];

/** The cut form of a 300-character value: on one line, under the cap, with a mark */
const LONG = /^a+…a+$/u;

const query = (
  attributes: Record<string, string>,
  options?: { origin?: string },
  tag = 'a'
): string =>
  (formatDomQuery as (data: unknown, options?: unknown) => string)(
    { selector: 'x', count: 1, nodes: [{ index: 0, nodeId: 1, tag, attributes }] },
    options
  ).split('\n')[1]!;

void describe('attribute values are escaped (#645)', () => {
  for (const [label, value, written] of ESCAPES) {
    void it(`dom query writes a ${label} as ${written}`, () => {
      assert.match(
        query({ placeholder: value }, undefined, 'input'),
        new RegExp(`placeholder="${written.replace(/[\\"]/g, '\\$&')}"`)
      );
    });

    void it(`dom get writes a ${label} as ${written}`, () => {
      const output = formatSemanticNodeWithContext({
        node: { nodeId: '1', role: 'textbox' },
        domContext: { tag: 'input', classes: [], attributes: { placeholder: value } },
      });
      assert.equal(output.split('\n').length, 1, output);
      assert.ok(output.includes(`placeholder="${written}"`), output);
    });

    void it(`dom inspect writes a ${label} in an id as ${written}`, () => {
      const header = inspectHeader({
        element: `p#${value}.z`,
        id: value,
        visibility: {},
      } as unknown as InspectOutput);
      assert.equal(header, `p#${written}.z`);
    });
  }

  void it('cuts a 300-character value on one line in every surface', () => {
    const long = 'a'.repeat(300);
    const shown =
      /placeholder="([^"]*)"/.exec(query({ placeholder: long }, undefined, 'input'))?.[1] ?? '';
    assert.match(shown, LONG);
    const header = inspectHeader({
      element: `p#${long}.z`,
      id: long,
      visibility: {},
    } as unknown as InspectOutput);
    assert.match(header, /^p#a+…a+\.z$/u);
    assert.ok(header.length <= 50, header);
  });
});

void describe('links are shown as the page has them (#585)', () => {
  const origin = 'http://127.0.0.1:8765';
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ['same origin as its path', 'http://127.0.0.1:8765/register/', '/register/'],
    ['same origin keeps query and fragment', 'http://127.0.0.1:8765/a?b=1#c', '/a?b=1#c'],
    [
      'another origin with its scheme',
      'https://example.com/docs/page',
      'https://example.com/docs/page',
    ],
    ['another port is another origin', 'http://127.0.0.1:9000/x', 'http://127.0.0.1:9000/x'],
    ['another scheme is another origin', 'https://127.0.0.1:8765/x', 'https://127.0.0.1:8765/x'],
    ['a protocol-relative attribute as written', '//proto.example/y', '//proto.example/y'],
    ['mailto as written', 'mailto:a@b.c', 'mailto:a@b.c'],
  ];
  for (const [label, href, shown] of cases) {
    void it(`dom query shows ${label}`, () => {
      assert.ok(
        query({ href }, { origin }).includes(`href="${shown}"`),
        query({ href }, { origin })
      );
    });
  }

  void it('dom get shows the same link forms', () => {
    const format = formatSemanticNodeWithContext as (data: unknown, options?: unknown) => string;
    const line = (href: string): string =>
      format(
        {
          node: { nodeId: '1', role: 'link' },
          domContext: { tag: 'a', classes: [], attributes: { href } },
        },
        { origin }
      );
    assert.ok(line('http://127.0.0.1:8765/register/').includes('href="/register/"'));
    assert.ok(line('https://example.com/x').includes('href="https://example.com/x"'));
  });

  void it('shows the full URL when the page origin is not known', () => {
    assert.ok(
      query({ href: 'http://127.0.0.1:8765/r/' }).includes('href="http://127.0.0.1:8765/r/"')
    );
  });

  void it('still cuts a long same-origin path in the middle', () => {
    const shown =
      /href="([^"]*)"/.exec(query({ href: `${origin}/${'p'.repeat(100)}` }, { origin }))?.[1] ?? '';
    assert.ok(shown.length <= 40 && shown.startsWith('/') && shown.includes('…'), shown);
  });
});

void describe('dom get shows invalid (#645)', () => {
  const line = (properties: Record<string, unknown>): string =>
    formatSemanticNodeWithContext({
      node: { nodeId: '1', role: 'textbox', name: 'Email', properties },
      domContext: null,
    });

  void it('names an invalid field', () => {
    assert.match(line({ invalid: true }), /\(.*\binvalid\b.*\)/);
  });

  void it('says nothing for a valid one', () => {
    assert.doesNotMatch(line({ invalid: false }), /invalid/);
  });
});

void describe('dom a11y describe (#645)', () => {
  const describeNode = (node: Partial<A11yNode>): string =>
    formatA11yNodeWithContext({
      node: { nodeId: '5', role: 'button', ...node },
      domContext: null,
    });

  void it('says Name and Description are missing', () => {
    const output = describeNode({});
    assert.match(output, /^Name: +\(none\)$/m);
    assert.match(output, /^Description: +\(none\)$/m);
  });

  void it('prints one id line when both ids are the same', () => {
    const output = describeNode({ nodeId: '7', backendDOMNodeId: 7 });
    assert.equal(output.match(/ID:/g)?.length, 1, output);
    assert.match(output, /^A11y\+DOM ID: +7$/m);
  });

  void it('keeps both id lines when the ids differ', () => {
    const output = describeNode({ nodeId: '7', backendDOMNodeId: 9 });
    assert.match(output, /^A11y node ID: +7$/m);
    assert.match(output, /^Backend ID: +9$/m);
  });
});

void describe('dom query names an icon-only button (#645)', () => {
  const row = (node: { preview?: string; accessibleName?: string }): string =>
    formatDomQuery({
      selector: 'button',
      count: 1,
      nodes: [{ index: 2, nodeId: 1, tag: 'button', classes: ['icon'], ...node }],
    })
      .split('\n')[1]!
      .trim();

  void it('shows the name after the tag, quoted', () => {
    assert.equal(row({ accessibleName: 'Open menu' }), '[2] <button class="icon"> "Open menu"');
  });

  void it('escapes the name', () => {
    assert.equal(row({ accessibleName: 'say "hi"' }), '[2] <button class="icon"> "say \\"hi\\""');
  });

  void it('prefers the text preview', () => {
    assert.equal(
      row({ preview: 'Save', accessibleName: 'Open menu' }),
      '[2] <button class="icon"> Save'
    );
  });
});

void describe('dom inspect rows and header text (#734 review)', () => {
  void it('escapes ids in the parent line and tree rows, and content and placeholder', () => {
    const header = inspectHeader({
      element: 'input',
      content: 'a "b" \\c',
      placeholder: 'say "hi" back\\slash',
      visibility: {},
    } as unknown as InspectOutput);
    assert.equal(header, 'input "a \\"b\\" \\\\c" placeholder "say \\"hi\\" back\\\\slash"');
    const text = formatInspect({
      element: 'span#kid',
      visibility: {},
      layout: { display: 'block', parent: { element: 'div#p\nq', display: 'block' } },
      tree: [{ element: 'li#a\nb', w: 1, h: 1 }],
    } as unknown as InspectOutput);
    assert.doesNotMatch(text, /div#p\nq|li#a\nb/);
    assert.match(text, /div#p\\nq/);
  });

  void it('shows a same-origin link with a query only as /?x=1', () => {
    const line = formatDomQuery(
      {
        selector: 'a',
        count: 1,
        nodes: [
          { index: 0, nodeId: 1, tag: 'a', attributes: { href: 'http://127.0.0.1:8765?x=1' } },
        ],
      },
      { origin: 'http://127.0.0.1:8765' }
    );
    assert.ok(line.includes('href="/?x=1"'), line);
  });
});

void describe('dom layout rows escape the element label (#734 round 2)', () => {
  void it('writes an id with a quote and a newline on one line', () => {
    const output = layoutLine({
      index: 0,
      element: 'p#z"b\nc.odd',
      text: 'odd id',
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      inViewport: 'hidden',
    } as unknown as ElementLayout);
    assert.ok(output.includes('p#z\\"b\\nc.odd'), output);
    assert.doesNotMatch(output, /z"b\nc/);
  });
});

void describe('dom listeners rows escape page labels (#734 round 3)', () => {
  void it('writes a target label with a quote and a newline on one line', () => {
    const output = formatListeners({
      element: 'button',
      listeners: [
        {
          on: 'target',
          node: 'button#y"q\nr',
          type: 'click',
          handler: { name: '', scriptId: '1', lineNumber: 0, columnNumber: 0, preview: '()=>1' },
        },
      ],
    } as unknown as Parameters<typeof formatListeners>[0]);
    assert.ok(output.includes('button#y\\"q\\nr'), output);
    assert.doesNotMatch(output, /y"q\nr/);
  });
});
