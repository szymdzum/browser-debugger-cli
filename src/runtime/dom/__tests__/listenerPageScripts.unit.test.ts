/**
 * The page-side part of `dom listeners`, run against fake DOM objects:
 * jQuery handlers behind its dispatcher, React's `on…` props, function
 * identities, and pages whose globals throw.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import {
  ELEMENT_INFO_JS,
  MAX_JQUERY_HANDLERS,
  MAX_REACT_HANDLERS,
  type ElementInfo,
} from '@/runtime/dom/listenerPageScripts.js';

type PageFunction = (this: object, ...args: unknown[]) => [ElementInfo, ...unknown[]];

const elementInfo = vm.runInThisContext(`(${ELEMENT_INFO_JS})`) as PageFunction;

/** jQuery's dispatcher on the fake document */
const dispatcher = function jQueryDispatch(): void {};

/**
 * A fake `div.row` inside a fake document whose window has `jQuery` set up
 * by `defineJQuery`.
 *
 * @param defineJQuery - Defines `jQuery` on the window
 * @param events - jQuery's events of the document
 * @returns Element and document
 */
function fakePage(
  defineJQuery: (view: object, data: unknown) => void,
  events: Record<string, unknown[]>
): { element: object; document: object } {
  const document = { nodeType: 9, parentNode: null };
  const view = { frameElement: null };
  defineJQuery(view, { handle: dispatcher, events });
  const element = {
    nodeType: 1,
    parentNode: document,
    ownerDocument: { defaultView: view },
    matches: (selector: string) => selector === '.row',
  };
  return { element, document };
}

/**
 * A plain jQuery stand-in whose `_data` knows the document only.
 *
 * @param document - Fake document (filled in later)
 * @returns Definer for {@link fakePage}
 */
function plainJQuery(document: { node?: object }): (view: object, data: unknown) => void {
  return (view, data) => {
    Object.assign(view, {
      jQuery: { _data: (node: object) => (node === document.node ? data : undefined) },
    });
  };
}

/**
 * jQuery handler objects for `click`.
 *
 * @param count - How many delegates for `.row`
 * @returns Handler objects, plus one for `.nomatch`
 */
function clickHandlers(count: number): unknown[] {
  const rows = Array.from({ length: count }, (_, i) => ({
    type: 'click',
    selector: '.row',
    handler: Object.defineProperty(() => undefined, 'name', { value: `row${i}` }),
  }));
  return [...rows, { type: 'click', selector: '.nomatch', handler: function neverRuns(): void {} }];
}

void describe('ELEMENT_INFO_JS', () => {
  void it('resolves the jQuery delegates that match the element', () => {
    const doc: { node?: object } = {};
    const { element, document } = fakePage(plainJQuery(doc), { click: clickHandlers(1) });
    doc.node = document;
    const [info, ...fns] = elementInfo.call(
      element,
      [{ position: 1, type: 'click' }],
      null,
      element,
      document,
      dispatcher,
      null
    );
    assert.deepEqual(info.listeners[0]?.jquery, [
      { type: 'click', selector: '.row', name: 'row0' },
    ]);
    assert.equal(fns.length, 1);
    assert.equal(info.jquerySkipped, 0);
  });

  void it('stops resolving after the limit and counts the rest', () => {
    const doc: { node?: object } = {};
    const { element, document } = fakePage(plainJQuery(doc), {
      click: clickHandlers(MAX_JQUERY_HANDLERS + 1),
    });
    doc.node = document;
    const [info] = elementInfo.call(
      element,
      [{ position: 1, type: 'click' }],
      null,
      element,
      document,
      dispatcher,
      null
    );
    assert.equal(info.listeners[0]?.jquery, undefined);
    assert.equal(info.jquerySkipped, MAX_JQUERY_HANDLERS + 1);
  });

  void it('only loses the jQuery details when the jQuery getter throws', () => {
    const throwing = (view: object): void => {
      Object.defineProperty(view, 'jQuery', {
        get: () => {
          throw new Error('blocked');
        },
      });
    };
    const { element, document } = fakePage(throwing, {});
    const [info] = elementInfo.call(
      element,
      [{ position: 1, type: 'click' }],
      null,
      element,
      document,
      dispatcher,
      null
    );
    assert.deepEqual(info.listeners, [
      { name: 'jQueryDispatch', identity: 0, targetName: 'jQueryDispatch' },
    ]);
  });

  void it('gives bound handlers the identity of the function they call', () => {
    const { element, document } = fakePage(() => undefined, {});
    const dispatch = function dispatchDiscreteEvent(): void {};
    const other = function dispatchDiscreteEvent(): void {};
    const listeners = ['click', 'keydown', 'input'].map((type) => ({ position: 1, type }));
    const bound = [dispatch.bind(null), dispatch.bind(null), other.bind(null)];
    const [info] = elementInfo.call(
      element,
      listeners,
      null,
      element,
      document,
      ...bound,
      dispatch,
      dispatch,
      other
    );
    assert.deepEqual(
      info.listeners.map((l) => [l.name, l.identity, l.targetName]),
      [
        ['bound dispatchDiscreteEvent', 0, 'dispatchDiscreteEvent'],
        ['bound dispatchDiscreteEvent', 0, 'dispatchDiscreteEvent'],
        ['bound dispatchDiscreteEvent', 1, 'dispatchDiscreteEvent'],
      ]
    );
  });
});

/**
 * A fake button inside a fake div (React's DOM nodes carry their props
 * under keys with a random suffix), inside a document without jQuery.
 *
 * @param buttonKeys - Own keys of the button
 * @param divKeys - Own keys of the div
 * @returns The chain: button, div, document
 */
function reactChain(buttonKeys: object, divKeys: object): [object, object, object] {
  const document = { nodeType: 9, parentNode: null };
  const div = { nodeType: 1, localName: 'div', parentNode: document, ...divKeys };
  const button = {
    nodeType: 1,
    localName: 'button',
    parentNode: div,
    ownerDocument: { defaultView: { frameElement: null } },
    ...buttonKeys,
  };
  return [button, div, document];
}

/**
 * Run the page function on a chain without listeners.
 *
 * @param chain - Element first
 * @param types - Requested event types
 * @returns Page report and the React handler functions
 */
function reactInfo(
  chain: object[],
  types: string[] | null = null
): { info: ElementInfo; fns: unknown[] } {
  const [info, ...fns] = elementInfo.call(chain[0] ?? {}, [], types, ...chain);
  return { info, fns };
}

/**
 * Types and phases of the React props of a button.
 *
 * @param props - The button's props
 * @returns `prop:type:capture` per resolved prop
 */
function resolvedTypes(props: object): string[] {
  const { info } = reactInfo(reactChain({ __reactProps$a: props }, {}));
  return info.react.map((r) => `${r.prop}:${r.type}:${r.capture}`);
}

void describe('ELEMENT_INFO_JS React props', () => {
  void it('resolves on… props of the element and its ancestors', () => {
    const handleBuy = function handleBuy(): void {};
    const keys = (): void => undefined;
    const chain = reactChain(
      { __reactProps$abc: { onClick: handleBuy, className: 'cta', children: 'Buy' } },
      { __reactProps$abc: { onKeyDownCapture: keys, onDoubleClick: keys } }
    );
    const { info, fns } = reactInfo(chain);
    assert.deepEqual(info.react, [
      { position: 0, prop: 'onClick', type: 'click', capture: false, name: 'handleBuy' },
      { position: 1, prop: 'onKeyDownCapture', type: 'keydown', capture: true, name: 'keys' },
      { position: 1, prop: 'onDoubleClick', type: 'dblclick', capture: false, name: 'keys' },
    ]);
    assert.deepEqual(fns, [handleBuy, keys, keys]);
    assert.equal(info.reactSkipped, 0);
  });

  void it("reads React 16's event handler props and a fiber's memoizedProps", () => {
    const submit = function save(): void {};
    const { info } = reactInfo(reactChain({ __reactEventHandlers$q1: { onSubmit: submit } }, {}));
    assert.deepEqual(
      info.react.map((r) => [r.prop, r.type, r.name]),
      [['onSubmit', 'submit', 'save']]
    );
    const fiber = { type: 'button', memoizedProps: { onInput: submit }, return: null };
    const chain = reactChain({ __reactFiber$q1: fiber }, {});
    Object.assign(fiber, { stateNode: chain[0] });
    assert.deepEqual(
      reactInfo(chain).info.react.map((r) => r.prop),
      ['onInput']
    );
  });

  void it('maps pointer capture, focus and double-click props to their DOM types', () => {
    const fn = (): void => undefined;
    assert.deepEqual(
      resolvedTypes({
        onGotPointerCapture: fn,
        onLostPointerCaptureCapture: fn,
        onFocus: fn,
        onBlurCapture: fn,
        onDoubleClick: fn,
      }),
      [
        'onGotPointerCapture:gotpointercapture:false',
        'onLostPointerCaptureCapture:lostpointercapture:true',
        'onFocus:focusin:false',
        'onBlurCapture:focusout:true',
        'onDoubleClick:dblclick:false',
      ]
    );
  });

  void it("leaves out ancestors' props for events React does not bubble", () => {
    const fn = (): void => undefined;
    const chain = reactChain(
      { __reactProps$a: { onMouseEnter: fn, onScroll: fn } },
      {
        __reactProps$a: {
          onMouseEnter: fn,
          onScroll: fn,
          onScrollCapture: fn,
          onLoad: fn,
          onClick: fn,
        },
      }
    );
    assert.deepEqual(
      reactInfo(chain).info.react.map((r) => `${r.position}:${r.prop}`),
      ['0:onMouseEnter', '0:onScroll', '1:onScrollCapture', '1:onClick']
    );
  });

  void it("follows the fiber's React parents through a portal", () => {
    const fn = (): void => undefined;
    const [button, portalHost, document] = reactChain({}, {});
    const modal = { nodeType: 1, localName: 'div', id: 'modal', classList: ['card'] };
    const rootFiber = { tag: 3, type: null, stateNode: {}, return: null };
    const modalFiber = { type: 'div', stateNode: modal, return: rootFiber };
    const componentFiber = {
      type: function Dialog(): void {},
      stateNode: null,
      return: modalFiber,
    };
    const buttonFiber = { type: 'button', stateNode: button, return: componentFiber };
    Object.assign(button, { __reactFiber$p: buttonFiber, __reactProps$p: { onClick: fn } });
    Object.assign(modal, { __reactProps$p: { onClick: fn, onKeyDown: fn } });
    Object.assign(portalHost, { __reactProps$p: { onClick: fn } });
    const { info } = reactInfo([button, portalHost, document]);
    assert.deepEqual(
      info.react.map((r) => [r.position, r.node, r.prop]),
      [
        [0, undefined, 'onClick'],
        [null, 'div#modal.card', 'onClick'],
        [null, 'div#modal.card', 'onKeyDown'],
      ]
    );
  });

  void it('runs no getters of the page and skips props that are no functions', () => {
    let getterRan = false;
    const props = { onFocus: 'not a function', onBlur: null, onclick: (): void => undefined };
    Object.defineProperty(props, 'onChange', {
      enumerable: true,
      get: () => {
        getterRan = true;
        return () => undefined;
      },
    });
    const throwingKeys = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('blocked');
        },
      }
    );
    const { info } = reactInfo(reactChain({ __reactProps$a: props }, {}));
    assert.deepEqual(info.react, []);
    assert.equal(getterRan, false);
    assert.deepEqual(reactInfo([throwingKeys, ...reactChain({}, {}).slice(1)]).info.react, []);
  });

  void it('stops after the limit, counting only the requested types', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_REACT_HANDLERS + 3 }, (_, i) => [
        `onEvent${i}`,
        (): void => undefined,
      ])
    );
    const { info, fns } = reactInfo(reactChain({ __reactProps$a: many }, {}));
    assert.equal(info.react.length, MAX_REACT_HANDLERS);
    assert.equal(fns.length, MAX_REACT_HANDLERS);
    assert.equal(info.reactSkipped, 3);
    const withClick = { ...many, onClick: (): void => undefined };
    const clicks = reactInfo(reactChain({ __reactProps$a: withClick }, {}), ['click']).info;
    assert.deepEqual(
      clicks.react.map((r) => r.prop),
      ['onClick']
    );
    assert.equal(clicks.reactSkipped, 0);
  });
});
