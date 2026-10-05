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
  isNoopSource,
  listenerPlacement,
  suggestEventTypes,
  type ChainListeners,
  type ResolvedHandler,
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
    const report = buildListenerReport(CHAIN, []).listeners;
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
    const names = ['handleKey', 'onSave', 'bound dispatch'].map((name) => ({ name }));
    const report = buildListenerReport(CHAIN, names).listeners;
    assert.equal(report.find((l) => l.type === 'keydown')?.handler.name, 'handleKey');
    assert.equal(report.find((l) => l.on === 'ancestor')?.handler.name, 'bound dispatch');
    assert.equal(report.find((l) => l.on === 'document')?.handler.name, 'delegated');
  });

  void it('keeps only the requested event types', () => {
    const report = buildListenerReport(CHAIN, [], { types: ['resize', 'keydown'] }).listeners;
    assert.deepEqual(
      report.map((listener) => listener.type),
      ['keydown', 'resize']
    );
  });
});

void describe('delegatedOnlyTypes', () => {
  void it('lists interaction types with listeners only above the element', () => {
    const withoutTarget = buildListenerReport(CHAIN.slice(1), []).listeners;
    assert.deepEqual(delegatedOnlyTypes(withoutTarget), ['click']);
  });

  void it('is empty when the element has its own listener', () => {
    assert.deepEqual(delegatedOnlyTypes(buildListenerReport(CHAIN, []).listeners), []);
  });
});

/** React's event types on its root container (a sample; React registers about 90) */
const REACT_TYPES = [
  'click',
  'keydown',
  'pointerdown',
  'input',
  'focusin',
  'scroll',
  'wheel',
  'drag',
  'drop',
  'copy',
];

/**
 * A React-like page: a no-op `onclick` on the button, and React's root
 * container listening for many types (capture and bubble) with two dispatchers.
 */
const REACT_CHAIN: ChainListeners[] = [
  {
    position: 0,
    entry: { className: 'HTMLButtonElement', description: 'button.cta' },
    listeners: [cdpListener('click', 'function u0(){}')],
  },
  {
    position: 1,
    entry: { className: 'HTMLDivElement', description: 'div#__next', framework: 'React root' },
    listeners: REACT_TYPES.flatMap((type, i) =>
      [true, false].map((useCapture) => ({
        ...cdpListener(type, 'function () { [native code] }', { useCapture }),
        lineNumber: i % 2,
      }))
    ),
  },
  {
    position: 2,
    entry: { className: 'HTMLDocument', description: '#document' },
    listeners: [cdpListener('click', 'function analytics(e) { track(e) }')],
  },
];

void describe('framework listeners', () => {
  void it('collapses a framework root into one entry per node', () => {
    const report = buildListenerReport(REACT_CHAIN, []);
    assert.deepEqual(
      report.listeners.map((l) => `${l.type}:${l.on}`),
      ['click:target', 'click:document']
    );
    assert.equal(report.collapsed.length, 1);
    const [root] = report.collapsed;
    assert.equal(root?.node, 'div#__next');
    assert.equal(root?.framework, 'React root');
    assert.equal(root?.count, 20);
    assert.deepEqual(root?.types, [...REACT_TYPES].sort());
    assert.equal(root?.capture && root.bubble, true);
    assert.equal(root?.handlers.length, 2);
  });

  void it('lists every listener with all, and does not collapse a few types', () => {
    assert.equal(buildListenerReport(REACT_CHAIN, [], { all: true }).listeners.length, 22);
    const clicks = buildListenerReport(REACT_CHAIN, [], { types: ['click'] });
    assert.equal(clicks.collapsed.length, 0);
    assert.equal(clicks.listeners.length, 4);
  });

  void it("does not count React's no-op onclick as the element's handler", () => {
    assert.ok(isNoopSource('function u0(){}'));
    assert.ok(isNoopSource('() => { }'));
    assert.ok(!isNoopSource('function onSave(e) {}'));
    assert.ok(!isNoopSource('() => go()'));
    const report = buildListenerReport(REACT_CHAIN, []);
    assert.equal(report.listeners[0]?.noop, true);
    assert.ok(delegatedOnlyTypes(report.listeners, report.collapsed).includes('click'));
  });

  void it("shows jQuery's handlers instead of its dispatcher", () => {
    const chain: ChainListeners[] = [
      {
        position: 0,
        entry: { className: 'HTMLDivElement', description: 'div.row' },
        listeners: [cdpListener('click', 'function(e){return jQuery.event.dispatch(e)}')],
      },
      {
        position: 1,
        entry: { className: 'HTMLDocument', description: '#document' },
        listeners: [
          cdpListener('click', 'function(e){return jQuery.event.dispatch(e)}'),
          cdpListener('keydown', 'function(e){return jQuery.event.dispatch(e)}'),
        ],
      },
    ];
    const resolved = (name: string, selector?: string): ResolvedHandler => ({
      type: 'click',
      selector,
      name,
      source: `function ${name}() { go() }`,
      scriptId: '7',
      lineNumber: 1,
      columnNumber: 2,
    });
    const report = buildListenerReport(chain, [
      { jquery: [resolved('rowOwn')] },
      { jquery: [resolved('rowClicked', '.row')] },
      { jquery: [] },
    ]);
    assert.deepEqual(
      report.listeners.map((l) => [l.on, l.handler.name, l.framework, l.delegateSelector]),
      [
        ['target', 'rowOwn', 'jQuery', undefined],
        ['document', 'rowClicked', 'jQuery', '.row'],
      ]
    );
    assert.equal(report.listeners[1]?.handler.preview, 'function rowClicked() { go() }');
    assert.equal(report.listeners[1]?.handler.scriptId, '7');
  });
});

void describe('suggestEventTypes', () => {
  void it('suggests the listened type for case and on… typos', () => {
    const available = ['click', 'keydown', 'mouseover'];
    assert.deepEqual(suggestEventTypes(['Click'], available), ['click']);
    assert.deepEqual(suggestEventTypes(['onclick'], available), ['click']);
    assert.deepEqual(suggestEventTypes(['keydwn'], available), ['keydown']);
    assert.deepEqual(suggestEventTypes(['submit'], available), []);
  });
});
