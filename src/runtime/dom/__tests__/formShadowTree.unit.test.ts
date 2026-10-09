/**
 * Page-side composed tree helpers of form discovery: order across open
 * shadow roots, and `closest()` that climbs out of them.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { COMPOSED_CLOSEST_JS, COMPOSED_ORDER_JS } from '@/runtime/dom/formDiscovery.js';

/** Minimal element: its tree, position in it and the selectors `closest()` finds */
interface FakeElement {
  name: string;
  position: number;
  root: { host?: FakeElement };
  closestMatches: Record<string, FakeElement>;
  getRootNode(): { host?: FakeElement };
  closest(selector: string): FakeElement | null;
  compareDocumentPosition(other: FakeElement): number;
}

/**
 * Make a fake element.
 *
 * @param name - Name for messages
 * @param position - Document order within its tree
 * @param root - Its tree (document or shadow root)
 * @returns The element
 */
function element(name: string, position: number, root: { host?: FakeElement }): FakeElement {
  return {
    name,
    position,
    root,
    closestMatches: {},
    getRootNode() {
      return this.root;
    },
    closest(selector: string) {
      return this.closestMatches[selector] ?? null;
    },
    compareDocumentPosition(other: FakeElement) {
      return other.position > this.position ? 4 : 2;
    },
  };
}

const composedOrder = vm.runInNewContext(COMPOSED_ORDER_JS) as (
  a: FakeElement,
  b: FakeElement
) => number;
const composedClosest = vm.runInNewContext(COMPOSED_CLOSEST_JS) as (
  el: FakeElement,
  selector: string
) => FakeElement | null;

/**
 * A page: `before`, a host whose shadow root holds `inner` (and a nested
 * host holding `deep`), and `after`.
 *
 * @returns The elements
 */
function page(): Record<'before' | 'host' | 'inner' | 'nested' | 'deep' | 'after', FakeElement> {
  const document = {};
  const before = element('before', 1, document);
  const host = element('host', 2, document);
  const after = element('after', 3, document);
  const shadow = { host };
  const inner = element('inner', 1, shadow);
  const nested = element('nested', 2, shadow);
  const deep = element('deep', 1, { host: nested });
  return { before, host, inner, nested, deep, after };
}

void describe('COMPOSED_ORDER_JS', () => {
  void it('puts shadow content right after its host, before what follows the host', () => {
    const { before, host, inner, nested, deep, after } = page();
    const sorted = [after, deep, inner, before, nested, host].sort(composedOrder);
    assert.deepEqual(
      sorted.map((el) => el.name),
      ['before', 'host', 'inner', 'nested', 'deep', 'after']
    );
  });
});

void describe('COMPOSED_CLOSEST_JS', () => {
  void it('finds the form around a host for a field in its shadow root', () => {
    const { host, deep, nested } = page();
    const form = element('form', 0, {});
    host.closestMatches['form'] = form;
    assert.equal(composedClosest(deep, 'form'), form);
    const innerForm = element('inner-form', 0, {});
    nested.closestMatches['form'] = innerForm;
    assert.equal(composedClosest(deep, 'form'), innerForm, 'the closest tree wins');
  });

  void it('returns null when no tree has a match', () => {
    assert.equal(composedClosest(page().deep, 'form'), null);
  });
});
