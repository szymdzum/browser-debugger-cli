/**
 * Building the `bdg dom listeners` report from CDP listener data: placement,
 * names, previews, filtering and nearest-first ordering.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Protocol } from '@/connection/typed-cdp.js';
import {
  buildListenerReport,
  delegatedOnlyTypes,
  describeChainEntry,
  functionNameFromSource,
  handlerPreview,
  listenerPlacement,
  type ChainListeners,
} from '@/runtime/dom/listenerSummary.js';

/**
 * A CDP listener with a handler whose source is `source`.
 *
 * @param type - Event type
 * @param source - Handler source
 * @param flags - Capture/passive/once overrides
 * @returns CDP listener
 */
function cdpListener(
  type: string,
  source: string,
  flags: Partial<Pick<Protocol.DOMDebugger.EventListener, 'useCapture' | 'passive' | 'once'>> = {}
): Protocol.DOMDebugger.EventListener {
  return {
    type,
    useCapture: false,
    passive: false,
    once: false,
    scriptId: '42',
    lineNumber: 3,
    columnNumber: 7,
    handler: { type: 'function', className: 'Function', description: source },
    ...flags,
  };
}

/** Chain of `button#save` inside `div#root`, with listeners on each level */
const CHAIN: ChainListeners[] = [
  {
    position: 0,
    entry: { className: 'HTMLButtonElement', description: 'button#save' },
    listeners: [
      cdpListener('keydown', '(e) => go(e)'),
      cdpListener('click', 'function onSave(e) {}'),
    ],
  },
  {
    position: 1,
    entry: { className: 'HTMLDivElement', description: 'div#root' },
    listeners: [cdpListener('click', 'function () { [native code] }', { useCapture: true })],
  },
  {
    position: 2,
    entry: { className: 'HTMLDocument', description: '#document' },
    listeners: [cdpListener('click', 'function delegated(e) {}')],
  },
  {
    position: 3,
    entry: { className: 'Window', description: 'Window' },
    listeners: [cdpListener('resize', '() => {}')],
  },
];

void describe('listener placement and descriptions', () => {
  void it('places the element, ancestors, document and window', () => {
    assert.deepEqual(
      CHAIN.map(({ entry, position }) => listenerPlacement(entry, position)),
      ['target', 'ancestor', 'document', 'window']
    );
    assert.deepEqual(
      CHAIN.map(({ entry }) => describeChainEntry(entry)),
      ['button#save', 'div#root', 'document', 'window']
    );
  });

  void it('names shadow roots and shortens long class lists', () => {
    assert.equal(describeChainEntry({ className: 'ShadowRoot' }), '#shadow-root');
    const long = `div.${'tailwind-class.'.repeat(10)}`;
    assert.equal(describeChainEntry({ description: long }).length, 60);
  });

  void it('previews handler source on one line, truncated', () => {
    assert.equal(handlerPreview('function a(e) {\n  go(e);\n}'), 'function a(e) { go(e); }');
    const preview = handlerPreview(`function a() { ${'x'.repeat(200)} }`);
    assert.equal(preview.length, 80);
    assert.ok(preview.endsWith('…'));
  });

  void it('reads function names from source as a fallback', () => {
    assert.equal(functionNameFromSource('function onSave(e) {}'), 'onSave');
    assert.equal(functionNameFromSource('async function* gen() {}'), 'gen');
    assert.equal(functionNameFromSource('handleClick(e) { }'), 'handleClick');
    assert.equal(functionNameFromSource('(e) => go(e)'), '');
    assert.equal(functionNameFromSource('function () {}'), '');
  });
});

void describe('buildListenerReport', () => {
  void it('groups by event type, nearest first', () => {
    const report = buildListenerReport(CHAIN, []);
    assert.deepEqual(
      report.map((listener) => `${listener.type}:${listener.on}`),
      ['click:target', 'click:ancestor', 'click:document', 'keydown:target', 'resize:window']
    );
    assert.deepEqual(report[1], {
      type: 'click',
      on: 'ancestor',
      node: 'div#root',
      useCapture: true,
      passive: false,
      once: false,
      handler: {
        name: '',
        preview: 'function () { [native code] }',
        scriptId: '42',
        lineNumber: 3,
        columnNumber: 7,
      },
    });
  });

  void it('prefers names reported by the page (in flattened listener order)', () => {
    const report = buildListenerReport(CHAIN, ['handleKey', 'onSave', 'bound dispatch']);
    assert.equal(report.find((l) => l.type === 'keydown')?.handler.name, 'handleKey');
    assert.equal(report.find((l) => l.on === 'ancestor')?.handler.name, 'bound dispatch');
    assert.equal(report.find((l) => l.on === 'document')?.handler.name, 'delegated');
  });

  void it('keeps only the requested event types', () => {
    const report = buildListenerReport(CHAIN, [], ['resize', 'keydown']);
    assert.deepEqual(
      report.map((listener) => listener.type),
      ['keydown', 'resize']
    );
  });
});

void describe('delegatedOnlyTypes', () => {
  void it('lists interaction types with listeners only above the element', () => {
    const withoutTarget = buildListenerReport(CHAIN.slice(1), []);
    assert.deepEqual(delegatedOnlyTypes(withoutTarget), ['click']);
  });

  void it('is empty when the element has its own listener', () => {
    assert.deepEqual(delegatedOnlyTypes(buildListenerReport(CHAIN, [])), []);
  });
});
