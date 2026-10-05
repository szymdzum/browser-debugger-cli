/**
 * Building the `bdg dom listeners` report from CDP listener data: placement,
 * names, previews, filtering and nearest-first ordering.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Protocol } from '@/connection/typed-cdp.js';
import {
  buildListenerReport,
  delegationNotes,
  describeChainEntry,
  functionNameFromSource,
  handlerPreview,
  isNoopSource,
  listenerPlacement,
  suggestEventTypes,
  type ChainListeners,
  type HandlerDetails,
  type ReactPropHandler,
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

void describe('delegationNotes', () => {
  void it('notes interaction types with plain listeners only above the element', () => {
    const withoutTarget = buildListenerReport(CHAIN.slice(1), []).listeners;
    assert.deepEqual(delegationNotes(withoutTarget), [
      { kind: 'delegated', types: ['click'], placeholderTypes: [], node: undefined },
    ]);
  });

  void it('is empty when the element has its own listener', () => {
    assert.deepEqual(delegationNotes(buildListenerReport(CHAIN, []).listeners), []);
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

/** Page details of REACT_CHAIN: React binds two dispatcher functions per event type */
const REACT_DETAILS: HandlerDetails[] = [
  {},
  ...REACT_TYPES.flatMap((_type, i) =>
    [0, 1].map(() => ({ name: 'bound zj', identity: i % 2, targetName: i % 2 ? 'Be' : 'zj' }))
  ),
  {},
];

/**
 * A chain of a button below a node whose listeners each cover one of
 * REACT_TYPES, with the given page details.
 *
 * @param entry - The node
 * @param source - Handler source of every listener
 * @returns Chain
 */
function chainBelow(entry: ChainListeners['entry'], source: string): ChainListeners[] {
  return [
    {
      position: 0,
      entry: { className: 'HTMLButtonElement', description: 'button' },
      listeners: [],
    },
    { position: 1, entry, listeners: REACT_TYPES.map((type) => cdpListener(type, source)) },
  ];
}

void describe('framework listeners', () => {
  void it('keeps a multi-type handler on a node that is no framework root', () => {
    const chain = chainBelow(
      { className: 'HTMLDocument', description: '#document' },
      'function track(e) {}'
    );
    const sameFunction = REACT_TYPES.map(() => ({
      name: 'track',
      identity: 7,
      targetName: 'track',
    }));
    const report = buildListenerReport(chain, sameFunction);
    assert.equal(report.collapsed.length, 0);
    assert.equal(report.listeners.length, REACT_TYPES.length);
  });

  void it('does not merge distinct functions that share a source location', () => {
    const root = { className: 'HTMLDivElement', description: 'div#root', framework: 'React root' };
    const chain = chainBelow(root, '() => go()');
    const distinct = REACT_TYPES.map((_type, i) => ({ identity: i }));
    assert.equal(buildListenerReport(chain, distinct).collapsed.length, 0);
    assert.equal(buildListenerReport(chain, []).collapsed.length, 0, 'unknown identities');
  });

  void it("recognises React's dispatchers by name on a node without React's keys", () => {
    const chain = chainBelow({ className: 'HTMLDivElement', description: 'div#app' }, 'x');
    const details = REACT_TYPES.map(() => ({ identity: 3, targetName: 'dispatchDiscreteEvent' }));
    const [root] = buildListenerReport(chain, details).collapsed;
    assert.equal(root?.framework, 'React root');
    assert.equal(root?.count, REACT_TYPES.length);
  });

  void it('collapses a framework root into one entry per node', () => {
    const report = buildListenerReport(REACT_CHAIN, REACT_DETAILS);
    assert.deepEqual(
      report.listeners.map((l) => `${l.type}:${l.on}`),
      ['click:document', 'click:target'],
      'no-op last'
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
    assert.equal(
      buildListenerReport(REACT_CHAIN, REACT_DETAILS, { all: true }).listeners.length,
      22
    );
    const clicks = buildListenerReport(REACT_CHAIN, REACT_DETAILS, { types: ['click'] });
    assert.equal(clicks.collapsed.length, 0);
    assert.equal(clicks.listeners.length, 4);
  });

  void it("does not count React's no-op onclick as the element's handler", () => {
    assert.ok(isNoopSource('function u0(){}'));
    assert.ok(isNoopSource('() => { }'));
    assert.ok(!isNoopSource('function onSave(e) {}'));
    assert.ok(!isNoopSource('() => go()'));
    const report = buildListenerReport(REACT_CHAIN, REACT_DETAILS);
    assert.equal(report.listeners.find((l) => l.on === 'target')?.noop, true);
    const [note] = delegationNotes(report.listeners, report.collapsed);
    assert.equal(note?.kind, 'react-root');
    assert.equal(note?.node, 'div#__next');
    assert.ok(note?.types.includes('click'));
    assert.deepEqual(note?.placeholderTypes, ['click']);
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

/**
 * A React prop handler at a chain position.
 *
 * @param position - Chain position of the element the prop is on
 * @param prop - Prop name
 * @param name - Handler name
 * @returns Prop handler
 */
function reactProp(position: number, prop: string, name: string): ReactPropHandler {
  const capture = prop.endsWith('Capture');
  const type = prop.slice(2, capture ? -7 : undefined).toLowerCase();
  return {
    position,
    prop,
    type,
    capture,
    name,
    source: `function ${name}(e) { buy(e) }`,
    scriptId: '9',
    lineNumber: 0,
    columnNumber: 2344,
  };
}

/** The inspected button and its document, as chain entries */
const BUTTON = { className: 'HTMLButtonElement', description: 'button#save' };
const DOCUMENT = { className: 'HTMLDocument', description: '#document' };

void describe('React prop handlers', () => {
  const props = [reactProp(0, 'onClick', 'handleBuy'), reactProp(1, 'onKeyDownCapture', 'keys')];

  void it('lists them with the element they are on, framework and prop', () => {
    const report = buildListenerReport(REACT_CHAIN, REACT_DETAILS, {}, props);
    assert.deepEqual(report.listeners[0], {
      type: 'click',
      on: 'target',
      node: 'button.cta',
      useCapture: false,
      passive: false,
      once: false,
      handler: {
        name: 'handleBuy',
        preview: 'function handleBuy(e) { buy(e) }',
        scriptId: '9',
        lineNumber: 0,
        columnNumber: 2344,
      },
      framework: 'React',
      reactProp: 'onClick',
    });
    const keys = report.listeners.find((l) => l.reactProp === 'onKeyDownCapture');
    assert.deepEqual(
      [keys?.type, keys?.on, keys?.node, keys?.useCapture],
      ['keydown', 'ancestor', 'div#__next', true]
    );
    assert.equal(report.collapsed[0]?.count, 20, 'props are not collapsed into the root');
  });

  void it("puts the element's handlers first, then ancestors, no-ops last", () => {
    const report = buildListenerReport(REACT_CHAIN, REACT_DETAILS, {}, props);
    assert.deepEqual(
      report.listeners.map((l) => `${l.type}:${l.on}:${l.reactProp ?? (l.noop ? 'noop' : '')}`),
      [
        'click:target:onClick',
        'click:document:',
        'click:target:noop',
        'keydown:ancestor:onKeyDownCapture',
      ]
    );
  });

  void it('orders event types by their nearest handler', () => {
    const chain: ChainListeners[] = [
      { position: 0, entry: BUTTON, listeners: [cdpListener('keydown', 'function u0(){}')] },
      {
        position: 1,
        entry: DOCUMENT,
        listeners: [cdpListener('blur', 'function track(e) { go() }')],
      },
    ];
    const report = buildListenerReport(chain, [], {}, [reactProp(0, 'onSubmit', 'save')]);
    assert.deepEqual(
      report.listeners.map((l) => l.type),
      ['submit', 'blur', 'keydown']
    );
  });

  void it('keeps only the requested event types', () => {
    const report = buildListenerReport(REACT_CHAIN, REACT_DETAILS, { types: ['keydown'] }, props);
    assert.deepEqual(
      report.listeners.map((l) => `${l.type}:${l.reactProp ?? l.on}`),
      ['keydown:onKeyDownCapture', 'keydown:ancestor', 'keydown:ancestor']
    );
  });

  void it("notes React's placeholder when the handler is resolved", () => {
    const report = buildListenerReport(REACT_CHAIN, REACT_DETAILS, {}, props);
    const notes = delegationNotes(report.listeners, report.collapsed);
    assert.deepEqual(notes[0], {
      kind: 'react',
      types: ['click', 'keydown'],
      placeholderTypes: ['click'],
      node: undefined,
    });
    assert.equal(notes[1]?.kind, 'react-root');
    assert.ok(!notes[1]?.types.includes('click'));
  });

  void it("places a portal's React parent outside the chain after the nearer parents", () => {
    const portalParent = {
      ...reactProp(0, 'onClick', 'closeModal'),
      position: null,
      node: 'div#modal',
    };
    const report = buildListenerReport(REACT_CHAIN, REACT_DETAILS, { types: ['click'] }, [
      reactProp(0, 'onClick', 'handleBuy'),
      portalParent,
    ]);
    assert.deepEqual(
      report.listeners.slice(0, 2).map((l) => `${l.on}:${l.node}:${l.handler.name}`),
      ['target:button.cta:handleBuy', 'ancestor:div#modal:closeModal']
    );
  });

  void it('notes jQuery delegation separately from plain delegation', () => {
    const chain: ChainListeners[] = [
      { position: 0, entry: BUTTON, listeners: [] },
      {
        position: 1,
        entry: DOCUMENT,
        listeners: [cdpListener('click', 'function(e){}'), cdpListener('input', 'function(e){}')],
      },
    ];
    const jquery: ResolvedHandler = {
      type: 'click',
      name: 'row',
      scriptId: '1',
      lineNumber: 0,
      columnNumber: 0,
    };
    const report = buildListenerReport(chain, [{ jquery: [jquery] }, {}]);
    assert.deepEqual(
      delegationNotes(report.listeners).map((n) => [n.kind, n.types, n.node]),
      [
        ['jquery', ['click'], 'document'],
        ['delegated', ['input'], undefined],
      ]
    );
  });
});
