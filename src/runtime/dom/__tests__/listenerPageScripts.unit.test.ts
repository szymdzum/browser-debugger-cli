/**
 * The page-side part of `dom listeners`, run against fake DOM objects:
 * jQuery handlers behind its dispatcher, function identities, and pages
 * whose globals throw.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import {
  ELEMENT_INFO_JS,
  MAX_JQUERY_HANDLERS,
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
