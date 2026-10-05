/**
 * Page-side parts of the action-effects scripts, run in an isolated VM
 * context on element-like objects: focus/hover churn, structural changes,
 * why "no effect" can't be claimed, which parts of a message are its close
 * controls, and the timers an action's handlers start.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import {
  CHURN_ONLY_JS,
  MESSAGE_CHROME_JS,
  STRUCTURAL_CHANGE_JS,
  TIMER_HOOK_JS,
  UNCERTAIN_JS,
} from '@/runtime/dom/actionEffectsScripts.js';

type FakeNode = Record<string, unknown>;

/**
 * An element-like object.
 *
 * @param localName - Tag name
 * @param attributes - Attributes
 * @param fields - Other properties (protocol, target, shadowRoot, …)
 * @returns Element stand-in
 */
function element(
  localName: string,
  attributes: Record<string, string> = {},
  fields: FakeNode = {}
): FakeNode {
  return {
    localName,
    nodeType: 1,
    getAttribute: (name: string) => attributes[name] ?? null,
    hasAttribute: (name: string) => name in attributes,
    ...fields,
  };
}

const churnOnly = vm.runInNewContext(`(${CHURN_ONLY_JS})`) as (
  record: FakeNode,
  targets: Set<unknown>
) => boolean;

const uncertain = vm.runInNewContext(`(${UNCERTAIN_JS})`) as (
  state: FakeNode,
  active: unknown
) => string | undefined;

const isChrome = vm.runInNewContext(`(${MESSAGE_CHROME_JS})`) as (node: FakeNode) => boolean;

const structural = vm.runInNewContext(`(${STRUCTURAL_CHANGE_JS})`) as (record: FakeNode) => boolean;

/**
 * Watch state after an action whose events hit `target` through `path`.
 *
 * @param target - Element the events hit
 * @param path - Its ancestors in the event path
 * @param fields - Other state (copied, focus)
 * @returns State stand-in
 */
function hitState(target: FakeNode, path: FakeNode[] = [], fields: FakeNode = {}): FakeNode {
  return { targets: new Set([target]), path: new Set([target, ...path]), copied: false, ...fields };
}

void describe('CHURN_ONLY_JS', () => {
  const button = element('button', { class: 'btn Mui-focusVisible' });

  void it('ignores focus and hover classes coming and going on the element hit', () => {
    const record = { type: 'attributes', attributeName: 'class', target: button, oldValue: 'btn' };
    assert.equal(churnOnly(record, new Set([button])), true);
  });

  void it('counts other class changes, other elements and other mutations', () => {
    const toggled = element('button', { class: 'btn active' });
    const record = { type: 'attributes', attributeName: 'class', target: toggled, oldValue: 'btn' };
    assert.equal(churnOnly(record, new Set([toggled])), false);
    const elsewhere = {
      type: 'attributes',
      attributeName: 'class',
      target: button,
      oldValue: 'btn',
    };
    assert.equal(churnOnly(elsewhere, new Set()), false);
    assert.equal(churnOnly({ type: 'childList', target: button }, new Set([button])), false);
  });
});

void describe('UNCERTAIN_JS', () => {
  const body = element('body');

  void it('has no reason for a plain button that kept focus', () => {
    const button = element('button');
    assert.equal(uncertain(hitState(button, [body], { focus: button }), button), undefined);
  });

  void it('gives up on controls, popover buttons, closed custom elements and copies', () => {
    assert.equal(uncertain(hitState(element('input'), [body]), body), 'control');
    assert.equal(uncertain(hitState(element('span'), [element('label')]), body), 'control');
    const popover = element('button', { popovertarget: 'menu' });
    assert.equal(uncertain(hitState(popover), body), 'control');
    assert.equal(
      uncertain(hitState(element('x-card', {}, { shadowRoot: null })), body),
      'closed-shadow'
    );
    assert.equal(uncertain(hitState(element('button'), [], { copied: true }), body), 'clipboard');
    assert.equal(
      uncertain({ targets: new Set(), path: new Set(), copied: false }, body),
      'no-event'
    );
  });

  void it('gives up while a timer the action started is pending', () => {
    const button = element('button');
    const state = hitState(button, [body], { focus: button, timers: new Map([[1, 1500]]) });
    assert.equal(uncertain(state, button), 'timer');
  });

  void it('gives up on mailto:, tel: and javascript: links and links to other windows', () => {
    for (const protocol of ['mailto:', 'tel:', 'javascript:', 'slack:']) {
      const link = element('a', { href: 'x' }, { protocol, target: '' });
      assert.equal(uncertain(hitState(link), body), 'external-link', protocol);
    }
    const web = element('a', { href: '/x' }, { protocol: 'https:', target: '' });
    assert.equal(uncertain(hitState(web), body), undefined);
    const blank = element('a', { href: '/x' }, { protocol: 'https:', target: '_blank' });
    assert.equal(uncertain(hitState(blank), body), 'new-window');
  });

  void it('gives up when focus moved to an element that may reveal content with CSS', () => {
    const trigger = element('div', { tabindex: '0' });
    assert.equal(uncertain(hitState(trigger, [], { focus: body }), trigger), 'focus');
  });
});

void describe('MESSAGE_CHROME_JS', () => {
  void it('treats close links, buttons and aria-hidden parts as chrome', () => {
    assert.equal(isChrome(element('a', { class: 'close' })), true);
    assert.equal(isChrome(element('span', { class: 'btn-close icon' })), true);
    assert.equal(isChrome(element('span', { 'aria-label': 'Dismiss' })), true);
    assert.equal(isChrome(element('button')), true);
    assert.equal(isChrome(element('svg', { 'aria-hidden': 'true' })), true);
  });

  void it('keeps text in elements whose class merely contains "close"', () => {
    for (const name of ['closeable', 'enclosed', 'disclosure', 'closed']) {
      assert.equal(isChrome(element('span', { class: name })), false, name);
    }
  });
});

void describe('STRUCTURAL_CHANGE_JS', () => {
  const node = (nodeType: number): FakeNode => ({ nodeType });

  void it('counts added or removed elements and attribute changes other than style', () => {
    assert.equal(structural({ type: 'childList', addedNodes: [node(1)], removedNodes: [] }), true);
    assert.equal(structural({ type: 'childList', addedNodes: [], removedNodes: [node(1)] }), true);
    assert.equal(structural({ type: 'attributes', attributeName: 'class' }), true);
  });

  void it('ignores text-only changes and style animations', () => {
    assert.equal(
      structural({ type: 'childList', addedNodes: [node(3)], removedNodes: [node(3)] }),
      false
    );
    assert.equal(structural({ type: 'characterData' }), false);
    assert.equal(structural({ type: 'attributes', attributeName: 'style' }), false);
  });
});

void describe('TIMER_HOOK_JS', () => {
  /** A page with a fake timer API, the hook installed on it */
  function hookedPage(): {
    window: Record<string, unknown>;
    state: { dispatching: boolean; stopped: boolean; timers: Map<number, number> };
    fire: (id: number) => void;
    restore: () => void;
  } {
    const callbacks = new Map<number, () => void>();
    let next = 1;
    const window: Record<string, unknown> = {
      setTimeout: (callback: () => void) => {
        callbacks.set(next, callback);
        return next++;
      },
      clearTimeout: (id: number) => callbacks.delete(id),
    };
    const state = { dispatching: false, stopped: false, timers: new Map<number, number>() };
    const hook = vm.runInNewContext(`(${TIMER_HOOK_JS})`, { window }) as (
      s: typeof state
    ) => () => void;
    const restore = hook(state);
    return { window, state, fire: (id) => callbacks.get(id)?.(), restore };
  }

  void it('tracks timers set while an event is dispatched until they fire or are cleared', () => {
    const page = hookedPage();
    const setTimer = page.window['setTimeout'] as (callback: () => void, ms: number) => number;
    const clearTimer = page.window['clearTimeout'] as (id: number) => void;
    page.state.dispatching = true;
    let fired = false;
    const fires = setTimer(() => (fired = true), 1500);
    const cleared = setTimer(() => undefined, 500);
    assert.deepEqual([...page.state.timers.keys()], [fires, cleared]);
    page.fire(fires);
    clearTimer(cleared);
    assert.equal(fired, true);
    assert.equal(page.state.timers.size, 0);
  });

  void it('ignores timers set outside events, short yields and long timeouts', () => {
    const page = hookedPage();
    const setTimer = page.window['setTimeout'] as (callback: () => void, ms: number) => number;
    setTimer(() => undefined, 1500);
    page.state.dispatching = true;
    setTimer(() => undefined, 0);
    setTimer(() => undefined, 60000);
    assert.equal(page.state.timers.size, 0);
  });

  void it('restores the page timer functions it replaced', () => {
    const page = hookedPage();
    const hooked = page.window['setTimeout'];
    page.restore();
    assert.notEqual(page.window['setTimeout'], hooked);
  });
});
