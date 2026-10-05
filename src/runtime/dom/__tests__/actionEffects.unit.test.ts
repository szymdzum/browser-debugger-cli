/**
 * What a DOM action changed: new messages, navigation, "no effect", and how
 * they read in human output.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { submitNetworkBusyWarning, submitTimeoutError } from '@/errors/messages.js';
import {
  hadNoEffect,
  newMessages,
  pageNavigation,
  type NavigationEvents,
  type ReadSnapshot,
  type SeenMessage,
} from '@/runtime/dom/actionEffects.js';
import { MOVED_VALUE_JS } from '@/runtime/dom/reactEventHelpers.js';
import {
  actionStatusLine,
  newMessageText,
  pageNavigationText,
  valueMismatchWarning,
} from '@/ui/messages/commands.js';

/**
 * A message as a page snapshot lists it.
 *
 * @param id - Element number
 * @param text - Visible text
 * @param element - Element description
 * @returns Snapshot entry
 */
function seen(id: number, text: string, element = 'div.flash'): SeenMessage {
  return { id, text, element };
}

/**
 * Navigation events with nothing seen.
 *
 * @param fields - Events to set
 * @returns Events
 */
function events(fields: Partial<NavigationEvents> = {}): NavigationEvents {
  return { statusByLoader: new Map(), ...fields };
}

/**
 * A page read after the action, in the same document by default.
 *
 * @param fields - Fields to set
 * @returns Snapshot
 */
function read(fields: Partial<ReadSnapshot> = {}): ReadSnapshot {
  return { href: 'https://shop.test/cart', fresh: false, changes: 0, messages: [], ...fields };
}

const NOTHING_ELSE = { requests: 0, dialogs: 0, opened: false };

void describe('newMessages', () => {
  void it('reports a message that appeared, but not one that was already shown', () => {
    const before = [seen(1, 'Welcome back')];
    const after = [
      seen(1, 'Welcome back'),
      seen(2, 'Your password is invalid!', 'div#flash.error'),
    ];
    assert.deepEqual(newMessages(before, after, false), [
      { text: 'Your password is invalid!', element: 'div#flash.error' },
    ]);
  });

  void it('reports an element whose text changed', () => {
    assert.deepEqual(newMessages([seen(1, '1 item added')], [seen(1, '2 items added')], false), [
      { text: '2 items added', element: 'div.flash' },
    ]);
  });

  void it('ignores a message re-rendered with the same text, but not a second copy', () => {
    assert.deepEqual(newMessages([seen(1, 'Required')], [seen(5, 'Required')], false), []);
    assert.deepEqual(
      newMessages([seen(1, 'Required')], [seen(1, 'Required'), seen(2, 'Required')], false),
      [{ text: 'Required', element: 'div.flash' }]
    );
  });

  void it('counts every message of a new document as new', () => {
    assert.deepEqual(newMessages([seen(1, 'Invalid')], [seen(1, 'Invalid')], true), [
      { text: 'Invalid', element: 'div.flash' },
    ]);
  });

  void it('reports at most three texts, each once and at most 120 characters', () => {
    const after = [
      seen(1, 'a'),
      seen(2, 'a'),
      seen(3, 'b'),
      seen(4, 'c'),
      seen(5, 'x'.repeat(200)),
    ];
    const found = newMessages([], after, false);
    assert.deepEqual(
      found.map((message) => message.text),
      ['a', 'b', 'c']
    );
    const long = newMessages([], [seen(1, 'x'.repeat(200))], false)[0]?.text ?? '';
    assert.equal(Array.from(long).length, 120);
    assert.ok(long.endsWith('…'));
  });
});

void describe('pageNavigation', () => {
  void it('reports a new document with its status, also at the same URL', () => {
    const navigated = events({
      document: { url: 'https://site.test/login', loaderId: 'L2' },
      statusByLoader: new Map([['L2', 200]]),
    });
    assert.deepEqual(
      pageNavigation(
        'https://site.test/login',
        read({ href: 'https://site.test/login', fresh: true }),
        navigated
      ),
      { url: 'https://site.test/login', sameDocument: false, status: 200 }
    );
  });

  void it('uses the event URL when the page could not be read', () => {
    const navigated = events({ document: { url: 'https://site.test/secure', loaderId: 'L3' } });
    assert.deepEqual(pageNavigation('https://site.test/login', undefined, navigated), {
      url: 'https://site.test/secure',
      sameDocument: false,
    });
  });

  void it('reports a same-document URL change, and nothing when the URL stayed', () => {
    assert.deepEqual(
      pageNavigation(
        'https://todo.test/#/',
        read({ href: 'https://todo.test/#/active' }),
        events()
      ),
      { url: 'https://todo.test/#/active', sameDocument: true }
    );
    assert.equal(
      pageNavigation('https://todo.test/', read({ href: 'https://todo.test/' }), events()),
      undefined
    );
    assert.deepEqual(
      pageNavigation(
        'https://todo.test/',
        undefined,
        events({ withinDocumentUrl: 'https://todo.test/b' })
      ),
      { url: 'https://todo.test/b', sameDocument: true }
    );
  });
});

void describe('hadNoEffect', () => {
  void it('claims no effect only when nothing at all happened', () => {
    assert.equal(hadNoEffect(read(), {}, NOTHING_ELSE), true);
  });

  void it('does not claim it after a change, request, dialog, window or navigation', () => {
    assert.equal(hadNoEffect(read({ changes: 1 }), {}, NOTHING_ELSE), false);
    assert.equal(hadNoEffect(read(), {}, { ...NOTHING_ELSE, requests: 1 }), false);
    assert.equal(hadNoEffect(read(), {}, { ...NOTHING_ELSE, dialogs: 1 }), false);
    assert.equal(hadNoEffect(read(), {}, { ...NOTHING_ELSE, opened: true }), false);
    assert.equal(
      hadNoEffect(read(), { navigation: { url: 'x', sameDocument: true } }, NOTHING_ELSE),
      false
    );
    assert.equal(
      hadNoEffect(read(), { messages: [{ text: 'Saved', element: 'div' }] }, NOTHING_ELSE),
      false
    );
  });

  void it('does not claim it when the check is uncertain or the page was not read', () => {
    assert.equal(hadNoEffect(read({ uncertain: 'control' }), {}, NOTHING_ELSE), false);
    assert.equal(hadNoEffect(read({ fresh: true }), {}, NOTHING_ELSE), false);
    const { changes: _changes, ...uncounted } = read();
    assert.equal(hadNoEffect(uncounted, {}, NOTHING_ELSE), false);
    assert.equal(hadNoEffect(undefined, {}, NOTHING_ELSE), false);
  });
});

void describe('effect output', () => {
  void it('says when an action had no visible effect', () => {
    assert.equal(
      actionStatusLine('Element Clicked', false, true),
      '⚠ Element Clicked (no visible effect: no DOM change, no requests, no navigation)'
    );
    assert.equal(actionStatusLine('Element Clicked', true), '⚠ Element Clicked (with warnings)');
    assert.equal(actionStatusLine('Element Clicked', false), '✓ Element Clicked');
  });

  void it('describes navigations and new messages', () => {
    assert.equal(
      pageNavigationText({ url: 'https://site.test/secure', sameDocument: false, status: 200 }),
      'navigated to https://site.test/secure (200)'
    );
    assert.equal(
      pageNavigationText({ url: 'https://todo.test/#/active', sameDocument: true }),
      'URL changed to https://todo.test/#/active (same document)'
    );
    assert.equal(
      newMessageText({ text: 'Your password is invalid!', element: 'div#flash.flash.error' }),
      '"Your password is invalid!" (div#flash.flash.error)'
    );
  });
});

void describe('fill value moved to another field', () => {
  const movedTo = vm.runInNewContext(`(${MOVED_VALUE_JS})`) as (
    field: Record<string, unknown>,
    expected: string
  ) => string | undefined;

  /**
   * A form-like object holding fields.
   *
   * @param fields - Field-like objects
   * @returns Fields, each pointing at the form
   */
  function inForm(...fields: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const form = { elements: fields };
    return fields.map((field) => Object.assign(field, { form }));
  }

  void it('names the field holding the value given', () => {
    const [first, last] = inForm(
      { localName: 'input', type: 'text', id: 'first-name', value: 'Lovelace' },
      { localName: 'input', type: 'text', id: 'last-name', value: '' }
    );
    assert.equal(movedTo(last ?? {}, 'Lovelace'), 'input#first-name');
    assert.equal(movedTo(first ?? {}, 'Ada'), undefined);
  });

  void it('names a field without id by its name, and never searches for passwords', () => {
    const [, last] = inForm(
      { localName: 'input', type: 'text', id: '', name: 'first', value: 'Lovelace' },
      { localName: 'input', type: 'text', id: '', name: 'last', value: '' }
    );
    assert.equal(movedTo(last ?? {}, 'Lovelace'), 'input[name="first"]');
    const [, password] = inForm(
      { localName: 'input', type: 'text', id: 'user', value: 'hunter2' },
      { localName: 'input', type: 'password', id: 'pass', value: '' }
    );
    assert.equal(movedTo(password ?? {}, 'hunter2'), undefined);
  });

  void it('says where the value went in the warning', () => {
    assert.equal(
      valueMismatchWarning({ expected: 'Lovelace', actual: '', movedTo: 'input#first-name' }),
      'The field\'s value is "" after filling (expected "Lovelace"); the value appeared in input#first-name instead'
    );
  });
});

void describe('submit wait messages', () => {
  void it('suggests fetch only when the form sent no page request', () => {
    assert.match(submitTimeoutError(10000, true).suggestion, /sent no page request.*fetch/);
    const sent = submitTimeoutError(10000, true, 'POST https://site.test/authenticate');
    assert.doesNotMatch(sent.suggestion, /fetch/);
    assert.match(sent.suggestion, /POST https:\/\/site\.test\/authenticate.*larger --timeout/);
  });

  void it('warns when the new page loaded but requests kept running', () => {
    assert.equal(
      submitNetworkBusyWarning(10000, 2),
      'The new page loaded, but 2 requests still had not finished after 10000ms'
    );
  });
});
