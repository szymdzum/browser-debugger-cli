/**
 * Human output of `bdg dom listeners`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ElementListener } from '@/ipc/protocol/domTypes.js';
import { formatListeners, handlerLocation } from '@/ui/formatters/listeners.js';

/**
 * A listener report entry.
 *
 * @param overrides - Fields to change
 * @returns Listener
 */
function listener(overrides: Partial<ElementListener> = {}): ElementListener {
  return {
    type: 'click',
    on: 'target',
    node: 'button#save',
    useCapture: false,
    passive: false,
    once: false,
    handler: {
      name: 'onSave',
      preview: 'function onSave(e) {}',
      scriptId: '42',
      lineNumber: 17,
      columnNumber: 4,
    },
    ...overrides,
  };
}

void describe('formatListeners', () => {
  void it('groups listeners by type in aligned columns', () => {
    const output = formatListeners({
      element: 'button#save',
      listeners: [
        listener(),
        listener({ on: 'document', node: 'document', useCapture: true }),
        listener({ type: 'keydown', handler: { ...listener().handler, name: '' } }),
      ],
    });
    const lines = output.split('\n');
    assert.equal(lines[0], 'Event listeners for button#save (3)');
    assert.equal(lines[2], 'click');
    assert.match(
      lines[3] ?? '',
      /^ {2}target {4}button#save {2}onSave {7}script 42:18:5 {2}function/
    );
    assert.match(lines[4] ?? '', /^ {2}document {2}document {5}onSave .*\[capture\] function/);
    assert.equal(lines[6], 'keydown');
    assert.match(lines[7] ?? '', /\(anonymous\)/);
    assert.doesNotMatch(output, /Note:/);
  });

  void it('explains delegation when only ancestors listen', () => {
    const output = formatListeners({
      element: 'span',
      listeners: [listener({ on: 'ancestor', node: 'div#root' })],
    });
    assert.match(
      output,
      /Note: click has no listener on the element itself; frameworks like React/
    );
  });

  void it('says so when nothing listens, naming the requested types', () => {
    const output = formatListeners({ element: 'span', listeners: [] }, ['click', 'input']);
    assert.match(output, /^No click\/input listeners on span, its ancestors, document or window/);
  });

  void it('shows the multiple-match warning', () => {
    const output = formatListeners({ element: 'span', listeners: [], warning: '2 elements match' });
    assert.match(output, /⚠ Warning: 2 elements match/);
  });
});

void describe('handlerLocation', () => {
  void it('shows 1-based positions, or native for built-in handlers', () => {
    assert.equal(handlerLocation(listener().handler), 'script 42:18:5');
    assert.equal(handlerLocation({ ...listener().handler, scriptId: '0' }), 'native');
  });
});
