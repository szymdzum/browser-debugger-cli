/**
 * Follow modes stream each item once.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFollowCursor, droppedInView } from '@/commands/console.js';
import { newPageCrashes } from '@/commands/shared/followMode.js';
import type { ConsoleMessage, NetworkRequest } from '@/types.js';
import {
  buildConsoleJsonOutput,
  formatConsole,
  formatConsoleFollowLines,
} from '@/ui/formatters/console.js';
import { formatNetworkFollowRows } from '@/ui/formatters/networkList.js';
import { failureReason } from '@/ui/formatters/requestStatus.js';

void describe('network follow rows', () => {
  const request: NetworkRequest = {
    requestId: '1.1',
    url: 'https://a.test/x',
    method: 'GET',
    timestamp: 0,
    status: 200,
    duration: 5,
  };

  void it('prints the column header only the first time, and no second banner', () => {
    assert.match(formatNetworkFollowRows([request], { header: true }), /STS METH/);
    assert.doesNotMatch(formatNetworkFollowRows([request], { header: true }), /Streaming/);
    assert.doesNotMatch(formatNetworkFollowRows([request]), /STS METH/);
  });
});

void describe('console follow lines', () => {
  void it('leave the stream banner to stderr', () => {
    assert.doesNotMatch(formatConsoleFollowLines([], { header: true }), /Streaming/);
  });
});

void describe('page crash in follow modes', () => {
  void it('is reported once per crash', () => {
    const newCrash = newPageCrashes();
    assert.equal(newCrash(undefined), undefined);
    assert.equal(newCrash(1000), 1000);
    assert.equal(newCrash(1000), undefined);
    assert.equal(newCrash(undefined), undefined);
    assert.equal(newCrash(2000), 2000, 'a page loaded again that crashes again');
  });

  void it('shows as a warning before the console view, and in its JSON', () => {
    const messages: ConsoleMessage[] = [{ type: 'error', text: 'boom', timestamp: 1 }];
    assert.match(formatConsole(messages, { pageCrashedAt: 5 }), /^⚠ The page crashed at /);
    assert.doesNotMatch(formatConsole(messages, {}), /crashed/);
    assert.equal(buildConsoleJsonOutput(messages, { pageCrashedAt: 5 }).pageCrashedAt, 5);
  });
});

void describe('droppedInView', () => {
  const message = (navigationId: number): ConsoleMessage => ({
    type: 'log',
    text: 'x',
    timestamp: 1,
    navigationId,
  });

  void it('warns about dropped messages only when they could be of the page shown', () => {
    const kept = [message(1), message(2)];
    assert.equal(droppedInView(kept, 8028, {}, 2), 0, 'the oldest kept is an earlier page');
    assert.equal(droppedInView(kept, 8028, { history: true }, 2), 8028);
    assert.equal(droppedInView([message(2)], 5, {}, 2), 5, 'the shown page logged before them');
    assert.equal(droppedInView(kept, 0, {}, 1), 0);
  });
});

void describe('failureReason', () => {
  void it('hides a body abort after a complete response', () => {
    assert.equal(failureReason({ status: 204, errorText: 'net::ERR_ABORTED' }), undefined);
    assert.equal(failureReason({ status: 0, errorText: 'net::ERR_ABORTED' }), 'net::ERR_ABORTED');
  });
});

void describe('console follow cursor', () => {
  const message = (text: string, navigationId: number, timestamp: number): ConsoleMessage => ({
    type: 'error',
    text,
    timestamp,
    navigationId,
  });
  const texts = (messages: ConsoleMessage[]): string[] => messages.map((m) => m.text);

  void it('prints the left page messages that arrived before a navigation, once', () => {
    const cursor = createFollowCursor({}, 100);
    const old = message('old', 1, 1);
    assert.deepEqual(texts(cursor.next([old], 1)), ['old']);
    const first = message('first', 1, 2);
    const fresh = message('fresh', 2, 3);
    assert.deepEqual(texts(cursor.next([old, first, fresh], 2)), ['first', 'fresh']);
    assert.deepEqual(texts(cursor.next([old, first, fresh], 2)), []);
  });

  void it('does not print the earlier pages the start left out', () => {
    const cursor = createFollowCursor({}, 100);
    const before = message('before', 1, 1);
    const now = message('now', 2, 2);
    assert.deepEqual(texts(cursor.next([before, now], 2)), ['now']);
    assert.deepEqual(texts(cursor.next([before, now], 2)), []);
  });

  void it('applies --level to the left page messages too', () => {
    const cursor = createFollowCursor({ level: 'error' }, 100);
    cursor.next([], 1);
    const warn: ConsoleMessage = { type: 'warning', text: 'warn', timestamp: 1, navigationId: 1 };
    const error = message('error', 1, 2);
    assert.deepEqual(texts(cursor.next([warn, error, message('new', 2, 3)], 2)), ['error', 'new']);
  });

  void it('keeps its place when the session drops the oldest messages', () => {
    const cursor = createFollowCursor({}, 100);
    const all = ['a', 'b', 'c', 'd'].map((text, i) => message(text, 1, i + 1));
    cursor.next(all, 1);
    const kept = [...all.slice(2), message('e', 1, 5), message('f', 1, 6)];
    assert.deepEqual(texts(cursor.next(kept, 1)), ['e', 'f']);
  });

  void it('prints identical same-millisecond messages once each', () => {
    const cursor = createFollowCursor({}, 0);
    const same = (): ConsoleMessage => message('x', 1, 100);
    assert.equal(cursor.next([same(), same()], 1, 0).length, 2);
    assert.equal(cursor.next([same(), same(), same()], 1, 0).length, 1);
    assert.equal(cursor.next([same(), same(), same()], 1, 0).length, 0);
  });

  void it('counts new duplicates when the oldest identical messages were dropped', () => {
    const cursor = createFollowCursor({}, 0);
    const same = (): ConsoleMessage => message('x', 1, 100);
    const first = Array.from({ length: 30 }, same);
    assert.equal(cursor.next(first, 1, 0).length, 30);
    const kept = [...first.slice(10), ...Array.from({ length: 10 }, same)];
    assert.equal(cursor.next(kept, 1, 10).length, 10);
    assert.equal(cursor.next(kept, 1, 10).length, 0);
  });

  void it('prints a separator between the left page and the new page', () => {
    const text = formatConsoleFollowLines([message('left', 1, 1), message('right', 2, 2)], {
      streamNavigationId: 1,
      currentNavigationId: 2,
    });
    assert.match(text, /left[\s\S]*Next page \(navigation #2\)[\s\S]*right/);
    const quiet = formatConsoleFollowLines([], { streamNavigationId: 1, currentNavigationId: 2 });
    assert.match(quiet, /Next page \(navigation #2\)/);
  });
});
