/**
 * `dom get` (semantic mode) shows up to 500 characters of an element's text
 * instead of one truncated line (#332), and what an element without text holds.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatSemanticNodeWithContext } from '@/commands/dom/semanticUtils.js';
import { textPreview } from '@/runtime/dom/elementInfo.js';

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
});
