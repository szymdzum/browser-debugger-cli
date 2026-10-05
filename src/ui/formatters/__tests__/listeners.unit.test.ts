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
    assert.equal(
      lines[0],
      'Event listeners for button#save (3: 2 on the element, 1 on document and window)'
    );
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
      /Note: click has no listener on the element itself; the listeners on its ancestors, document or window listed above still run for it/
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

  void it('summarises framework roots on one line and names the frame and index', () => {
    const output = formatListeners({
      element: 'button.cta',
      index: 2,
      frame: 'iframe#app',
      listeners: [listener({ noop: true, handler: { ...listener().handler, name: 'u0' } })],
      collapsed: [
        {
          on: 'ancestor',
          node: 'div#__next',
          framework: 'React root',
          types: ['click', 'keydown', 'scroll'],
          count: 6,
          capture: true,
          bubble: true,
          handlers: [listener().handler, { ...listener().handler, name: 'dispatchEvent' }],
        },
      ],
    });
    const lines = output.split('\n');
    assert.equal(
      lines[0],
      'Event listeners for button.cta [2] in iframe#app (7: 1 on the element, 6 on ancestors)'
    );
    assert.match(lines[3] ?? '', /\[no-op\] function/);
    assert.match(output, /Framework roots \(one line per node; --all lists each listener\):/);
    assert.match(
      output,
      / {2}ancestor {2}div#__next {2}React root: 3 event types, capture and bubble \(onSave, dispatchEvent\)/
    );
    assert.match(
      output,
      /Note: React's root container \(div#__next\) handles click and keydown, but no React on… prop for them was found on the element or its ancestors; the element's own click listener is only React's no-op placeholder/
    );
    assert.doesNotMatch(output, /no listener on the element itself/);
  });

  void it('marks jQuery handlers and their delegate selector', () => {
    const output = formatListeners({
      element: 'div.row',
      listeners: [
        listener({
          on: 'document',
          node: 'document',
          framework: 'jQuery',
          delegateSelector: '.row',
        }),
      ],
    });
    assert.match(output, /onSave .*\[jQuery, delegate \.row\] function/);
    assert.match(
      output,
      /Note: click has no listener on the element itself; jQuery runs the handlers listed above by delegation from document/
    );
  });

  void it('shows React props first and explains the placeholder', () => {
    const react = listener({
      framework: 'React',
      reactProp: 'onClick',
      handler: { ...listener().handler, name: 'handleBuy', preview: 'function handleBuy(){}' },
    });
    const placeholder = listener({ noop: true, handler: { ...listener().handler, name: 'tn' } });
    const output = formatListeners({
      element: 'button#add',
      listeners: [react, placeholder],
      reactHandlersSkipped: 2,
    });
    const lines = output.split('\n');
    assert.match(
      lines[3] ?? '',
      /^ {2}target {2}button#save {2}handleBuy .*\[React onClick\] function handleBuy/
    );
    assert.match(lines[4] ?? '', /tn .*\[no-op\]/);
    assert.match(
      output,
      /Note: the element's own click listener is only React's no-op placeholder; the React on… handlers listed above for click run from React's root container/
    );
    assert.match(output, /Note: 2 more React handler props not listed/);
  });

  void it('adds no note when React props are all there is to say', () => {
    const output = formatListeners({
      element: 'input',
      listeners: [listener({ type: 'input', framework: 'React', reactProp: 'onChange' })],
    });
    assert.doesNotMatch(output, /Note:/);
  });

  void it('suggests the event type a mistyped --type meant', () => {
    const output = formatListeners(
      { element: 'button', listeners: [], typeSuggestions: ['click'] },
      ['Click']
    );
    assert.match(output, /Did you mean: --type click\?/);
  });
});
