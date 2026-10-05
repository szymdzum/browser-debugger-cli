/**
 * Page-side parts of the action-effects scripts, run in an isolated VM
 * context on element-like objects: focus/hover churn, why "no effect" can't
 * be claimed, and which parts of a message are its close controls.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import {
  CHURN_ONLY_JS,
  MESSAGE_CHROME_JS,
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
