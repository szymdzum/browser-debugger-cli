/**
 * What a DOM action changed: new messages, shown elements, navigation, "no
 * effect", whether the page was still changing, and how they read in human
 * output.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { submitNetworkBusyWarning, submitTimeoutError } from '@/errors/messages.js';
import type { TriggeredRequest } from '@/ipc/protocol/domTypes.js';
import {
  domKeptChanging,
  domLooksBusy,
  hadNoEffect,
  newMessages,
  pageNavigation,
  pendingChanges,
  shownElements,
  type NavigationEvents,
  type PageWork,
  type ReadSnapshot,
  type SeenMessage,
  type SettleSignals,
} from '@/runtime/dom/actionEffects.js';
import { FIELD_VALUES_JS, MOVED_VALUE_JS } from '@/runtime/dom/reactEventHelpers.js';
import {
  actionStatusLine,
  newMessageText,
  pageNavigationText,
  shownElementText,
  stillChangingNote,
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
    assert.deepEqual(newMessages(before, after, false).messages, [
      { text: 'Your password is invalid!', element: 'div#flash.error' },
    ]);
  });

  void it('reports an element whose text changed', () => {
    assert.deepEqual(
      newMessages([seen(1, '1 item added')], [seen(1, '2 items added')], false).messages,
      [{ text: '2 items added', element: 'div.flash' }]
    );
  });

  void it('ignores a message re-rendered with the same text, but not a second copy', () => {
    assert.deepEqual(newMessages([seen(1, 'Required')], [seen(5, 'Required')], false).messages, []);
    assert.deepEqual(
      newMessages([seen(1, 'Required')], [seen(1, 'Required'), seen(2, 'Required')], false)
        .messages,
      [{ text: 'Required', element: 'div.flash' }]
    );
  });

  void it('leaves out texts that tick on their own (clocks, counters)', () => {
    const before = [seen(1, '12:04:33'), seen(2, '57%'), seen(3, '3 s')];
    const after = [seen(1, '12:04:34'), seen(2, '58%'), seen(3, '2 s'), seen(4, 'Saved 2 items')];
    assert.deepEqual(
      newMessages(before, after, false).messages.map((message) => message.text),
      ['Saved 2 items']
    );
  });

  void it('counts every message of a new document as new', () => {
    assert.deepEqual(newMessages([seen(1, 'Invalid')], [seen(1, 'Invalid')], true).messages, [
      { text: 'Invalid', element: 'div.flash' },
    ]);
  });

  void it('reports at most three texts and how many more, each once and at most 120 characters', () => {
    const after = [
      seen(1, 'a'),
      seen(2, 'a'),
      seen(3, 'b'),
      seen(4, 'c'),
      seen(5, 'x'.repeat(200)),
    ];
    const found = newMessages([], after, false);
    assert.deepEqual(
      found.messages.map((message) => message.text),
      ['a', 'b', 'c']
    );
    assert.equal(found.more, 1);
    const long = newMessages([], [seen(1, 'x'.repeat(200))], false).messages[0]?.text ?? '';
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
    assert.equal(
      hadNoEffect(read(), { shown: [{ text: 'Tip', element: 'div' }] }, NOTHING_ELSE),
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
      actionStatusLine('Element Clicked', { warned: false, noEffect: true }),
      '⚠ Element Clicked (no visible effect observed: no DOM change, requests or navigation within 300 ms)'
    );
    assert.equal(
      actionStatusLine('Element Clicked', { warned: true }),
      '⚠ Element Clicked (with warnings)'
    );
    assert.equal(actionStatusLine('Element Clicked', { warned: false }), '✓ Element Clicked');
  });

  void it('says when the page was still changing', () => {
    assert.equal(
      actionStatusLine('Element Clicked', { warned: false, stillChanging: true }),
      '⚠ Element Clicked (page still changing)'
    );
    assert.equal(
      actionStatusLine('Key Pressed', { warned: true, stillChanging: true }),
      '⚠ Key Pressed (with warnings; page still changing)'
    );
    assert.equal(
      stillChangingNote('click', { requests: 2, domChanging: true }),
      'The page was still changing when the click returned (2 requests pending, DOM still changing); wait for the result with bdg dom wait <selector>'
    );
    assert.equal(
      stillChangingNote('key press', {
        navigation: true,
        loading: 'div#loading',
        busy: true,
      }),
      'The page was still changing when the key press returned (a new page still loading, loading indicator div#loading shown, page busy running a script); wait for the result with bdg dom wait <selector>'
    );
  });

  void it('names shown elements with their text', () => {
    assert.equal(
      shownElementText({ text: 'name: user2 View profile', element: 'div.figcaption' }),
      'div.figcaption "name: user2 View profile"'
    );
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

void describe('shownElements', () => {
  void it('leaves out texts reported as messages, keeps three and cuts long texts', () => {
    const shown = [
      { text: 'Saved', element: 'div.toast' },
      { text: 'one', element: 'li' },
      { text: 'two', element: 'li' },
      { text: 'x'.repeat(200), element: 'li' },
      { text: 'four', element: 'li' },
    ];
    const result = shownElements(shown, [{ text: 'Saved', element: 'div.toast' }]);
    assert.deepEqual(
      result.map((element) => element.text.length),
      [3, 3, 120]
    );
    assert.ok(result[2]?.text.endsWith('…'));
  });
});

/**
 * Settle signals of a read.
 *
 * @param fields - Signals that differ from a quiet page
 * @returns Signals
 */
function settle(fields: Partial<SettleSignals> = {}): SettleSignals {
  return { burstAges: [], loading: null, ...fields };
}

/**
 * Page work after an action.
 *
 * @param fields - Work that differs from a settled page
 * @returns Work
 */
function work(fields: Partial<PageWork> = {}): PageWork {
  return {
    settle: settle(),
    domChanging: false,
    unresponsive: false,
    navigating: false,
    ...fields,
  };
}

void describe('domLooksBusy and domKeptChanging', () => {
  void it('looks again only after recent bursts, not after one render or old ones', () => {
    assert.equal(domLooksBusy(settle({ burstAges: [120, 40] })), true);
    assert.equal(domLooksBusy(settle({ burstAges: [40] })), false, 'one render');
    assert.equal(domLooksBusy(settle({ burstAges: [480, 300] })), false, 'quiet since');
    assert.equal(domLooksBusy(settle({ burstAges: [900, 40] })), false, 'one in the window');
    assert.equal(domLooksBusy(undefined), false);
  });

  void it('counts the DOM as still changing with two new bursts during the second look', () => {
    assert.equal(domKeptChanging(settle({ burstAges: [400, 180, 60] }), 260), true);
    assert.equal(domKeptChanging(settle({ burstAges: [400, 300, 60] }), 260), false, 'a poller');
    assert.equal(domKeptChanging(undefined, 260), false);
  });
});

void describe('pendingChanges', () => {
  /**
   * A triggered request.
   *
   * @param resourceType - CDP resource type
   * @param pending - Whether it was still running
   * @returns Request
   */
  const request = (resourceType: string, pending = true): TriggeredRequest => ({
    requestId: resourceType,
    method: 'GET',
    url: `https://a.test/${resourceType}`,
    resourceType,
    ...(pending && { pending: true as const }),
  });

  void it('is undefined for a settled page', () => {
    assert.equal(pendingChanges(work()), undefined);
  });

  void it('counts pending content requests, not assets, streams or finished ones', () => {
    const requests = ['Fetch', 'XHR', 'Document', 'Script', 'Image', 'Stylesheet', 'EventSource']
      .map((type) => request(type))
      .concat(request('Fetch', false));
    assert.deepEqual(pendingChanges(work(), requests), { requests: 4 });
  });

  void it('names a loader, a pending navigation, an ongoing DOM and a busy page', () => {
    assert.deepEqual(
      pendingChanges(
        work({
          settle: settle({ loading: 'div#loading' }),
          navigating: true,
          domChanging: true,
          unresponsive: true,
        })
      ),
      { navigation: true, loading: 'div#loading', domChanging: true, busy: true }
    );
  });
});
