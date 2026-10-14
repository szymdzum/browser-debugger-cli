/**
 * `dom get` (semantic mode) shows up to 500 characters of an element's text
 * instead of one truncated line (#332), what an element without text holds,
 * and the visible text of an element whose accessible name differs from it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildContextText,
  formatSemanticNodeWithContext,
  resolveNodeWithFallback,
  withSecretMasked,
} from '@/commands/dom/semanticUtils.js';
import { MASKED_VALUE, textPreview } from '@/runtime/dom/elementInfo.js';
import type { DomContext } from '@/types.js';

const NODE = { nodeId: '1', role: 'generic' };

void describe('formatSemanticNodeWithContext', () => {
  void it('keeps one line for short text', () => {
    const output = formatSemanticNodeWithContext({
      node: NODE,
      domContext: { tag: 'div', classes: [], preview: 'Hello' },
    });
    assert.equal(output, '[Generic] <div> "Hello"');
  });

  void it('adds a text line for longer text, saying where it was cut', () => {
    const long = 'word '.repeat(300);
    const output = formatSemanticNodeWithContext({
      node: NODE,
      domContext: {
        tag: 'div',
        classes: [],
        preview: textPreview(long),
        text: textPreview(long, 500),
      },
    });
    const [first, second] = output.split('\n');
    assert.equal(first, '[Generic] <div>');
    assert.ok(second?.startsWith('Text: word word'));
    assert.ok((second?.length ?? 0) > 500);
    assert.match(second ?? '', /\.\.\. \(cut at 500 characters; --full shows all of it\)$/);
  });

  void it('does not claim a cut for text that fits', () => {
    const text = 'x'.repeat(200);
    const output = formatSemanticNodeWithContext({
      node: NODE,
      domContext: { tag: 'div', classes: [], preview: textPreview(text), text },
    });
    assert.equal(output.split('\n')[1], `Text: ${text}`);
  });

  void it('says what an element without text holds (a body with only an iframe)', () => {
    const output = formatSemanticNodeWithContext({
      node: NODE,
      domContext: { tag: 'body', classes: [], children: ['iframe#app', 'script'], childCount: 2 },
    });
    assert.equal(
      output,
      '[Generic] <body>\nNo text; holds 2 elements: iframe#app, script (see its HTML with --raw)'
    );
  });

  void it("says what a web component's shadow root holds (an icon button named there)", () => {
    const output = formatSemanticNodeWithContext({
      node: NODE,
      domContext: {
        tag: 'x-icon-button',
        classes: [],
        children: ['button.icon "Close"'],
        childCount: 1,
        shadowChildren: true,
      },
    });
    assert.equal(
      output,
      '[Generic] <x-icon-button>\nNo text; its shadow root holds 1 element: button.icon "Close" (see it with bdg dom inspect)'
    );
  });

  void it('does not point to dom inspect for a closed shadow root, which it cannot show (#574)', () => {
    const output = formatSemanticNodeWithContext({
      node: NODE,
      domContext: {
        tag: 'x-vault',
        classes: [],
        children: ['form'],
        childCount: 1,
        shadowChildren: true,
        shadowRootMode: 'closed',
      },
    });
    assert.equal(
      output,
      '[Generic] <x-vault>\nNo text; its closed shadow root holds 1 element: form (selectors and dom inspect cannot reach it; bdg dom a11y query, e.g. role=textbox, lists its elements by index for dom fill, dom click and dom get)'
    );
  });
});

void describe('formatSemanticNodeWithContext key attributes', () => {
  void it('names the key attributes like dom query, without repeating the name or value', () => {
    assert.equal(
      formatSemanticNodeWithContext({
        node: { nodeId: '1', role: 'image', name: 'Backpack' },
        domContext: {
          tag: 'img',
          classes: [],
          attributes: { src: 'https://cdn.test/img/sl-404.jpg', alt: 'Backpack' },
        },
      }),
      '[Image] "Backpack" src="…/sl-404.jpg"'
    );
    assert.equal(
      formatSemanticNodeWithContext({
        node: { nodeId: '2', role: 'textbox', name: 'Name', value: 'Ada', focusable: true },
        domContext: {
          tag: 'input',
          classes: [],
          attributes: { type: 'text', name: 'custname', value: 'Ada' },
          typeAttribute: 'text',
        },
      }),
      '[Textbox] "Name" type="text" name="custname" (value: "Ada", focusable)'
    );
    assert.equal(
      formatSemanticNodeWithContext({
        node: { nodeId: '2', role: 'textbox', name: 'Name', value: 'Ada', focusable: true },
        domContext: {
          tag: 'input',
          classes: [],
          attributes: { type: 'text', name: 'custname', value: 'Ada' },
        },
      }),
      '[Textbox] "Name" name="custname" (value: "Ada", focusable)'
    );
  });
});

void describe('formatSemanticNodeWithContext text next to the accessible name', () => {
  void it('shows the visible text of an element named by something else (TinyMCE body)', () => {
    assert.equal(
      formatSemanticNodeWithContext({
        node: { nodeId: '1', role: 'generic', name: 'Rich Text Area. Press ALT-0 for help.' },
        domContext: { tag: 'body', classes: [], preview: 'Your content goes here.' },
      }),
      '[Generic] "Rich Text Area. Press ALT-0 for help."\nText: Your content goes here.'
    );
  });

  void it('shows no text line when the name or value is the text', () => {
    assert.equal(
      formatSemanticNodeWithContext({
        node: { nodeId: '1', role: 'button', name: 'Add to cart', focusable: true },
        domContext: { tag: 'button', classes: [], preview: 'ADD  TO CART' },
      }),
      '[Button] "Add to cart" (focusable)'
    );
    assert.equal(
      formatSemanticNodeWithContext({
        node: { nodeId: '2', role: 'generic', name: 'Notes', value: 'Typed notes' },
        domContext: { tag: 'div', classes: [], preview: 'Typed notes' },
      }),
      '[Generic] "Notes" (value: "Typed notes")'
    );
  });

  void it('shows no text line for a long heading named by all of its text', () => {
    const text =
      'This is where you can log into the secure area. Enter tomsmith for the username and SuperSecretPassword! for the password.';
    assert.equal(
      formatSemanticNodeWithContext({
        node: { nodeId: '1', role: 'heading', name: text, properties: { level: 4 } },
        domContext: {
          tag: 'h4',
          classes: [],
          preview: textPreview(text),
          text: text.replace(' tomsmith ', '  tomsmith\n'),
        },
      }),
      `[Heading L4] "${text}"`
    );
  });
});

void describe('withSecretMasked', () => {
  void it('masks the accessibility value of a secret field (dom get, a11y describe)', () => {
    const node = { nodeId: '1', role: 'textbox', name: 'Password', value: 'hunter2' };
    assert.equal(
      withSecretMasked(node, { tag: 'input', classes: [], sensitive: true }).value,
      MASKED_VALUE
    );
    assert.equal(withSecretMasked(node, { tag: 'input', classes: [] }).value, 'hunter2');
    const resolved = resolveNodeWithFallback(
      node,
      { tag: 'input', classes: [], sensitive: true },
      1
    );
    assert.equal(resolved?.value, MASKED_VALUE);
    assert.match(
      formatSemanticNodeWithContext({
        node: resolved ?? node,
        domContext: {
          tag: 'input',
          classes: [],
          sensitive: true,
          attributes: { type: 'text', value: MASKED_VALUE },
        },
      }),
      /value: "••••"/
    );
  });

  void it('never shows the text of a secret field on a text line', () => {
    const output = formatSemanticNodeWithContext({
      node: { nodeId: '3', role: 'textbox', name: 'Password' },
      domContext: { tag: 'div', classes: [], sensitive: true, preview: 'hunter2' },
    });
    assert.doesNotMatch(output, /hunter2/);
  });
});

void describe('buildContextText id', () => {
  const context = (id?: string): DomContext => ({
    tag: 'p',
    classes: ['a'],
    ...(id !== undefined && { id }),
  });

  void it('shows a plain id as #id before the classes', () => {
    assert.equal(buildContextText(NODE, context('x')), ' <p#x.a>');
  });

  void it('shows nothing for no id and for an empty one', () => {
    assert.equal(buildContextText(NODE, context()), ' <p.a>');
    assert.equal(buildContextText(NODE, context('')), ' <p.a>');
  });

  void it('keeps a newline in an id on one line', () => {
    const text = buildContextText(NODE, context('n\nl'));
    assert.equal(text.includes('\n'), false);
    assert.equal(text, ' <p.a id="n l">');
  });

  void it('cuts a long id', () => {
    const text = buildContextText(NODE, context('a'.repeat(300)));
    assert.ok(text.length < 80, text);
    assert.match(text, /^ <p#a+….*>$/u);
  });

  void it('writes an id that is not a plain identifier as id="..."', () => {
    assert.equal(buildContextText(NODE, context('a b')), ' <p.a id="a b">');
    assert.equal(buildContextText(NODE, context('x"y')), ' <p.a id="x"y">');
  });

  void it('keeps a whitespace-only accessible name off the line (a <br>)', () => {
    const output = formatSemanticNodeWithContext({
      node: { nodeId: '1', role: 'LineBreak', name: '\n' },
      domContext: { tag: 'br', classes: [] },
    });
    assert.equal(output, '[LineBreak] <br>');
  });
});

void describe('empty-element line by tag', () => {
  const line = (tag: string): string =>
    formatSemanticNodeWithContext({
      node: NODE,
      domContext: { tag, classes: [], children: [], childCount: 0 },
    });

  void it('is skipped for void elements, select and textarea', () => {
    for (const tag of ['input', 'img', 'br', 'hr', 'select', 'textarea']) {
      assert.doesNotMatch(line(tag), /No text/, tag);
    }
  });

  void it('stays for an empty div, a button and a span', () => {
    for (const tag of ['div', 'button', 'span']) {
      assert.match(line(tag), /No text and no child elements/, tag);
    }
  });
});
