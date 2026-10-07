/**
 * `dom get` (semantic mode) shows up to 500 characters of an element's text
 * instead of one truncated line (#332), what an element without text holds,
 * and the visible text of an element whose accessible name differs from it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatSemanticNodeWithContext,
  resolveNodeWithFallback,
  withSecretMasked,
} from '@/commands/dom/semanticUtils.js';
import { MASKED_VALUE, textPreview } from '@/runtime/dom/elementInfo.js';

const NODE = { nodeId: '1', role: 'generic' };

void describe('formatSemanticNodeWithContext', () => {
  void it('keeps one line for short text', () => {
    const output = formatSemanticNodeWithContext({
      node: NODE,
      domContext: { tag: 'div', preview: 'Hello' },
    });
    assert.equal(output, '[Generic] <div> "Hello"');
  });

  void it('adds a text line for longer text, saying where it was cut', () => {
    const long = 'word '.repeat(300);
    const output = formatSemanticNodeWithContext({
      node: NODE,
      domContext: { tag: 'div', preview: textPreview(long), text: textPreview(long, 500) },
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
      domContext: { tag: 'div', preview: textPreview(text), text },
    });
    assert.equal(output.split('\n')[1], `Text: ${text}`);
  });

  void it('says what an element without text holds (a body with only an iframe)', () => {
    const output = formatSemanticNodeWithContext({
      node: NODE,
      domContext: { tag: 'body', children: ['iframe#app', 'script'], childCount: 2 },
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
});

void describe('formatSemanticNodeWithContext key attributes', () => {
  void it('names the key attributes like dom query, without repeating the name or value', () => {
    assert.equal(
      formatSemanticNodeWithContext({
        node: { nodeId: '1', role: 'image', name: 'Backpack' },
        domContext: {
          tag: 'img',
          attributes: { src: 'https://cdn.test/img/sl-404.jpg', alt: 'Backpack' },
        },
      }),
      '[Image] "Backpack" src="…/sl-404.jpg"'
    );
    assert.equal(
      formatSemanticNodeWithContext({
        node: { nodeId: '2', role: 'textbox', name: 'Name', value: 'Ada', focusable: true },
        domContext: { tag: 'input', attributes: { type: 'text', name: 'custname', value: 'Ada' } },
      }),
      '[Textbox] "Name" type="text" name="custname" (value: "Ada", focusable)'
    );
  });
});

void describe('formatSemanticNodeWithContext text next to the accessible name', () => {
  void it('shows the visible text of an element named by something else (TinyMCE body)', () => {
    assert.equal(
      formatSemanticNodeWithContext({
        node: { nodeId: '1', role: 'generic', name: 'Rich Text Area. Press ALT-0 for help.' },
        domContext: { tag: 'body', preview: 'Your content goes here.' },
      }),
      '[Generic] "Rich Text Area. Press ALT-0 for help."\nText: Your content goes here.'
    );
  });

  void it('shows no text line when the name or value is the text', () => {
    assert.equal(
      formatSemanticNodeWithContext({
        node: { nodeId: '1', role: 'button', name: 'Add to cart', focusable: true },
        domContext: { tag: 'button', preview: 'ADD  TO CART' },
      }),
      '[Button] "Add to cart" (focusable)'
    );
    assert.equal(
      formatSemanticNodeWithContext({
        node: { nodeId: '2', role: 'generic', name: 'Notes', value: 'Typed notes' },
        domContext: { tag: 'div', preview: 'Typed notes' },
      }),
      '[Generic] "Notes" (value: "Typed notes")'
    );
  });
});

void describe('withSecretMasked', () => {
  void it('masks the accessibility value of a secret field (dom get, a11y describe)', () => {
    const node = { nodeId: '1', role: 'textbox', name: 'Password', value: 'hunter2' };
    assert.equal(withSecretMasked(node, { tag: 'input', sensitive: true }).value, MASKED_VALUE);
    assert.equal(withSecretMasked(node, { tag: 'input' }).value, 'hunter2');
    const resolved = resolveNodeWithFallback(node, { tag: 'input', sensitive: true }, 1);
    assert.equal(resolved?.value, MASKED_VALUE);
    assert.match(
      formatSemanticNodeWithContext({
        node: resolved ?? node,
        domContext: {
          tag: 'input',
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
      domContext: { tag: 'div', sensitive: true, preview: 'hunter2' },
    });
    assert.doesNotMatch(output, /hunter2/);
  });
});
