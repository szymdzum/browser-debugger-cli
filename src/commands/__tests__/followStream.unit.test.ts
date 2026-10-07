/**
 * Follow modes stream each item once.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { droppedInView, messageKeys } from '@/commands/console.js';
import { newPageCrashes } from '@/commands/shared/followMode.js';
import type { ConsoleMessage, NetworkRequest } from '@/types.js';
import {
  buildConsoleJsonOutput,
  formatConsole,
  formatConsoleFollowLines,
} from '@/ui/formatters/console.js';
import { formatNetworkFollowRows } from '@/ui/formatters/networkList.js';
import { failureReason } from '@/ui/formatters/requestStatus.js';

void describe('console follow keys', () => {
  void it('tells apart identical messages logged in the same millisecond', () => {
    const message: ConsoleMessage = { type: 'log', text: 'x', timestamp: 1000 };
    const keys = messageKeys([message, { ...message }, { ...message, text: 'y' }]);
    assert.equal(new Set(keys).size, 3);
    assert.deepEqual(messageKeys([message]), keys.slice(0, 1));
  });
});

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
