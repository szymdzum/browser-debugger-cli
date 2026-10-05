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
import { FIELD_VALUES_JS, MOVED_VALUE_JS } from '@/runtime/dom/reactEventHelpers.js';
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

  void it('leaves out texts that tick on their own (clocks, counters)', () => {
    const before = [seen(1, '12:04:33'), seen(2, '57%'), seen(3, '3 s')];
    const after = [seen(1, '12:04:34'), seen(2, '58%'), seen(3, '2 s'), seen(4, 'Saved 2 items')];
    assert.deepEqual(
      newMessages(before, after, false).map((message) => message.text),
      ['Saved 2 items']
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

  void it('reports a same-document change Chrome announced when the page was not read', () => {
    assert.deepEqual(
      pageNavigation(undefined, undefined, events({ withinDocumentUrl: 'https://todo.test/#/a' })),
      { url: 'https://todo.test/#/a', sameDocument: true }
    );
    assert.equal(pageNavigation(undefined, undefined, events()), undefined);
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
      '⚠ Element Clicked (no visible effect observed: no DOM change, requests or navigation within 300 ms)'
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
  const fieldValues = vm.runInNewContext(`(${FIELD_VALUES_JS})`) as (
    field: Record<string, unknown>
  ) => Map<unknown, string>;
  const movedTo = vm.runInNewContext(`(${MOVED_VALUE_JS})`) as (
    field: Record<string, unknown>,
    expected: string,
    before?: Map<unknown, string>
  ) => string | undefined;

  /**
   * Text fields in one form.
   *
   * @param fields - Field-like objects (localName input and type text added)
   * @returns Fields, each pointing at the form
   */
  function inForm(...fields: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const form = { elements: fields };
    return fields.map((field) =>
      Object.assign(field, { localName: 'input', type: field['type'] ?? 'text', form })
    );
  }

  void it('names the field whose value changed to the value given', () => {
    const [first = {}, last = {}] = inForm(
      { id: 'first-name', value: 'Ada' },
      { id: 'last-name', value: '' }
    );
    const before = fieldValues(last);
    first['value'] = 'Lovelace';
    assert.equal(movedTo(last, 'Lovelace', before), 'input#first-name');
    assert.equal(movedTo(last, 'Lovelace'), undefined, 'nothing recorded before the fill');
  });

  void it('ignores a field that already had the value, and values under 2 characters', () => {
    const [, last = {}] = inForm({ id: 'first', value: 'Smith' }, { id: 'last', value: '' });
    assert.equal(movedTo(last, 'Smith', fieldValues(last)), undefined);
    const [other = {}, field = {}] = inForm({ id: 'a', value: '' }, { id: 'b', value: '' });
    const before = fieldValues(field);
    other['value'] = 'x';
    assert.equal(movedTo(field, 'x', before), undefined);
  });

  void it('names a field without id by its name, and never searches for passwords', () => {
    const [first = {}, last = {}] = inForm(
      { id: '', name: 'first', value: '' },
      { id: '', name: 'last', value: '' }
    );
    const before = fieldValues(last);
    first['value'] = 'Lovelace';
    assert.equal(movedTo(last, 'Lovelace', before), 'input[name="first"]');
    const [user = {}, password = {}] = inForm(
      { id: 'user', value: '' },
      { id: 'pass', type: 'password', value: '' }
    );
    const recorded = fieldValues(password);
    user['value'] = 'hunter2';
    assert.equal(movedTo(password, 'hunter2', recorded), undefined);
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
    const document = { method: 'POST', url: 'https://site.test/authenticate' };
    const sent = submitTimeoutError(10000, true, { document: { ...document, pendingMs: 10000 } });
    assert.doesNotMatch(sent.suggestion, /fetch/);
    assert.match(sent.suggestion, /larger --timeout/);
  });

  void it('names the page request the submit is waiting for, and how far it got', () => {
    const document = { method: 'POST', url: 'https://site.test/authenticate' };
    assert.match(
      submitTimeoutError(30000, true, { document: { ...document, pendingMs: 30000 } }).message,
      /waiting for navigation: POST site\.test\/authenticate pending for 30s$/
    );
    const failed = submitTimeoutError(30000, true, {
      document: { ...document, status: 503, statusText: 'Service Unavailable' },
    });
    assert.match(
      failed.message,
      /: POST site\.test\/authenticate returned 503 Service Unavailable$/
    );
    assert.match(failed.suggestion, /answered with an error/);
    assert.match(
      submitTimeoutError(30000, false, {
        pending: [{ method: 'GET', url: 'https://site.test/app.js', pendingMs: 9000 }],
        pendingCount: 3,
      }).message,
      /waiting for network idle: waiting on GET site\.test\/app\.js \(pending 9s\) and 2 more$/
    );
  });

  void it('warns when the new page loaded but requests kept running', () => {
    assert.equal(
      submitNetworkBusyWarning(10000, 2),
      'The new page loaded, but 2 requests still had not finished after 10000ms'
    );
  });
});
